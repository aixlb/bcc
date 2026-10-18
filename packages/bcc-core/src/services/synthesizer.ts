/**
 * 风格研究合成器 — 把 N 个分镜的文本 + 拼图丢给 LLM 流式生成《风格指南》Markdown
 * 支持 Gemini、OpenAI 兼容 API 和 Anthropic (Claude)（不发 temperature，兼容 Moonshot / Fable 5 等）
 */

import fs from 'node:fs/promises'
import { FinishReason, GoogleGenAI, ThinkingLevel } from '@google/genai'
import type Anthropic from '@anthropic-ai/sdk'
import type { AnalyzerConfig } from './storyboard-analyzer.js'
import { createAnthropicClient, explainAnthropicError, getClaudeMaxOutputTokens } from './claude.js'

export interface SynthesizeOptions {
  systemPrompt: string
  userText: string
  images: string[]
  signal?: AbortSignal
  onChunk: (delta: string, accumulated: string) => void
}

export interface Synthesizer {
  synthesize(opts: SynthesizeOptions): Promise<string>
}

export function createSynthesizer(cfg: AnalyzerConfig): Synthesizer {
  if (cfg.provider === 'gemini') return new GeminiSynthesizer(cfg)
  if (cfg.provider === 'anthropic') return new ClaudeSynthesizer(cfg)
  return new OpenAISynthesizer(cfg)
}

class GeminiSynthesizer implements Synthesizer {
  private client: GoogleGenAI

  constructor(private cfg: AnalyzerConfig) {
    this.client = new GoogleGenAI({ apiKey: cfg.apiKey })
  }

  async synthesize(opts: SynthesizeOptions): Promise<string> {
    const { systemPrompt, userText, images, signal, onChunk } = opts

    const imageParts = await Promise.all(
      images.map(async (p) => {
        const buf = await fs.readFile(p)
        return {
          inlineData: {
            data: buf.toString('base64'),
            mimeType: 'image/jpeg' as const,
          },
        }
      })
    )

    const stream = await this.client.models.generateContentStream({
      model: this.cfg.model,
      contents: [
        {
          role: 'user',
          parts: [{ text: userText }, ...imageParts],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })

    let acc = ''
    let finishReason: FinishReason | undefined
    for await (const chunk of stream) {
      if (signal?.aborted) {
        throw new DOMException('Cancelled', 'AbortError')
      }
      const delta = chunk.text ?? ''
      const reason = chunk.candidates?.[0]?.finishReason
      if (reason) finishReason = reason
      if (delta) {
        acc += delta
        onChunk(delta, acc)
      }
    }
    if (finishReason === FinishReason.MAX_TOKENS) {
      throw new Error('Gemini 风格指南达到 token 上限，未保存截断结果')
    }
    if (finishReason && finishReason !== FinishReason.STOP) {
      throw new Error(`Gemini 风格指南异常终止 (${finishReason})`)
    }
    if (!acc.trim()) throw new Error('Gemini 返回了空的风格指南')
    return acc
  }
}

/** Anthropic (Claude) 合成器：不传 temperature / thinking（Fable 5 会 400）；给足输出预算容纳内置思考 */
class ClaudeSynthesizer implements Synthesizer {
  private client: ReturnType<typeof createAnthropicClient>

  constructor(private cfg: AnalyzerConfig) {
    this.client = createAnthropicClient({ api_key: cfg.apiKey, base_url: cfg.baseUrl })
  }

  async synthesize(opts: SynthesizeOptions): Promise<string> {
    const { systemPrompt, userText, images, signal, onChunk } = opts

    const imageParts: Anthropic.ContentBlockParam[] = await Promise.all(
      images.map(async (p) => {
        const buf = await fs.readFile(p)
        return {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: buf.toString('base64') },
        }
      })
    )

    try {
      const stream = this.client.messages.stream(
        {
          model: this.cfg.model,
          max_tokens: getClaudeMaxOutputTokens(this.cfg.model),
          ...(this.cfg.model.startsWith('claude-fable') || this.cfg.model.startsWith('claude-mythos')
            ? { output_config: { effort: 'medium' as const } }
            : {}),
          system: systemPrompt,
          messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...imageParts] }],
        },
        { signal }
      )

      let acc = ''
      stream.on('text', (delta) => {
        acc += delta
        onChunk(delta, acc)
      })
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') {
        throw new Error('合成请求被 Claude 安全分类器拒绝')
      }
      if (final.stop_reason === 'max_tokens') {
        throw new Error('Claude 风格指南达到 token 上限，未保存截断结果')
      }
      if (!acc.trim()) throw new Error('Claude 返回了空的风格指南')
      return acc
    } catch (err: any) {
      if (signal?.aborted || err instanceof DOMException) throw err
      throw new Error(explainAnthropicError(err))
    }
  }
}

/** OpenAI 兼容合成器（不发 temperature，兼容 Moonshot 等 API） */
class OpenAISynthesizer implements Synthesizer {
  constructor(private cfg: AnalyzerConfig) {}

  async synthesize(opts: SynthesizeOptions): Promise<string> {
    const { systemPrompt, userText, images, signal, onChunk } = opts

    const imageContent = await Promise.all(
      images.map(async (p) => {
        const buf = await fs.readFile(p)
        return {
          type: 'image_url' as const,
          image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` },
        }
      })
    )

    const baseUrl = this.cfg.baseUrl.replace(/\/$/, '')
    const isKimiK3 = this.cfg.model === 'kimi-k3'
    const isOpenAIGpt5 = /^gpt-5(?:\.|$)/.test(this.cfg.model)
    const requestBody: Record<string, unknown> = {
      model: this.cfg.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [{ type: 'text', text: userText }, ...imageContent],
        },
      ],
      ...(isKimiK3 ? { reasoning_effort: 'max' } : {}),
      ...(isOpenAIGpt5 ? { reasoning_effort: 'low' } : {}),
    }
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`API ${resp.status}: ${text.slice(0, 300)}`)
    }
    if (!resp.body) throw new Error('API 返回 body 为空')

    return await consumeSSE(resp.body, onChunk, this.cfg.model, signal)
  }
}

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onChunk: (delta: string, accumulated: string) => void,
  model: string,
  signal?: AbortSignal
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let acc = ''
  let finishReason: string | null | undefined

  const finish = (): string => {
    if (finishReason === 'length') {
      throw new Error(`${model} 风格指南达到 token 上限，未保存截断结果`)
    }
    if (!acc.trim()) throw new Error(`${model} 返回了空的风格指南`)
    return acc
  }

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const ev of events) {
        const lines = ev.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') {
            return finish()
          }
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{
                delta?: { content?: string; reasoning_content?: string }
                message?: { content?: string }
                finish_reason?: string | null
              }>
            }
            const reason = json.choices?.[0]?.finish_reason
            if (reason) finishReason = reason
            const delta =
              json.choices?.[0]?.delta?.content ??
              json.choices?.[0]?.message?.content ??
              ''
            if (delta) {
              acc += delta
              onChunk(delta, acc)
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }

  return finish()
}
