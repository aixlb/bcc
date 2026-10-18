/**
 * 剧本后处理纯函数（供 MiniMax / 自定义 OpenAI 兼容供应商共用）
 *
 * 这些模型多为推理模型，且拿不到采样帧的绝对时间：
 * - 思考内容内联在 content 里用 <think>…</think> 包裹 —— 需剥掉
 * - [HH:MM:SS] 时间戳会整体漂移（可能超出真实时长）—— 按真实时长等比缩放
 */

/** 剥掉所有已闭合的 <think>…</think> 块 */
export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

/**
 * 展示用剥思考：去掉已闭合 think 块，并丢弃尾部「未闭合」的 think（仍在思考中），
 * 这样流式过程中思考阶段显示为空，正文出现后才逐字展示。
 */
export function stripThinkForDisplay(s: string): string {
  let out = s.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const open = out.search(/<think>/i)
  if (open !== -1) out = out.slice(0, open)
  return out.replace(/^\s+/, '')
}

/**
 * 最终结果剥思考：去掉已闭合 think 块，并丢弃尾部「未闭合」的 think。
 * 与 stripThinkForDisplay 同策略（处理未闭合块），但做整体 trim，供落盘/解析使用。
 *
 * 关键：仅用 stripThink（只匹配闭合块）时，若模型在思考阶段被截断（finish_reason=length，
 * 无 </think>），整段推理会被当成正文返回并落盘，且与流式展示（已截掉未闭合 think）不一致。
 */
export function stripThinkComplete(s: string): string {
  let out = s.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const open = out.search(/<think>/i)
  if (open !== -1) out = out.slice(0, open)
  return out.trim()
}

/** 去掉模型偶尔套在整段外层的 ``` / ```markdown 代码围栏 */
export function stripCodeFences(s: string): string {
  let out = s.trim()
  const fence = out.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  if (fence) out = fence[1].trim()
  return out
}

const TS_RE = /\[(\d{1,2}):(\d{2}):(\d{2})\]/g

function tsToSec(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

function secToTs(sec: number): string {
  const v = Math.max(0, Math.round(sec))
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const s = v % 60
  return `[${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`
}

/**
 * 等比缩放剧本中的 [HH:MM:SS]：锚定 0、把最大时间戳压到 durationSec。
 * 仅当最大时间戳明显超出真实时长（> 时长 + 1s）时才缩放；否则原样返回。
 */
export function scaleTimestamps(
  text: string,
  durationSec: number
): { text: string; changed: boolean; factor: number; maxBeforeSec: number; count: number } {
  const matches = [...text.matchAll(TS_RE)]
  const count = matches.length
  if (count === 0 || !isFinite(durationSec) || durationSec <= 0) {
    return { text, changed: false, factor: 1, maxBeforeSec: 0, count }
  }
  let maxSec = 0
  for (const mt of matches) {
    maxSec = Math.max(maxSec, tsToSec(mt[1], mt[2], mt[3]))
  }
  if (maxSec <= durationSec + 1) {
    return { text, changed: false, factor: 1, maxBeforeSec: maxSec, count }
  }
  const factor = durationSec / maxSec
  const out = text.replace(TS_RE, (_m, h, m, s) => secToTs(tsToSec(h, m, s) * factor))
  return { text: out, changed: true, factor, maxBeforeSec: maxSec, count }
}

/** 视频文件扩展名 → MIME */
export function detectVideoMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
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
