/**
 * CLI 输出工具：--out / --format 解析、进度打印、产物落盘提示。
 *
 * 约定：进度走 stderr（可被 --quiet 静默），最终产物路径走 stdout（便于管道/脚本捕获）。
 */
import path from 'node:path'
import { listMasters } from '@core/index.js'

export class UsageError extends Error {}

/**
 * 解析 --master 参数（接受内置大师的 id 或中文名）：
 * - 未传 → undefined（跟随配置 script_master）
 * - 'default'/'默认'/空串 → ''（本次明确用默认）
 * - 未知值 → UsageError，列出可选项
 */
export function resolveMasterArg(input: string | undefined): string | undefined {
  if (input == null) return undefined
  const t = input.trim()
  if (!t || t === 'default' || t === '默认') return ''
  const masters = listMasters()
  const found = masters.find((m) => m.id === t || m.name === t)
  if (!found) {
    const options = ['default（默认）', ...masters.map((m) => `${m.id}（${m.name}）`)].join('、')
    throw new UsageError(`--master 不支持: ${input}。可选: ${options}`)
  }
  return found.id
}

export interface ResolveOutputsArgs {
  out?: string
  format?: string
  defaultFormat: string
  defaultName: string
  allowed: string[]
}

export interface OutputTarget {
  format: string
  outPath: string
}

/**
 * 解析输出目标：扩展名推断为主 + --format 批量。
 * - `--out x.docx`             → [{docx, x.docx}]
 * - `--out ./dir --format a,b` → [{a, dir/<name>.a}, {b, dir/<name>.b}]
 * - 无 --out 无 --format       → [{defaultFormat, ./<name>.<defaultFormat>}]
 */
export function resolveOutputs(args: ResolveOutputsArgs): OutputTarget[] {
  const allowed = new Set(args.allowed)
  const out = args.out
  const outExt = out ? path.extname(out).slice(1).toLowerCase() : ''

  let formats: string[] = []
  if (args.format) {
    formats = args.format
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  }
  if (formats.length === 0) {
    formats = outExt ? [outExt] : [args.defaultFormat]
  }
  for (const f of formats) {
    if (!allowed.has(f)) {
      throw new UsageError(`不支持的输出格式: ${f}（该命令支持: ${args.allowed.join(', ')}）`)
    }
  }

  let outDir: string
  let baseName: string
  if (out && outExt) {
    outDir = path.dirname(out)
    baseName = path.basename(out, path.extname(out))
  } else if (out) {
    outDir = out
    baseName = args.defaultName
  } else {
    outDir = process.cwd()
    baseName = args.defaultName
  }

  return formats.map((format) => {
    // 单格式且 --out 正好是该扩展名的文件 → 用 --out 原样
    if (out && outExt && formats.length === 1 && outExt === format) {
      return { format, outPath: path.resolve(out) }
    }
    return { format, outPath: path.resolve(outDir, `${baseName}.${format}`) }
  })
}

/** 一行内刷新的进度打印（写 stderr，不污染 stdout 的产物路径）。用空格补齐清除残留，避免 ANSI 转义。 */
export function makeProgress(quiet: boolean) {
  let lastLen = 0
  const write = (line: string) => {
    if (quiet) return
    const pad = line.length < lastLen ? ' '.repeat(lastLen - line.length) : ''
    lastLen = line.length
    process.stderr.write('\r' + line + pad)
  }
  const pct = (p: number) => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`
  return {
    script: (ev: { status: string; progress: number; message: string }) =>
      write(`  [${ev.status}] ${pct(ev.progress)} ${ev.message}`),
    storyboard: (ev: { phase: string; current?: number; total?: number; message: string }) =>
      write(`  [${ev.phase}] ${ev.current ?? ''}${ev.total ? '/' + ev.total : ''} ${ev.message}`),
    research: (ev: { status: string; progress: number; message: string }) =>
      write(`  [${ev.status}] ${pct(ev.progress)} ${ev.message}`),
    done: (msg?: string) => {
      if (quiet) return
      if (lastLen) process.stderr.write('\r' + ' '.repeat(lastLen) + '\r')
      lastLen = 0
      if (msg) process.stderr.write(msg + '\n')
    },
  }
}

/** 产物落盘提示：路径走 stdout，人类提示走 stderr */
export function reportOutput(outPath: string, quiet: boolean): void {
  if (!quiet) process.stderr.write(`  -> 已写入 ${outPath}\n`)
  process.stdout.write(outPath + '\n')
}
