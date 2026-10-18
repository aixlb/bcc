/**
 * Gemini API 服务：上传视频 + 流式生成剧本
 * 使用 @google/genai 官方 SDK (Node)
 */

import {
  FinishReason,
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  type File as GenaiFile,
} from '@google/genai'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { GeminiConfig } from '@shared/types'
import { getProxyResolver } from '../runtime.js'
import { buildScriptPrompt, buildMergePrompt, SCRIPT_SYSTEM_PROMPT } from './prompt.js'
import {
  compressIfNeeded,
  formatHMS,
  needSegmentation,
  segmentVideo,
  type VideoInfo,
} from './video.js'

export interface GenerationCallbacks {
  /** 上传字节进度（0-1） */
  onUploadProgress?: (percent: number) => void
  /** 流式 token 到达，accumulated 是从开始到现在的累计文本；tokensUsed 是当前累计 token 数（来自 usageMetadata.totalTokenCount，可能为空） */
  onToken?: (accumulated: string, delta: string, tokensUsed?: number) => void
  /** 分段进度回调 */
  onSegmentChange?: (currentIndex: number, total: number, label: string) => void
  /** 状态变化 */
  onStatus?: (status: string, message: string) => void
  /** 取消信号 */
  signal?: AbortSignal
}

export class GeminiService {
  private client: GoogleGenAI

  constructor(private config: GeminiConfig) {
    if (!config.api_key) {
      throw new Error('Gemini API Key 未配置，请到设置页填写')
    }
    // SDK 用全局 fetch；我们已在 main 启动 / 配置保存时通过 installGlobalFetch 注入
    // 自定义实现（Electron net.fetch 跟随系统代理，或 undici ProxyAgent 走指定代理）。
    this.client = new GoogleGenAI({ apiKey: config.api_key })
  }

  /** 简单连接测试：列模型 */
  async testConnection(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    try {
      // SDK 的 models.list 返回一个 pager
      const models: string[] = []
      const pager = await this.client.models.list()
      for await (const m of pager) {
        if (m.name) models.push(m.name)
        if (models.length >= 50) break
      }
      return { ok: true, message: `连接成功，发现 ${models.length} 个模型`, models }
    } catch (err: any) {
      return { ok: false, message: explainNetworkError(err) }
    }
  }

  /**
   * 生成剧本（自动判断是否需要分段）
   * @param systemPrompt 覆盖默认剧本系统 prompt（剧本大师注入用）；缺省用 SCRIPT_SYSTEM_PROMPT
   */
  async generateScript(
    videoPath: string,
    videoInfo: VideoInfo,
    callbacks: GenerationCallbacks = {},
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = callbacks

    if (!needSegmentation(videoInfo.durationSec)) {
      callbacks.onStatus?.('preparing', '视频较短，直接处理')
      return this.generateSingle(videoPath, videoInfo, undefined, callbacks, systemPrompt)
    }

    // 长视频分段
    callbacks.onStatus?.('preparing', '视频较长，开始切分...')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'v2s-segs-'))
    try {
      const segs = await segmentVideo(videoPath, videoInfo.durationSec, tmpDir, undefined, signal)
      const results: string[] = []
      for (const seg of segs) {
        this.throwIfAborted(signal)
        callbacks.onSegmentChange?.(
          seg.index,
          seg.total,
          `第${seg.index}段 (${formatHMS(seg.startSec)}-${formatHMS(seg.endSec)})`
        )
        const partResult = await this.generateSingle(
          seg.path,
          { ...videoInfo, path: seg.path, durationSec: seg.endSec - seg.startSec },
          {
            startSec: seg.startSec,
            endSec: seg.endSec,
            index: seg.index,
            total: seg.total,
          },
          callbacks,
          systemPrompt
        )
        results.push(partResult)
      }

      if (results.length === 1) return results[0]

      callbacks.onStatus?.('merging', '合并各段剧本...')
      return await this.mergeSegments(results, callbacks)
    } finally {
      // 清理临时分段文件
      try {
        await fs.rm(tmpDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }

  /** 单段处理 */
  private async generateSingle(
    videoPath: string,
    videoInfo: VideoInfo,
    segmentMeta: { startSec: number; endSec: number; index: number; total: number } | undefined,
    cb: GenerationCallbacks,
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = cb

    // 1. 视频压缩（如有必要）
    cb.onStatus?.('compressing', '准备视频文件...')
    const compressed = await compressIfNeeded(videoPath, 200, undefined, signal)
    const actualPath = compressed.outputPath
    this.throwIfAborted(signal)

    let uploadedFile: GenaiFile | null = null
    try {
      // 2. 上传到 Gemini
      cb.onStatus?.('uploading', `上传视频到 Gemini (${compressed.outputMB.toFixed(1)} MB)...`)
      uploadedFile = await this.uploadFile(actualPath, cb.onUploadProgress)
      this.throwIfAborted(signal)

      // 3. 等待处理 ACTIVE
      cb.onStatus?.('waiting_process', 'Gemini 正在分析视频...')
      uploadedFile = await this.waitForFileActive(uploadedFile, signal)
      this.throwIfAborted(signal)

      // 4. 流式生成
      cb.onStatus?.('generating', '开始生成剧本...')
      const userPrompt = buildScriptPrompt({
        durationSec: videoInfo.durationSec,
        segment: segmentMeta,
      })

      const mediaRes =
        this.config.video_resolution === 'high'
          ? MediaResolution.MEDIA_RESOLUTION_HIGH
          : MediaResolution.MEDIA_RESOLUTION_LOW

      const stream = await this.client.models.generateContentStream({
        model: this.config.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: userPrompt },
              {
                fileData: {
                  fileUri: uploadedFile.uri!,
                  mimeType: uploadedFile.mimeType!,
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction: systemPrompt || SCRIPT_SYSTEM_PROMPT,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          mediaResolution: mediaRes,
        },
      })

      let acc = ''
      let tokensUsed: number | undefined
      let finishReason: FinishReason | undefined
      for await (const chunk of stream) {
        this.throwIfAborted(signal)
        const delta = chunk.text ?? ''
        const t = (chunk as any).usageMetadata?.totalTokenCount
        const reason = chunk.candidates?.[0]?.finishReason
        if (reason) finishReason = reason
        if (typeof t === 'number') tokensUsed = t
        if (delta || t != null) {
          if (delta) acc += delta
          cb.onToken?.(acc, delta, tokensUsed)
        }
      }

      assertGeminiComplete(acc, finishReason)
      return acc
    } finally {
      // 5. 清理上传的文件和压缩的临时文件
      if (uploadedFile?.name) {
        this.client.files.delete({ name: uploadedFile.name }).catch(() => {
          /* ignore */
        })
      }
      if (compressed.compressed && compressed.outputPath !== videoPath) {
        fs.rm(compressed.outputPath, { force: true }).catch(() => {
          /* ignore */
        })
        // 试图清理临时目录
        const tmpDir = path.dirname(compressed.outputPath)
        fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
          /* ignore */
        })
      }
    }
  }

  private async uploadFile(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<GenaiFile> {
    // SDK 的 upload 没有原生进度事件；用文件大小推算的方式给个粗略反馈
    const stat = await fs.stat(filePath)
    onProgress?.(0)

    // SDK uses the basename as X-Goog-Upload-File-Name header (ByteString, ≤0xFF).
    // When the filename has CJK/emoji chars, create a hard-link with an ASCII name.
    const basename = path.basename(filePath)
    const ext = path.extname(filePath).toLowerCase() || '.mp4'
    let actualPath = filePath
    let tmpLink: string | null = null
    if (!/^[\x00-\xFF]*$/.test(basename)) {
      tmpLink = path.join(os.tmpdir(), `v2s_up_${Date.now()}${ext}`)
      try {
        await fs.link(filePath, tmpLink)
      } catch {
        await fs.copyFile(filePath, tmpLink)
      }
      actualPath = tmpLink
    }

    // 启动一个伪进度（基于平均上传时间）以避免界面卡死
    const totalMB = stat.size / (1024 * 1024)
    const estSec = Math.max(5, totalMB / 2) // 假设 2MB/s
    const startTime = Date.now()
    const fakeTimer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000
      let p = elapsed / estSec
      if (p >= 0.95) {
        // 超过估算时间后缓慢增长，每 20 秒增长 1%，最多到 99%
        p = 0.95 + (elapsed - estSec * 0.95) / 20
      }
      p = Math.min(0.99, p)
      onProgress?.(p)
    }, 800)

    try {
      const file = await this.client.files.upload({
        file: actualPath,
        config: {
          mimeType: detectMime(filePath),
        },
      })
      onProgress?.(1)
      return file
    } finally {
      clearInterval(fakeTimer)
      if (tmpLink) fs.unlink(tmpLink).catch(() => {})
    }
  }

  private async waitForFileActive(file: GenaiFile, signal?: AbortSignal): Promise<GenaiFile> {
    let f = file
    while (f.state === 'PROCESSING') {
      this.throwIfAborted(signal)
      await sleep(2000)
      f = await this.client.files.get({ name: f.name! })
    }
    if (f.state !== 'ACTIVE') {
      throw new Error(`视频处理失败: state=${f.state}`)
    }
    return f
  }

  private async mergeSegments(segments: string[], cb: GenerationCallbacks): Promise<string> {
    const prompt = buildMergePrompt(segments)
    const stream = await this.client.models.generateContentStream({
      model: this.config.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SCRIPT_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })

    let acc = ''
    let tokensUsed: number | undefined
    let finishReason: FinishReason | undefined
    for await (const chunk of stream) {
      this.throwIfAborted(cb.signal)
      const delta = chunk.text ?? ''
      const t = (chunk as any).usageMetadata?.totalTokenCount
      const reason = chunk.candidates?.[0]?.finishReason
      if (reason) finishReason = reason
      if (typeof t === 'number') tokensUsed = t
      if (delta || t != null) {
        if (delta) acc += delta
        cb.onToken?.(acc, delta, tokensUsed)
      }
    }
    assertGeminiComplete(acc, finishReason)
    return acc
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }
  }
}

function assertGeminiComplete(text: string, finishReason?: FinishReason): void {
  if (finishReason === FinishReason.MAX_TOKENS) {
    throw new Error('Gemini 达到模型的服务端输出上限，内容被截断，请重试或缩短视频')
  }
  if (finishReason && finishReason !== FinishReason.STOP) {
    throw new Error(`Gemini 生成异常终止 (${finishReason})，未保存不完整内容`)
  }
  if (!text.trim()) throw new Error('Gemini 返回了空内容')
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 把 globalThis.fetch 替换成 npm undici 的 fetch，并按需挂上 ProxyAgent。
 *
 * 为什么不用 Node 内置 fetch？npm 包 undici 和 Node 内置 undici 是两个实例，
 * setGlobalDispatcher 改不到 SDK 实际用的那个 → 代理失效。直接换 globalThis.fetch
 * 为我们手里这版 undici fetch，dispatcher 也是我们设的，链路完全可控。
 *
 * 为什么不用 Electron net.fetch？net.fetch 对流式 body（视频上传走的 multipart）
 * 会抛 ERR_INVALID_ARGUMENT，普通请求 OK 上传就废了。
 *
 * 代理优先级：
 *   1) proxyRaw 非空 → 用它（用户显式指定）
 *   2) 否则用宿主注入的代理解析器（GUI=session.resolveProxy 读 PAC/WPAD/IE；CLI=环境变量）
 *   3) 都没有 → 直连
 */
export async function installGlobalFetch(proxyRaw: string | undefined): Promise<void> {
  let proxyUri = proxyRaw?.trim() || ''

  if (!proxyUri) {
    proxyUri = (await resolveSystemProxy('https://generativelanguage.googleapis.com')) ?? ''
  }

  if (proxyUri) {
    const dispatcher = new ProxyAgent({ uri: proxyUri })
    globalThis.fetch = ((input: any, init?: any) =>
      undiciFetch(input, { ...(init ?? {}), dispatcher })) as unknown as typeof fetch
    console.log('[fetch] 走代理:', proxyUri)
  } else {
    globalThis.fetch = undiciFetch as unknown as typeof fetch
    console.log('[fetch] 直连')
  }
}

/**
 * 查询系统代理。优先用宿主注入的解析器（GUI = Electron session.resolveProxy，读 PAC/WPAD/IE），
 * 未注入（如纯 Node CLI）则回退环境变量 HTTPS_PROXY / HTTP_PROXY。返回 undici 可识别的 URL 或 null。
 */
async function resolveSystemProxy(url: string): Promise<string | null> {
  const resolver = getProxyResolver()
  if (resolver) {
    try {
      const resolved = await resolver(url)
      if (resolved) return resolved
    } catch (err) {
      console.warn('[fetch] 注入的系统代理解析失败:', err)
    }
  }
  // 无注入解析器（CLI / 测试）→ 回退环境变量
  const env = (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  ).trim()
  return env || null
}

/**
 * 把网络错误翻译成对用户更有帮助的中文提示
 */
function explainNetworkError(err: any): string {
  const msg = err?.message ?? String(err)
  const causeMsg = err?.cause?.message ?? ''
  const code = err?.cause?.code ?? err?.code ?? ''

  // undici / Node fetch 常见错误码
  switch (code) {
    case 'ECONNREFUSED':
      return `连接被拒绝 (${causeMsg || code})。如果配置了代理，确认本地代理软件正在运行；如果没配代理但需要翻墙访问 Google，请到设置页填写代理。`
    case 'ECONNRESET':
      return `连接被重置 (${code})。可能是代理软件不稳定，或网络受限。`
    case 'ETIMEDOUT':
      return `连接超时 (${code})。检查代理是否能访问 generativelanguage.googleapis.com。`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `DNS 解析失败 (${code} ${causeMsg})。检查网络/代理配置。`
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `TLS 证书校验失败 (${code})。代理可能在做 MITM。`
  }

  // API key 等业务错误
  if (msg.includes('API key') || msg.includes('API_KEY') || msg.includes('401') || msg.includes('403')) {
    return `认证失败：${msg}。检查 API Key 是否正确。`
  }

  // fetch failed 的通用兜底——把 cause 拼出来
  if (msg === 'fetch failed' || msg.includes('fetch failed')) {
    return `网络请求失败：${causeMsg || code || '未知原因'}。如果在中国大陆，需要先在设置页配置代理（如 http://127.0.0.1:7890）。`
  }

  return causeMsg ? `${msg} (${causeMsg})` : msg
}
