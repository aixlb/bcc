/**
 * 自定义 OpenAI 兼容供应商 —— 视频生成剧本服务
 *
 * 与 MiniMax 内置服务的区别：不走厂商专用的文件上传接口，而是把视频**转 base64 内联**
 * 进 video_url（`data:video/mp4;base64,...`）。这样无需各家私有的上传/URI 约定，凡是接受
 * 内联视频的 OpenAI 兼容多模态模型（MiniMax / GLM-4V / Qwen-VL 等）都能用。
 *
 * 代价：base64 会让请求体膨胀 ~33%，大视频可能超出供应商请求体上限，因此先压到较小目标。
 *
 * 复用 script-postprocess 的剥思考 + 时间戳等比缩放（这些模型同样可能是推理模型 / 时间戳漂移）。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { CustomProvider } from '@shared/types'
import { buildScriptPrompt, SCRIPT_SYSTEM_PROMPT } from './prompt.js'
import { compressIfNeeded, formatBytes, type VideoInfo } from './video.js'
import { createLogger, NOOP_LOGGER, type DebugLogger } from './logger.js'
import { fetchWithOverloadRetry } from './http-retry.js'
import {
  detectVideoMime,
  scaleTimestamps,
  stripCodeFences,
  stripThinkComplete,
  stripThinkForDisplay,
} from './script-postprocess.js'

/** base64 内联前压缩目标（MB）。base64 后约 ×1.33，保守压小以免超请求体上限 */
const INLINE_MAX_VIDEO_MB = 30

export interface GenerationCallbacks {
  onUploadProgress?: (percent: number) => void
  onToken?: (accumulated: string, delta: string, tokensUsed?: number) => void
  onStatus?: (status: string, message: string) => void
  signal?: AbortSignal
}

/** 流式 Chat Completions 的目标端点（供本服务与 ChatGPTService 共用） */
export interface OpenAIStreamTarget {
  /** 报错信息里显示的供应商名 */
  name: string
  apiKey: string
  /** 不带尾斜杠 */
  baseUrl: string
  model: string
}

export interface OpenAIStreamOptions {
  /** 供应商/模型专属参数，如 OpenAI GPT-5.x 的 reasoning_effort。 */
  extraBody?: Record<string, unknown>
  log?: DebugLogger
}

/**
 * 流式调用 OpenAI 兼容 chat/completions，返回原始全文（含可能的 <think>）。
 * SSE 解析兼容 LF/CRLF 分隔与供应商流内错误（base_resp）。
 */
export async function streamOpenAIChatCompletion(
  target: OpenAIStreamTarget,
  messages: unknown[],
  opts: OpenAIStreamOptions,
  cb: GenerationCallbacks
): Promise<string> {
  const { signal } = cb
  const log = opts.log ?? NOOP_LOGGER
  const url = `${target.baseUrl}/chat/completions`
  const body: Record<string, unknown> = {
    ...opts.extraBody,
    model: target.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }

  log.info(`对话请求: POST ${url} model=${target.model} output_limit=provider-default`)
  // 服务端过载（429/5xx）自动退避重试（流开始前才重试，不会重复 token）
  const resp = await fetchWithOverloadRetry({
    label: `${target.name} API`,
    signal,
    doFetch: () =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }),
    onWait: (msg) => cb.onStatus?.('generating', msg),
    logInfo: (msg) => log.info(msg),
    logError: (msg) => log.error(msg),
  })

  if (!resp.body) {
    log.error('对话响应无 body')
    throw new Error(`${target.name} API 返回了空的响应体`)
  }
  log.info(`对话响应: HTTP ${resp.status}，开始读取 SSE 流`)

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let raw = ''
  let tokensUsed: number | undefined
  let gotFirstToken = false
  let finishReason: string | null | undefined

  const finish = (): string => {
    log.info(`SSE 完成: ${raw.length}字 finish=${finishReason ?? '-'} tokens=${tokensUsed ?? '-'}`)
    if (finishReason === 'length') {
      throw new Error(`${target.name} 输出达到 token 上限，内容被截断，请重试或缩短视频`)
    }
    if (!raw.trim()) throw new Error(`${target.name} 返回了空内容`)
    return raw
  }

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // SSE 事件以空行分隔；兼容 LF（\n\n）与 CRLF（\r\n\r\n）两种换行
      const events = buffer.split(/\r\n\r\n|\n\n/)
      buffer = events.pop() ?? ''

      for (const ev of events) {
        for (const line of ev.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') {
            return finish()
          }
          try {
            const data = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
              usage?: { total_tokens?: number }
              base_resp?: { status_code?: number; status_msg?: string }
            }
            if (data.base_resp && data.base_resp.status_code) {
              throw new Error(`供应商流内错误: ${data.base_resp.status_msg || data.base_resp.status_code}`)
            }
            const delta = data.choices?.[0]?.delta?.content ?? ''
            const fr = data.choices?.[0]?.finish_reason
            if (fr) finishReason = fr
            if (delta) {
              if (!gotFirstToken) {
                gotFirstToken = true
                log.info('SSE 收到首个 token')
              }
              raw += delta
              cb.onToken?.(stripThinkForDisplay(raw), delta, tokensUsed)
            }
            if (data.usage?.total_tokens) tokensUsed = data.usage.total_tokens
          } catch (e: any) {
            if (e instanceof Error && e.message.startsWith('供应商流内错误')) throw e
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return finish()
}

export class OpenAIScriptService {
  private baseUrl: string
  private log: DebugLogger = NOOP_LOGGER

  constructor(private provider: CustomProvider) {
    if (!provider.api_key) {
      throw new Error(`${provider.name || '自定义供应商'} API Key 未配置，请到设置页填写`)
    }
    if (!provider.base_url) {
      throw new Error(`${provider.name || '自定义供应商'} Base URL 未配置`)
    }
    this.baseUrl = provider.base_url.replace(/\/$/, '')
  }

  /** 生成剧本：压缩 → base64 内联 → 流式生成 → 剥思考 + 等比缩放时间戳 */
  async generateScript(
    videoPath: string,
    videoInfo: VideoInfo,
    callbacks: GenerationCallbacks = {},
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = callbacks

    this.log = createLogger('openai-script', String(Date.now()))
    this.log.info(
      `=== ${this.provider.name} 生成剧本 === model=${this.provider.model} baseUrl=${this.baseUrl} ` +
        `video=${path.basename(videoPath)} size=${formatBytes(videoInfo.sizeBytes)} ` +
        `dur=${videoInfo.durationSec.toFixed(0)}s ${videoInfo.width}x${videoInfo.height}`
    )
    if (this.log.filePath) callbacks.onStatus?.('preparing', `诊断日志: ${this.log.filePath}`)

    let compressed: Awaited<ReturnType<typeof compressIfNeeded>> | null = null
    try {
      // 1. 压缩（base64 内联，压到较小目标以免超请求体上限）
      callbacks.onStatus?.('compressing', `准备视频文件 (${formatBytes(videoInfo.sizeBytes)})...`)
      compressed = await compressIfNeeded(videoPath, INLINE_MAX_VIDEO_MB, undefined, signal)
      this.throwIfAborted(signal)
      this.log.info(
        `压缩: compressed=${compressed.compressed} ${compressed.originalMB.toFixed(1)}MB -> ${compressed.outputMB.toFixed(1)}MB`
      )

      // 2. 读文件 → base64 data URL
      callbacks.onStatus?.('uploading', `编码视频 (${compressed.outputMB.toFixed(1)} MB)...`)
      callbacks.onUploadProgress?.(0.1)
      const buf = await fs.readFile(compressed.outputPath)
      const mime = detectVideoMime(compressed.outputPath)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      callbacks.onUploadProgress?.(1)
      this.throwIfAborted(signal)
      this.log.info(`base64 内联: mime=${mime} base64=${formatBytes(dataUrl.length)}`)

      // 3. 流式生成
      callbacks.onStatus?.('generating', '开始生成剧本...')
      const userPrompt = buildScriptPrompt({ durationSec: videoInfo.durationSec })
      const raw = await this.streamChat(userPrompt, dataUrl, callbacks, systemPrompt)

      // 4. 剥思考（含被截断的未闭合块）+ 去围栏 + 等比缩放时间戳
      let script = stripCodeFences(stripThinkComplete(raw))
      // 思考被截断（无 </think>）时整段推理会被剥成空 → 明确报错，不落盘残缺/空内容
      if (!script.trim()) {
        throw new Error('生成被中断：模型在思考阶段被截断，未产出有效剧本，请重试')
      }
      const scaled = scaleTimestamps(script, videoInfo.durationSec)
      if (scaled.changed) {
        this.log.info(
          `时间戳等比缩放: 最大 ${scaled.maxBeforeSec.toFixed(0)}s -> 时长 ${videoInfo.durationSec.toFixed(0)}s ` +
            `(factor=${scaled.factor.toFixed(3)}, 共 ${scaled.count} 个)`
        )
      }
      script = scaled.text

      this.log.info(`完成: 原始 ${raw.length} 字 -> 清洗后 ${script.length} 字`)
      this.log.info(`=== 生成结果全文 ===\n${script}\n=== 全文结束 ===`)
      return script
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (!signal?.aborted) {
        this.log.error(`失败: ${msg}`)
        if (this.log.filePath) err.message = `${msg}\n（诊断日志: ${this.log.filePath}）`
      }
      throw err
    } finally {
      if (compressed && compressed.compressed && compressed.outputPath !== videoPath) {
        fs.rm(compressed.outputPath, { force: true }).catch(() => {})
        fs.rm(path.dirname(compressed.outputPath), { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  /** 流式调用 Chat Completions（video_url 内联 base64），返回原始全文（含 <think>） */
  private async streamChat(
    prompt: string,
    dataUrl: string,
    cb: GenerationCallbacks,
    systemPrompt?: string
  ): Promise<string> {
    this.log.info(`对话内容: video=base64内联 prompt=${prompt.length}字`)
    return await streamOpenAIChatCompletion(
      {
        name: this.provider.name,
        apiKey: this.provider.api_key,
        baseUrl: this.baseUrl,
        model: this.provider.model,
      },
      [
        { role: 'system', content: systemPrompt || SCRIPT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'video_url', video_url: { url: dataUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      { log: this.log },
      cb
    )
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }
  }
}
