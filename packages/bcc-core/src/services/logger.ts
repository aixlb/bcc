/**
 * 轻量诊断日志：同时写入控制台和 数据目录/logs/<scope>-<id>.log
 *
 * 用于排查 Kimi / Gemini 等外部 API 的真实请求/响应。日志文件随数据目录走，
 * 用户可直接打开「项目文件夹」上层的 logs/ 取走整份日志发回分析。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getDataRoot } from './paths.js'

export interface DebugLogger {
  /** 日志文件绝对路径 */
  readonly filePath: string
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

/** 不写盘的空 logger（默认值，避免到处判空） */
export const NOOP_LOGGER: DebugLogger = {
  filePath: '',
  info() {},
  warn() {},
  error() {},
}

function ts(): string {
  // 本地时间，精确到毫秒，方便和 UI 上的时间戳对齐
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/**
 * 创建一个写文件的 logger。scope 如 'kimi'，id 用于区分单次作业。
 * 出错（目录不可写等）时静默降级为只打控制台。
 */
export function createLogger(scope: string, id: string): DebugLogger {
  let filePath = ''
  try {
    const dir = path.join(getDataRoot(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    filePath = path.join(dir, `${scope}-${id}.log`)
  } catch (err) {
    console.warn(`[${scope}] 无法创建日志目录，降级为仅控制台:`, err)
  }

  const write = (level: string, msg: string) => {
    const line = `[${ts()}] [${level}] ${msg}`
    console.log(`[${scope}] ${msg}`)
    if (filePath) {
      try {
        fs.appendFileSync(filePath, line + '\n')
      } catch {
        /* 写盘失败不影响主流程 */
      }
    }
  }

  return {
    get filePath() {
      return filePath
    },
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
  }
}

/** 把任意值安全地转成可记录的字符串（截断超长内容） */
export function safeStringify(value: unknown, maxLen = 2000): string {
  let s: string
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    s = String(value)
  }
  if (s.length > maxLen) return s.slice(0, maxLen) + `…(截断, 共${s.length}字符)`
  return s
}
