/**
 * Kimi API 服务：上传视频 → 引用文件 ID 生成剧本
 * 使用 Moonshot OpenAI 兼容（Kimi K3 / K2.7 多模态模型）接口
 *
 * 流程（参考 platform.kimi.com/docs/guide/use-kimi-vision-model）：
 * 1. 压缩到 Kimi 单文件上限（100MB）以内
 * 2. POST /v1/files 上传视频（purpose=video）—— 上传是同步的，返回 200 即代表就绪
 * 3. POST /v1/chat/completions，用 { type: 'video_url', video_url: { url: 'ms://{file-id}' } } 引用视频
 *    —— 关键：视频必须走 video_url，不能用 image_url（image_url 只接受静态图片）
 * 4. 解析 SSE 流式响应
 *
 * ⚠️ 不要轮询等待 status=ok/ready：purpose=video 的文件 status 会长期停留在 'created'，
 *    官方明确 'created' 即「已就绪」（forum.moonshot.ai/t/.../337）。死等 ok/ready 会一直超时。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { KimiConfig } from '@shared/types'
import { buildScriptPrompt, SCRIPT_SYSTEM_PROMPT } from './prompt.js'
import { compressIfNeeded, formatBytes, type VideoInfo } from './video.js'
import { fetchWithOverloadRetry } from './http-retry.js'
import { createLogger, safeStringify, NOOP_LOGGER, type DebugLogger } from './logger.js'

/** Kimi 单个上传文件上限 100MB；留些余量压到 95MB 以内 */
const KIMI_MAX_UPLOAD_MB = 95

/** Partial Mode：强制最终答案从合法的首场时间戳开始。 */
const KIMI_SCRIPT_PREFIX = '[00:00:00] 1-1 '

/** 视为「已就绪可用」的 status 值（'created' 对 purpose=video 即就绪） */
const READY_STATUSES = new Set(['created', 'ok', 'ready'])

export interface GenerationCallbacks {
  onUploadProgress?: (percent: number) => void
  onToken?: (accumulated: string, delta: string, tokensUsed?: number) => void
  onSegmentChange?: (currentIndex: number, total: number, label: string) => void
  onStatus?: (status: string, message: string) => void
  signal?: AbortSignal
}

interface KimiFile {
  id: string
  object: string
  bytes: number
  created_at: number
  filename: string
  purpose: string
  // 'created' 是 purpose=video 上传后的常驻状态，已就绪；'ok'/'ready' 见于其它 purpose
  status: 'created' | 'ok' | 'error' | 'pending' | 'uploaded' | 'ready'
  status_details: string
  file_type: string
}

export class KimiService {
  private baseUrl: string
  /** 本次作业的诊断日志（generateScript 内创建；testConnection 等不用） */
  private log: DebugLogger = NOOP_LOGGER

  constructor(private config: KimiConfig) {
    if (!config.api_key) {
      throw new Error('Kimi API Key 未配置，请到设置页填写')
    }
    this.baseUrl = (config.base_url || 'https://api.moonshot.cn/v1').replace(/\/$/, '')
  }

  async testConnection(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    try {
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.api_key}` },
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

  /**
   * 生成剧本：上传视频 → 等待就绪 → 流式生成
   */
  async generateScript(
    videoPath: string,
    videoInfo: VideoInfo,
    callbacks: GenerationCallbacks = {},
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = callbacks

    this.log = createLogger('kimi', String(Date.now()))
    this.log.info(
      `=== Kimi 生成剧本 === model=${this.config.model || 'kimi-k3'} baseUrl=${this.baseUrl} ` +
        `video=${path.basename(videoPath)} size=${formatBytes(videoInfo.sizeBytes)} ` +
        `dur=${videoInfo.durationSec.toFixed(0)}s ${videoInfo.width}x${videoInfo.height}`
    )
    // 把日志路径透出到 UI 日志，方便用户取走整份日志
    if (this.log.filePath) callbacks.onStatus?.('preparing', `诊断日志: ${this.log.filePath}`)

    let file: KimiFile | null = null
    let compressed: Awaited<ReturnType<typeof compressIfNeeded>> | null = null
    try {
      // 1. 压缩视频（Kimi 单文件上限 100MB；超限会被 API 拒绝）
      callbacks.onStatus?.('compressing', `准备视频文件 (${formatBytes(videoInfo.sizeBytes)})...`)
      compressed = await compressIfNeeded(videoPath, KIMI_MAX_UPLOAD_MB, undefined, signal)
      this.throwIfAborted(signal)
      this.log.info(
        `压缩: compressed=${compressed.compressed} ${compressed.originalMB.toFixed(1)}MB -> ${compressed.outputMB.toFixed(1)}MB`
      )
      if (compressed.outputMB > 100) {
        throw new Error(
          `视频已按最低可用码率压缩仍有 ${compressed.outputMB.toFixed(0)} MB，超过 Kimi 100MB 上传上限` +
            `（视频过长），请截取较短片段或改用 Gemini。`
        )
      }

      // 2. 上传视频到 Kimi（purpose=video）
      callbacks.onStatus?.('uploading', `上传视频到 Kimi (${compressed.outputMB.toFixed(1)} MB)...`)
      file = await this.uploadFile(compressed.outputPath, signal, callbacks.onUploadProgress)
      this.throwIfAborted(signal)

      // 3. 确认就绪（不轮询等待 ok/ready：video 文件 status 常驻 'created' 即就绪）
      const readyFile = this.ensureFileReady(file)
      callbacks.onStatus?.('waiting_process', `已上传 (id=${readyFile.id}, status=${readyFile.status})`)
      this.throwIfAborted(signal)

      // 4. 流式生成
      callbacks.onStatus?.('generating', '开始生成剧本...')
      const userPrompt = buildScriptPrompt({ durationSec: videoInfo.durationSec })
      const result = await this.streamChat(userPrompt, readyFile.id, callbacks, systemPrompt)
      this.log.info(`完成: 共 ${result.length} 字`)
      // 记录全文，便于排查时间戳/格式问题（如模型未按 [HH:MM:SS] 输出）
      this.log.info(`=== 生成结果全文 ===\n${result}\n=== 全文结束 ===`)
      return result
    } catch (err: any) {
      // 失败时把详情和日志路径写进错误信息，方便用户/我定位
      const msg = err?.message ?? String(err)
      if (!signal?.aborted) {
        this.log.error(`失败: ${msg}`)
        if (this.log.filePath) err.message = `${msg}\n（诊断日志: ${this.log.filePath}）`
      }
      throw err
    } finally {
      // 5. 清理上传的文件 + 压缩临时文件
      if (file) {
        this.deleteFile(file.id).catch(() => {
          /* ignore */
        })
      }
      if (compressed && compressed.compressed && compressed.outputPath !== videoPath) {
        fs.rm(compressed.outputPath, { force: true }).catch(() => {})
        fs.rm(path.dirname(compressed.outputPath), { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  /** 上传文件到 Kimi */
  private async uploadFile(
    filePath: string,
    signal?: AbortSignal,
    onProgress?: (percent: number) => void
  ): Promise<KimiFile> {
    const stat = await fs.stat(filePath)

    // Kimi 单文件上限 100MB（同时避免整体读入内存导致 OOM）
    const MAX_SIZE = 100 * 1024 * 1024 // 100 MB
    if (stat.size > MAX_SIZE) {
      throw new Error(
        `视频文件过大（${(stat.size / 1024 / 1024).toFixed(0)} MB），` +
          `超过 Kimi 100MB 上传上限，请截取较短片段后再试。`
      )
    }

    const rawName = path.basename(filePath)
    const ext = path.extname(rawName).toLowerCase() || '.mp4'
    // FormData filename must be ByteString (≤0xFF per char); fall back when CJK/emoji present
    const safeFileName = /^[\x00-\xFF]+$/.test(rawName) ? rawName : `upload${ext}`
    const mime = detectMime(filePath)
    const fileBuffer = await fs.readFile(filePath)
    const blob = new Blob([fileBuffer], { type: mime })

    const form = new FormData()
    form.append('file', blob, safeFileName)
    form.append('purpose', 'video')

    onProgress?.(0)

    // 伪进度（上传无原生进度事件）
    const totalMB = stat.size / (1024 * 1024)
    const estSec = Math.max(5, totalMB / 2)
    const startTime = Date.now()
    const fakeTimer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000
      let p = elapsed / estSec
      if (p >= 0.95) {
        p = 0.95 + (elapsed - estSec * 0.95) / 20
      }
      p = Math.min(0.99, p)
      onProgress?.(p)
    }, 800)

    this.log.info(`上传请求: POST ${this.baseUrl}/files purpose=video name=${safeFileName} mime=${mime} size=${formatBytes(stat.size)}`)
    try {
      const resp = await fetch(`${this.baseUrl}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.api_key}` },
        body: form,
        signal,
      })
      onProgress?.(1)

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        this.log.error(`上传失败 HTTP ${resp.status}: ${text.slice(0, 1000)}`)
        throw new Error(`文件上传失败 (${resp.status}): ${text.slice(0, 300)}`)
      }

      const json = (await resp.json()) as KimiFile
      // 记录完整响应（含 status，这是排查就绪状态的关键）
      this.log.info(`上传响应: ${safeStringify(json)}`)
      return json
    } finally {
      clearInterval(fakeTimer)
    }
  }

  /**
   * 确认文件可用。Kimi 视频上传是同步的：上传成功（200）即代表就绪，
   * 且 purpose=video 的 status 会长期停留在 'created'（官方确认 == 就绪）。
   * 因此这里只在出现明确 'error' 时报错，其余状态一律视为可用 —— 不再轮询等待 ok/ready。
   */
  private ensureFileReady(file: KimiFile): KimiFile {
    if (file.status === 'error') {
      this.log.error(`文件处理失败: status=error details=${file.status_details}`)
      throw new Error(`视频处理失败: ${file.status_details || '未知错误'}`)
    }
    if (!READY_STATUSES.has(file.status)) {
      // 非 error 的未知状态：按官方说明仍立即可用，仅记录以便观察
      this.log.warn(`文件 status='${file.status}'（非常见就绪值），按已就绪继续`)
    } else {
      this.log.info(`文件就绪: status=${file.status}`)
    }
    return file
  }

  /** 删除上传的文件 */
  private async deleteFile(fileId: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.config.api_key}` },
    })
    if (!resp.ok) {
      console.warn(`[Kimi] 删除文件 ${fileId} 失败:`, resp.status)
    }
  }

  /** 流式调用 Chat Completions */
  private async streamChat(
    prompt: string,
    fileId: string,
    cb: GenerationCallbacks,
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = cb

    const url = `${this.baseUrl}/chat/completions`
    const model = this.config.model || 'kimi-k3'
    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt || SCRIPT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            // 视频必须用 video_url（ms://{file-id} 引用已上传文件）；image_url 仅支持静态图片
            { type: 'video_url', video_url: { url: `ms://${fileId}` } },
            { type: 'text', text: prompt },
          ],
        },
        { role: 'assistant', content: KIMI_SCRIPT_PREFIX, partial: true },
      ],
      stream: true,
      stream_options: { include_usage: true },
      ...(model === 'kimi-k3' ? { reasoning_effort: 'max' } : {}),
    }

    this.log.info(
      `对话请求: POST ${url} model=${body.model} video_url=ms://${fileId} ` +
        `prompt=${prompt.length}字 output_limit=provider-default`
    )
    // 引擎过载（429 engine_overloaded）/ 5xx 自动退避重试：文件已上传，重发对话请求成本极低
    const resp = await fetchWithOverloadRetry({
      label: 'Kimi API',
      signal,
      doFetch: () =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.api_key}`,
          },
          body: JSON.stringify(body),
          signal,
        }),
      onWait: (msg) => cb.onStatus?.('generating', msg),
      logInfo: (msg) => this.log.info(msg),
      logError: (msg) => this.log.error(msg),
    })

    if (!resp.body) {
      this.log.error('对话响应无 body')
      throw new Error('Kimi API 返回了空的响应体')
    }
    this.log.info(`对话响应: HTTP ${resp.status}，开始读取 SSE 流`)

    // 解析 SSE 流（使用缓冲区按 \n\n 切分，避免 TCP 分包时丢失 token）
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let acc = KIMI_SCRIPT_PREFIX
    let answerChars = 0
    let reasoningChars = 0
    let reasoningStarted = false
    let tokensUsed: number | undefined
    let gotFirstToken = false
    let finishReason: string | null | undefined

    const finish = (): string => {
      this.log.info(
        `SSE 完成: 正文=${answerChars}字 思考=${reasoningChars}字 finish=${finishReason ?? '-'} tokens=${tokensUsed ?? '-'}`
      )
      if (finishReason === 'length') {
        if (answerChars === 0) {
          throw new Error(
            `Kimi ${model} 的深度思考占满了服务端输出额度，尚未生成剧本正文。请重试。`
          )
        }
        throw new Error(
          `Kimi ${model} 达到服务端输出上限，剧本正文被截断。请重试或缩短视频。`
        )
      }
      if (answerChars === 0) {
        throw new Error(`Kimi ${model} 未返回剧本正文（仅产生了思考内容），请重试。`)
      }
      return acc
    }

    try {
      while (true) {
        this.throwIfAborted(signal)
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 按完整的 SSE 事件边界（空行）切分，最后不完整的部分留到下次
        // 兼容 LF（\n\n）与 CRLF（\r\n\r\n）两种换行，避免 CRLF 服务端整段无法解析
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
                choices?: Array<{
                  delta?: { content?: string; reasoning_content?: string }
                  finish_reason?: string | null
                }>
                usage?: { total_tokens?: number; completion_tokens?: number }
              }
              const choice = data.choices?.[0]
              const reasoningDelta = choice?.delta?.reasoning_content ?? ''
              const delta = choice?.delta?.content ?? ''
              const fr = choice?.finish_reason
              if (fr) finishReason = fr
              if (reasoningDelta) {
                reasoningChars += reasoningDelta.length
                if (!reasoningStarted) {
                  reasoningStarted = true
                  this.log.info('SSE 收到 reasoning_content，Kimi 开始深度思考')
                  cb.onStatus?.('generating', 'Kimi 深度思考中，完成后将开始输出剧本...')
                }
              }
              if (delta) {
                if (!gotFirstToken) {
                  gotFirstToken = true
                  this.log.info('SSE 收到首个 token')
                  if (reasoningStarted) cb.onStatus?.('generating', '深度思考完成，正在生成剧本...')
                }
                acc += delta
                answerChars += delta.length
                cb.onToken?.(acc, delta, tokensUsed)
              }
              const usageTokens = data.usage?.completion_tokens ?? data.usage?.total_tokens
              if (usageTokens) {
                tokensUsed = usageTokens
              }
            } catch {
              // 忽略非 JSON 行（心跳等）
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return finish()
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }
  }
}

function detectMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mkv':
      return 'video/x-matroska'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.avi':
      return 'video/x-msvideo'
    case '.flv':
      return 'video/x-flv'
    case '.wmv':
      return 'video/x-ms-wmv'
    default:
      return 'video/mp4'
  }
}

function explainError(err: any): string {
  const msg = err?.message ?? String(err)
  const code = err?.code ?? ''
  switch (code) {
    case 'ECONNREFUSED':
      return `连接被拒绝 (${code})。检查网络配置。`
    case 'ECONNRESET':
      return `连接被重置 (${code})。可能是代理不稳定。`
    case 'ETIMEDOUT':
      return `连接超时 (${code})。检查网络是否可达。`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `DNS 解析失败 (${code})。检查网络配置。`
  }
  if (msg.includes('API key') || msg.includes('401') || msg.includes('403')) {
    return `认证失败：${msg}。检查 API Key 是否正确。`
  }
  return msg
}
