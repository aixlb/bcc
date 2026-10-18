/**
 * 分镜图片分析器 — 支持 Gemini、OpenAI 兼容 API 和 Anthropic (Claude)
 */

import fs from 'node:fs/promises'
import { FinishReason, GoogleGenAI, ThinkingLevel } from '@google/genai'
import type { StoryboardShot } from '@shared/types'
import {
  formatStoryboardDescription,
  normalizeStoryboardShotType,
  parseStoryboardDescriptionParts,
} from '@shared/defaults.js'
import { stripThink } from './script-postprocess.js'
import { createAnthropicClient, explainAnthropicError, getClaudeMaxOutputTokens } from './claude.js'

export type AnalyzerProvider = 'gemini' | 'openai' | 'anthropic'

export interface AnalyzerConfig {
  provider: AnalyzerProvider
  apiKey: string
  baseUrl: string
  model: string
}

export interface ImageAnalyzer {
  /** signal 用于即时取消：触发后立刻丢弃这一轮大模型请求（中断在途 HTTP） */
  analyze(framePath: string, prompt: string, signal?: AbortSignal): Promise<StoryboardShot>
}

/** 把一个可能不响应中断的 Promise 包装成「signal 一触发就立刻 reject」 */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    // promise 可能已在途（取消发生在 await fs.readFile 之后），吞掉它的结果，
    // 避免在主进程里冒出未处理的 rejection
    promise.catch(() => {})
    return Promise.reject(new DOMException('Cancelled', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  models?: string[]
}

/** 测试 OpenAI 兼容接口连通性（GET /models） */
export async function testAnalyzerConnection(cfg: Pick<AnalyzerConfig, 'apiKey' | 'baseUrl'>): Promise<ConnectionTestResult> {
  const baseUrl = (cfg.baseUrl || '').replace(/\/$/, '')
  if (!baseUrl) return { ok: false, message: 'Base URL 未配置' }
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return { ok: false, message: `连接失败 (${resp.status}): ${text.slice(0, 200)}` }
    }
    const json = (await resp.json()) as { data?: Array<{ id: string }> }
    const models = json.data?.map((m) => m.id) ?? []
    return { ok: true, message: `连接成功，发现 ${models.length} 个模型`, models }
  } catch (err: any) {
    return { ok: false, message: explainError(err) }
  }
}

/** 创建对应 provider 的分析器 */
export function createAnalyzer(cfg: AnalyzerConfig): ImageAnalyzer {
  if (cfg.provider === 'gemini') return new GeminiAnalyzer(cfg)
  if (cfg.provider === 'anthropic') return new ClaudeAnalyzer(cfg)
  return new OpenAICompatibleAnalyzer(cfg)
}

class GeminiAnalyzer implements ImageAnalyzer {
  private client: GoogleGenAI

  constructor(private cfg: AnalyzerConfig) {
    this.client = new GoogleGenAI({ apiKey: cfg.apiKey })
  }

  async analyze(framePath: string, prompt: string, signal?: AbortSignal): Promise<StoryboardShot> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const imageBuffer = await fs.readFile(framePath)
    const base64 = imageBuffer.toString('base64')

    // 既把 abortSignal 透传给 SDK（支持时真正中断在途请求），
    // 又用 withAbort 兜底，保证取消时本轮立即结束、不等大模型返回。
    const resp = await withAbort(
      this.client.models.generateContent({
        model: this.cfg.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { data: base64, mimeType: 'image/jpeg' } },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: signal,
        },
      }),
      signal
    )

    const finishReason = resp.candidates?.[0]?.finishReason
    if (finishReason === FinishReason.MAX_TOKENS) {
      throw new Error('Gemini 分镜分析达到 token 上限，未保存截断结果')
    }
    if (finishReason && finishReason !== FinishReason.STOP) {
      throw new Error(`Gemini 分镜分析异常终止 (${finishReason})`)
    }
    const text = resp.text ?? ''
    if (!text.trim()) throw new Error('Gemini 分镜分析返回了空内容')
    return parseStoryboardResponse(text)
  }
}

/** OpenAI 兼容分析器（不发 temperature，兼容 Moonshot 等不支持该参数的 API） */
class OpenAICompatibleAnalyzer implements ImageAnalyzer {
  constructor(private cfg: AnalyzerConfig) {}

  async analyze(framePath: string, prompt: string, signal?: AbortSignal): Promise<StoryboardShot> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const imageBuffer = await fs.readFile(framePath)
    const base64 = imageBuffer.toString('base64')
    const dataUrl = `data:image/jpeg;base64,${base64}`

    const baseUrl = this.cfg.baseUrl.replace(/\/$/, '')
    const url = `${baseUrl}/chat/completions`

    const isKimiK3 = this.cfg.model === 'kimi-k3'
    const isOpenAIGpt5 = /^gpt-5(?:\.|$)/.test(this.cfg.model)
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      ...(isKimiK3 ? { reasoning_effort: 'max' } : {}),
      ...(isOpenAIGpt5 ? { reasoning_effort: 'low' } : {}),
    }

    // 把 signal 传给 fetch：取消时立刻中断在途请求（socket 关闭），不再干等大模型返回。
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`API ${resp.status}: ${text.slice(0, 200)}`)
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }>
      error?: { message?: string }
    }

    if (json.error?.message) {
      throw new Error(`API error: ${json.error.message}`)
    }

    const choice = json.choices?.[0]
    if (choice?.finish_reason === 'length') {
      throw new Error(`${this.cfg.model} 分镜分析达到 token 上限，未保存截断结果`)
    }
    const text = choice?.message?.content ?? ''
    if (!text.trim()) throw new Error(`${this.cfg.model} 分镜分析未返回正文`)
    return parseStoryboardResponse(text)
  }
}

/**
 * Anthropic (Claude) 分析器。
 * 不传 temperature / thinking（Fable 5 会 400；其他模型省略同样安全）；
 * Anthropic 强制要求 max_tokens，因此传模型公开支持的最大输出值。
 */
class ClaudeAnalyzer implements ImageAnalyzer {
  private client: ReturnType<typeof createAnthropicClient>

  constructor(private cfg: AnalyzerConfig) {
    this.client = createAnthropicClient({ api_key: cfg.apiKey, base_url: cfg.baseUrl })
  }

  async analyze(framePath: string, prompt: string, signal?: AbortSignal): Promise<StoryboardShot> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const imageBuffer = await fs.readFile(framePath)
    const base64 = imageBuffer.toString('base64')

    let resp
    try {
      resp = await this.client.messages.create(
        {
          model: this.cfg.model,
          max_tokens: getClaudeMaxOutputTokens(this.cfg.model),
          ...(this.cfg.model.startsWith('claude-fable') || this.cfg.model.startsWith('claude-mythos')
            ? { output_config: { effort: 'low' as const } }
            : {}),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              ],
            },
          ],
        },
        { signal }
      )
    } catch (err: any) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      throw new Error(explainAnthropicError(err))
    }

    if (resp.stop_reason === 'refusal') {
      throw new Error('该帧分析被 Claude 安全分类器拒绝')
    }
    if (resp.stop_reason === 'max_tokens') {
      throw new Error('Claude 分镜分析达到 token 上限，未保存截断结果')
    }
    const text = resp.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text.trim()) throw new Error('Claude 分镜分析返回了空内容')
    return parseStoryboardResponse(text)
  }
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * 解析供应商返回并收敛到 StoryboardShot。
 * 对外导出是为了让纯单测覆盖所有供应商共用的响应契约，无需发真实网络请求。
 */
export function parseStoryboardResponse(text: string): StoryboardShot {
  // 先剥掉推理模型内联的 <think>…</think>（如 MiniMax-M3），否则会污染 JSON 解析
  const cleaned = stripThink(text).replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  let parsed: Record<string, unknown> = {}

  try {
    const value: unknown = JSON.parse(cleaned)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>
    }
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const value: unknown = JSON.parse(jsonMatch[0])
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>
        }
      } catch {
        // ignore
      }
    }
  }

  const shotType = normalizeStoryboardShotType(parsed.shotType ?? parsed.景别)
  const rawDescription = parsed.description ?? parsed.提示词描述 ?? parsed.画面描述
  const descriptionParts = parseStoryboardDescriptionParts(rawDescription)
  // 契约外的旧 prose / 非 JSON 文本仍不丢失：放进「主体描述」，其余六项留空，
  // 从本解析器产出的新镜头因此始终是固定七行格式。
  const fallbackDescription =
    typeof rawDescription === 'string' && rawDescription.trim()
      ? rawDescription.trim()
      : Object.keys(parsed).length === 0
        ? cleaned.slice(0, 500)
        : ''
  const description = formatStoryboardDescription(
    descriptionParts ?? {
      风格限定: '',
      景别: shotType,
      视角构图: '',
      主体描述: fallbackDescription,
      背景设定: '',
      细节修饰: '',
      光影色调: '',
    },
    shotType
  )

  return {
    number: 0,
    shotType,
    angle: stringField(parsed, 'angle', '角度') || '平视角',
    cameraMove: stringField(parsed, 'cameraMove', '运镜') || '静态镜头',
    description,
    dialogue: stringField(parsed, 'dialogue', '台词'),
    sound: stringField(parsed, 'sound', '音效'),
    timeRange: '',
    startSec: 0,
    endSec: 0,
    sceneScore: 0,
  }
}

function explainError(err: any): string {
  const msg = err?.message ?? String(err)
  const code = err?.code ?? ''
  switch (code) {
    case 'ECONNREFUSED':
      return `连接被拒绝。检查代理或网络配置。`
    case 'ECONNRESET':
      return `连接被重置。可能是代理不稳定。`
    case 'ETIMEDOUT':
      return `连接超时。检查网络是否可达。`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `DNS 解析失败 (${code})。检查网络/代理配置。`
  }
  if (msg.includes('API key') || msg.includes('401') || msg.includes('403')) {
    return `认证失败：${msg}。检查 API Key 是否正确。`
  }
  return msg
}
