/**
 * MiniMax API 服务：上传视频 → 引用文件 ID 生成剧本
 * 使用 MiniMax OpenAI 兼容（MiniMax-M3 多模态）接口
 *
 * 流程（参考 platform.minimaxi.com/docs）：
 * 1. 压缩到上传上限以内
 * 2. POST /v1/files/upload（multipart，purpose=video_understanding）—— 同步返回 file_id（7 天有效）
 * 3. POST /v1/chat/completions，用 { type: 'video_url', video_url: { url: 'mm_file://{file_id}' } } 引用视频
 *    —— 视频必须走 video_url（image_url 仅支持静态图片）
 * 4. 解析 SSE 流式响应
 *
 * ⚠️ M3 是推理模型，思考内容内联在 content 里用 <think>…</think> 包裹（OpenAI 兼容口不走
 *    reasoning_content）。需剥掉 <think> 块；正式生成不设置应用级 token 上限。
 *
 * ⚠️ M3 拿不到采样帧的绝对时间，[HH:MM:SS] 会整体漂移（可能超出真实时长）。这里在拿到全文后
 *    按真实时长对时间戳做等比缩放（锚定 0、把最大时间戳压到时长），保证剧本-视频同步可用。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { MinimaxConfig } from '@shared/types'
import { buildScriptPrompt, SCRIPT_SYSTEM_PROMPT } from './prompt.js'
import { compressIfNeeded, formatBytes, type VideoInfo } from './video.js'
import { fetchWithOverloadRetry } from './http-retry.js'
import { createLogger, safeStringify, NOOP_LOGGER, type DebugLogger } from './logger.js'
import {
  detectVideoMime,
  scaleTimestamps,
  stripCodeFences,
  stripThinkComplete,
  stripThinkForDisplay,
} from './script-postprocess.js'

/** 上传前压缩目标（MB）。MiniMax 未公开精确上限，取保守值，超限交由 API 报错 */
const MINIMAX_MAX_UPLOAD_MB = 95

export interface GenerationCallbacks {
  onUploadProgress?: (percent: number) => void
  onToken?: (accumulated: string, delta: string, tokensUsed?: number) => void
  onSegmentChange?: (currentIndex: number, total: number, label: string) => void
  onStatus?: (status: string, message: string) => void
  signal?: AbortSignal
}

interface MinimaxUploadResp {
  file?: {
    file_id?: number | string
    bytes?: number
    created_at?: number
    filename?: string
    purpose?: string
  }
  base_resp?: { status_code?: number; status_msg?: string }
}

export class MinimaxService {
  private baseUrl: string
  private log: DebugLogger = NOOP_LOGGER

  constructor(private config: MinimaxConfig) {
    if (!config.api_key) {
      throw new Error('MiniMax API Key 未配置，请到设置页填写')
    }
    this.baseUrl = (config.base_url || 'https://api.minimaxi.com/v1').replace(/\/$/, '')
  }

  async testConnection(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    try {
      // MiniMax 无标准 /models 列表接口，用一次极小的 chat 请求探活
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.api_key}`,
        },
        body: JSON.stringify({
          model: this.config.model || 'MiniMax-M3',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      })
      const text = await resp.text().catch(() => '')
      if (!resp.ok) {
        return { ok: false, message: `连接失败 (${resp.status}): ${text.slice(0, 200)}` }
      }
      // 鉴权失败时 HTTP 仍可能 200，错误在 base_resp 里
      try {
        const json = JSON.parse(text) as MinimaxUploadResp
        const code = json.base_resp?.status_code
        if (code && code !== 0) {
          return { ok: false, message: `连接失败: ${json.base_resp?.status_msg || code}` }
        }
      } catch {
        /* 非 JSON 也视为可达 */
      }
      return { ok: true, message: `连接成功（${this.config.model || 'MiniMax-M3'}）` }
    } catch (err: any) {
      return { ok: false, message: explainError(err) }
    }
  }

  /** 生成剧本：上传视频 → 流式生成 → 剥思考 + 等比缩放时间戳 */
  async generateScript(
    videoPath: string,
    videoInfo: VideoInfo,
    callbacks: GenerationCallbacks = {},
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = callbacks

    this.log = createLogger('minimax', String(Date.now()))
    this.log.info(
      `=== MiniMax 生成剧本 === model=${this.config.model || 'MiniMax-M3'} baseUrl=${this.baseUrl} ` +
        `video=${path.basename(videoPath)} size=${formatBytes(videoInfo.sizeBytes)} ` +
        `dur=${videoInfo.durationSec.toFixed(0)}s ${videoInfo.width}x${videoInfo.height}`
    )
    if (this.log.filePath) callbacks.onStatus?.('preparing', `诊断日志: ${this.log.filePath}`)

    let fileId: string | null = null
    let compressed: Awaited<ReturnType<typeof compressIfNeeded>> | null = null
    try {
      // 1. 压缩视频（保守压到上限内，超限交由 API 报错）
      callbacks.onStatus?.('compressing', `准备视频文件 (${formatBytes(videoInfo.sizeBytes)})...`)
      compressed = await compressIfNeeded(videoPath, MINIMAX_MAX_UPLOAD_MB, undefined, signal)
      this.throwIfAborted(signal)
      this.log.info(
        `压缩: compressed=${compressed.compressed} ${compressed.originalMB.toFixed(1)}MB -> ${compressed.outputMB.toFixed(1)}MB`
      )

      // 2. 上传视频到 MiniMax（purpose=video_understanding）
      callbacks.onStatus?.('uploading', `上传视频到 MiniMax (${compressed.outputMB.toFixed(1)} MB)...`)
      fileId = await this.uploadFile(compressed.outputPath, signal, callbacks.onUploadProgress)
      this.throwIfAborted(signal)
      callbacks.onStatus?.('waiting_process', `已上传 (file_id=${fileId})`)

      // 3. 流式生成
      callbacks.onStatus?.('generating', '开始生成剧本...')
      const userPrompt = buildScriptPrompt({ durationSec: videoInfo.durationSec })
      const raw = await this.streamChat(userPrompt, fileId, callbacks, systemPrompt)

      // 4. 剥掉 <think> 思考块（含被截断的未闭合块）+ 去掉外层 ``` 代码围栏
      let script = stripThinkComplete(raw)
      script = stripCodeFences(script)
      // 思考被截断（无 </think>）时整段推理会被剥成空 → 明确报错，不落盘残缺/空内容
      if (!script.trim()) {
        throw new Error('生成被中断：模型在思考阶段被截断，未产出有效剧本，请重试')
      }

      // 5. 等比缩放时间戳到真实时长（M3 时间戳会漂移）
      const scaled = scaleTimestamps(script, videoInfo.durationSec)
      if (scaled.changed) {
        this.log.info(
          `时间戳等比缩放: 最大 ${scaled.maxBeforeSec.toFixed(0)}s -> 时长 ${videoInfo.durationSec.toFixed(0)}s ` +
            `(factor=${scaled.factor.toFixed(3)}, 共 ${scaled.count} 个)`
        )
      } else {
        this.log.info(`时间戳无需缩放（最大 ${scaled.maxBeforeSec.toFixed(0)}s ≤ 时长 ${videoInfo.durationSec.toFixed(0)}s）`)
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
      // 6. 清理：删除上传文件（尽力而为，7 天自动过期）+ 压缩临时文件
      if (fileId) {
        this.deleteFile(fileId).catch(() => {
          /* ignore */
        })
      }
      if (compressed && compressed.compressed && compressed.outputPath !== videoPath) {
        fs.rm(compressed.outputPath, { force: true }).catch(() => {})
        fs.rm(path.dirname(compressed.outputPath), { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  /** 上传文件到 MiniMax，返回 file_id */
  private async uploadFile(
    filePath: string,
    signal?: AbortSignal,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    const stat = await fs.stat(filePath)
    const rawName = path.basename(filePath)
    const ext = path.extname(rawName).toLowerCase() || '.mp4'
    // FormData filename 必须是 ByteString（每字符 ≤0xFF）；含 CJK/emoji 时回退
    const safeFileName = /^[\x00-\xFF]+$/.test(rawName) ? rawName : `upload${ext}`
    const mime = detectVideoMime(filePath)
    const fileBuffer = await fs.readFile(filePath)
    const blob = new Blob([fileBuffer], { type: mime })

    const form = new FormData()
    form.append('purpose', 'video_understanding')
    form.append('file', blob, safeFileName)

    onProgress?.(0)
    // 伪进度（上传无原生进度事件）
    const totalMB = stat.size / (1024 * 1024)
    const estSec = Math.max(5, totalMB / 2)
    const startTime = Date.now()
    const fakeTimer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000
      let p = elapsed / estSec
      if (p >= 0.95) p = 0.95 + (elapsed - estSec * 0.95) / 20
      p = Math.min(0.99, p)
      onProgress?.(p)
    }, 800)

    this.log.info(
      `上传请求: POST ${this.baseUrl}/files/upload purpose=video_understanding name=${safeFileName} mime=${mime} size=${formatBytes(stat.size)}`
    )
    try {
      const resp = await fetch(`${this.baseUrl}/files/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.api_key}` },
        body: form,
        signal,
      })
      onProgress?.(1)

      const text = await resp.text().catch(() => '')
      if (!resp.ok) {
        this.log.error(`上传失败 HTTP ${resp.status}: ${text.slice(0, 1000)}`)
        throw new Error(`文件上传失败 (${resp.status}): ${text.slice(0, 300)}`)
      }

      let json: MinimaxUploadResp
      try {
        json = JSON.parse(text) as MinimaxUploadResp
      } catch {
        this.log.error(`上传响应非 JSON: ${text.slice(0, 500)}`)
        throw new Error('上传响应解析失败')
      }
      this.log.info(`上传响应: ${safeStringify(json)}`)

      const code = json.base_resp?.status_code
      if (code !== undefined && code !== 0) {
        throw new Error(`上传失败: ${json.base_resp?.status_msg || `status_code=${code}`}`)
      }
      const fileId = json.file?.file_id
      if (fileId === undefined || fileId === null || fileId === '') {
        throw new Error('上传成功但未返回 file_id')
      }
      return String(fileId)
    } finally {
      clearInterval(fakeTimer)
    }
  }

  /** 删除上传的文件（尽力而为） */
  private async deleteFile(fileId: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/files/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.api_key}`,
      },
      body: JSON.stringify({ file_id: Number(fileId) || fileId, purpose: 'video_understanding' }),
    })
    if (!resp.ok) {
      console.warn(`[MiniMax] 删除文件 ${fileId} 失败:`, resp.status)
    }
  }

  /** 流式调用 Chat Completions，返回原始全文（含 <think>） */
  private async streamChat(
    prompt: string,
    fileId: string,
    cb: GenerationCallbacks,
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = cb
    const url = `${this.baseUrl}/chat/completions`
    const body = {
      model: this.config.model || 'MiniMax-M3',
      messages: [
        { role: 'system', content: systemPrompt || SCRIPT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            // 视频必须用 video_url（mm_file://{file_id} 引用已上传文件）
            { type: 'video_url', video_url: { url: `mm_file://${fileId}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
    }

    this.log.info(
      `对话请求: POST ${url} model=${body.model} video_url=mm_file://${fileId} ` +
        `prompt=${prompt.length}字 output_limit=provider-default`
    )
    // 服务端过载（429/5xx）自动退避重试：文件已上传，重发对话请求成本极低
    const resp = await fetchWithOverloadRetry({
      label: 'MiniMax API',
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
      throw new Error('MiniMax API 返回了空的响应体')
    }
    this.log.info(`对话响应: HTTP ${resp.status}，开始读取 SSE 流`)

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let raw = '' // 原始全文（含 <think>）
    let tokensUsed: number | undefined
    let gotFirstToken = false
    let finishReason: string | null | undefined

    const finish = (): string => {
      this.log.info(`SSE 完成: ${raw.length}字 finish=${finishReason ?? '-'} tokens=${tokensUsed ?? '-'}`)
      if (finishReason === 'length') {
        throw new Error('MiniMax 达到服务端输出上限，剧本被截断，请重试或缩短视频')
      }
      if (!raw.trim()) throw new Error('MiniMax 返回了空内容')
      return raw
    }

    try {
      while (true) {
        this.throwIfAborted(signal)
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
                choices?: Array<{
                  delta?: { content?: string }
                  finish_reason?: string | null
                }>
                usage?: { total_tokens?: number }
                base_resp?: { status_code?: number; status_msg?: string }
              }
              if (data.base_resp && data.base_resp.status_code) {
                throw new Error(`MiniMax 流内错误: ${data.base_resp.status_msg || data.base_resp.status_code}`)
              }
              const delta = data.choices?.[0]?.delta?.content ?? ''
              const fr = data.choices?.[0]?.finish_reason
              if (fr) finishReason = fr
              if (delta) {
                if (!gotFirstToken) {
                  gotFirstToken = true
                  this.log.info('SSE 收到首个 token')
                }
                raw += delta
                // 展示用：剥掉（含未闭合的）思考块，思考阶段显示为空，答案出现后才流式展示
                cb.onToken?.(stripThinkForDisplay(raw), delta, tokensUsed)
              }
              if (data.usage?.total_tokens) tokensUsed = data.usage.total_tokens
            } catch (e: any) {
              // base_resp 错误要抛出；其余非 JSON 行（心跳等）忽略
              if (e instanceof Error && e.message.startsWith('MiniMax 流内错误')) throw e
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
