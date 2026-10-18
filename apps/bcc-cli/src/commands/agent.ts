/**
 * Agent 模式命令（无模型、本地）：给 harness 内的 Agent 用的「视频处理 + 组装导出」原语。
 *
 *   bcc probe   <video>                视频技术参数 → stdout JSON
 *   bcc shots   <video> [--frames-dir] 切镜（+ 可选逐镜关键帧）→ stdout JSON
 *   bcc master  [--list|<id>]          大师方法论 → stdout 文本（喂给 Agent 自己的模型）
 *   bcc export  script|storyboard      Agent 产出的 剧本md/分镜json → docx/xlsx/html
 *
 * 机器契约与主命令一致：结果（JSON/文本/产物路径）走 stdout，进度与诊断走 stderr，退出码 0/1。
 * 这些命令不读 API Key、不调任何模型——分析由 harness 的 Agent 用自己的模型完成。
 */
import { parseArgs } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { CutMethod, CutParams, ScriptResult, StoryboardShot } from '@shared/types'
import {
  getVideoInfo,
  detectAndCaptureShots,
  listMasters,
  resolveMasterId,
  getScriptMasterAddendum,
  getStoryboardMasterAddendum,
  parseScript,
  generateScriptDocx,
  generateStoryboardXlsx,
  buildProjectHtml,
  extractFrame,
  applyProxyEnv,
} from '@core/index.js'
import { bootstrap } from '../context.js'
import { resolveOutputs, reportOutput, UsageError } from '../output.js'

// ---------- probe ----------

export async function runProbeCommand(argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true })
  const input = positionals[0]
  if (!input || !existsSync(input)) throw new UsageError('用法: bcc probe <video>')

  const { config } = await bootstrap({ network: false })
  applyProxyEnv(config.gemini)

  const videoPath = path.resolve(input)
  const info = await getVideoInfo(videoPath)
  process.stdout.write(JSON.stringify({ ...info, path: videoPath }) + '\n')
}

// ---------- shots ----------

export async function runShotsCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'cut-method': { type: 'string' },
      threshold: { type: 'string' },
      'hard-min': { type: 'string' },
      'hard-ratio': { type: 'string' },
      'min-gap': { type: 'string' },
      'max-shots': { type: 'string' },
      'frames-dir': { type: 'string' },
      'no-frames': { type: 'boolean' },
      'data-dir': { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      'ffmpeg-path': { type: 'string' },
      'ffprobe-path': { type: 'string' },
    },
  })

  const input = positionals[0]
  if (!input || !existsSync(input)) throw new UsageError('用法: bcc shots <video> [--no-frames|--frames-dir DIR] [--cut-method smart|scene] [--max-shots N]')

  if (values['cut-method'] && values['cut-method'] !== 'smart' && values['cut-method'] !== 'scene') {
    throw new UsageError(`--cut-method 只支持 smart 或 scene，收到: ${values['cut-method']}`)
  }
  if (values['ffmpeg-path']) process.env.BCC_FFMPEG_PATH = values['ffmpeg-path']
  if (values['ffprobe-path']) process.env.BCC_FFPROBE_PATH = values['ffprobe-path']

  const videoPath = path.resolve(input)
  const { config } = await bootstrap({ dataDir: values['data-dir'], network: false })
  applyProxyEnv(config.gemini) // 下载 ffmpeg/ffprobe 时尊重配置里的代理
  const sb = config.storyboard
  const num = (name: 'threshold' | 'hard-min' | 'hard-ratio' | 'min-gap' | 'max-shots'): number | undefined => {
    const raw = values[name]
    if (raw == null) return undefined
    const n = parseFloat(raw)
    if (!Number.isFinite(n)) throw new UsageError(`--${name} 需要数字，收到: ${raw}`)
    return n
  }

  const cutParams: CutParams = {
    method: (values['cut-method'] as CutMethod | undefined) ?? sb.cut_method,
    scene_threshold: num('threshold') ?? sb.scene_threshold,
    smart_hard_min: num('hard-min') ?? sb.smart_hard_min,
    smart_hard_ratio: num('hard-ratio') ?? sb.smart_hard_ratio,
    smart_min_gap: num('min-gap') ?? sb.smart_min_gap,
  }
  const maxShots = num('max-shots') ?? sb.max_shots
  // 默认不抽帧（原生视频模型的标准用法：只出镜头边界时间轴）；显式给 --frames-dir 才逐镜抽关键帧
  const noFrames = !!values['no-frames'] || !values['frames-dir']
  const framesDir = values['frames-dir'] ? path.resolve(values['frames-dir']) : undefined

  if (!values.quiet) process.stderr.write(`  切镜方式: ${cutParams.method}（maxShots=${maxShots}，${noFrames ? '不抽帧' : '抽帧'}）\n`)

  const result = await detectAndCaptureShots({
    videoPath,
    framesDir,
    cutParams,
    maxShots,
    log: (msg) => {
      if (!values.quiet) process.stderr.write(`  ${msg}\n`)
    },
  })

  const duration = result.durationSec ?? (await getVideoInfo(videoPath)).durationSec
  const shots = result.detected.map((d, i) => {
    const next = result.detected[i + 1]
    return {
      index: i + 1,
      startSec: round2(d.timestamp),
      endSec: round2(next ? next.timestamp : duration),
      thumbT: d.thumbT != null ? round2(d.thumbT) : undefined,
      score: d.score,
      kind: d.kind,
      frame: framesDir ? result.framePaths[i] : undefined,
    }
  })

  process.stdout.write(
    JSON.stringify({
      video: videoPath,
      durationSec: round2(duration),
      method: cutParams.method,
      framesDir: framesDir ?? null,
      shots,
    }) + '\n'
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------- master ----------

export async function runMasterCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      list: { type: 'boolean' },
      kind: { type: 'string' },
    },
  })

  if (values.list) {
    process.stdout.write(JSON.stringify(listMasters().map((m) => ({ id: m.id, name: m.name }))) + '\n')
    return
  }

  const raw = positionals[0]
  if (!raw) throw new UsageError('用法: bcc master <大师id|名称> [--kind script|storyboard]（--list 查看可用大师）')
  const id = resolveMasterId(raw)
  if (!id) throw new UsageError(`未知大师: ${raw}。可用: ${listMasters().map((m) => `${m.id}（${m.name}）`).join('、')}`)

  const kind = values.kind ?? 'script'
  if (kind !== 'script' && kind !== 'storyboard') {
    throw new UsageError(`--kind 只支持 script 或 storyboard，收到: ${kind}`)
  }
  const addendum = kind === 'script' ? getScriptMasterAddendum(id) : getStoryboardMasterAddendum(id)
  if (!addendum) throw new UsageError(`大师 ${raw} 没有可用的${kind === 'script' ? '剧本' : '分镜'}方法论文档`)
  process.stdout.write(addendum.trimStart() + '\n')
}

// ---------- export ----------

export async function runExportCommand(argv: string[]): Promise<void> {
  const [kind, ...rest] = argv
  if (kind === 'script') return exportScript(rest)
  if (kind === 'storyboard') return exportStoryboard(rest)
  throw new UsageError('用法: bcc export <script|storyboard> --from <文件> --out <文件> [--format a,b]')
}

async function exportScript(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      video: { type: 'string' },
      name: { type: 'string' },
      duration: { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      'ffmpeg-path': { type: 'string' },
      'ffprobe-path': { type: 'string' },
    },
  })
  if (!values.from || !existsSync(values.from)) throw new UsageError('用法: bcc export script --from <剧本.md> --out <out.docx> [--format docx,md,txt,html] [--video 源视频]')
  if (values['ffmpeg-path']) process.env.BCC_FFMPEG_PATH = values['ffmpeg-path']
  if (values['ffprobe-path']) process.env.BCC_FFPROBE_PATH = values['ffprobe-path']

  const { config } = await bootstrap({ network: false })
  applyProxyEnv(config.gemini)

  const text = (await fs.readFile(path.resolve(values.from), 'utf-8')).replace(/^\uFEFF/, '')
  const scenes = parseScript(text)
  const videoPath = values.video && existsSync(values.video) ? path.resolve(values.video) : undefined

  let durationSec = values.duration ? parseFloat(values.duration) : 0
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    durationSec = videoPath ? (await getVideoInfo(videoPath)).durationSec : scenes.length > 0 ? Math.max(...scenes.map((s) => s.startSec)) : 0
  }

  const baseName = values.name?.trim() || path.basename(values.from).replace(/\.[^.]+$/, '') || '剧本'
  const result: ScriptResult = {
    jobId: 'agent',
    videoPath: videoPath ?? '',
    durationSec,
    script: text,
    scenes,
    generatedInMs: 0,
    generatedAt: Date.now(),
  }

  const outputs = resolveOutputs({
    out: values.out,
    format: values.format,
    defaultFormat: 'docx',
    defaultName: baseName,
    allowed: ['docx', 'md', 'txt', 'html'],
  })

  for (const { format, outPath } of outputs) {
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    if (format === 'docx') {
      await fs.writeFile(outPath, await generateScriptDocx(result))
    } else if (format === 'md' || format === 'txt') {
      await fs.writeFile(outPath, text, 'utf-8')
    } else if (format === 'html') {
      const html = await buildProjectHtml({ projectName: baseName, videoPath, scenes, shots: [], framePaths: [] })
      await fs.writeFile(outPath, html, 'utf-8')
    }
    reportOutput(outPath, !!values.quiet)
  }
}

interface AgentShotInput {
  number?: number
  shotType?: string
  angle?: string
  cameraMove?: string
  description?: string
  dialogue?: string
  sound?: string
  timeRange?: string
  startSec?: number
  endSec?: number
  frame?: string
}

async function exportStoryboard(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      video: { type: 'string' },
      name: { type: 'string' },
      duration: { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      'ffmpeg-path': { type: 'string' },
      'ffprobe-path': { type: 'string' },
    },
  })
  if (!values.from || !existsSync(values.from)) throw new UsageError('用法: bcc export storyboard --from <分镜.json> --out <out.xlsx> [--format xlsx,html] [--video 源视频]')
  if (values['ffmpeg-path']) process.env.BCC_FFMPEG_PATH = values['ffmpeg-path']
  if (values['ffprobe-path']) process.env.BCC_FFPROBE_PATH = values['ffprobe-path']

  const { config } = await bootstrap({ network: false })
  applyProxyEnv(config.gemini)

  const raw = JSON.parse((await fs.readFile(path.resolve(values.from), 'utf-8')).replace(/^\uFEFF/, '')) as AgentShotInput[] | { shots?: AgentShotInput[]; durationSec?: number; framePaths?: string[] }
  const inputs = Array.isArray(raw) ? raw : raw.shots ?? []
  if (inputs.length === 0) throw new UsageError('--from 的 JSON 里没有分镜数据（应为数组，或 { shots: [...] }）')

  const videoPath = values.video && existsSync(values.video) ? path.resolve(values.video) : undefined
  let durationSec = !Array.isArray(raw) && raw.durationSec ? raw.durationSec : values.duration ? parseFloat(values.duration) : 0
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    durationSec = videoPath ? (await getVideoInfo(videoPath)).durationSec : inputs.length > 0 ? Math.max(...inputs.map((s) => s.endSec ?? 0)) : 0
  }

  const shots: StoryboardShot[] = inputs.map((s, i) => {
    const startSec = s.startSec ?? 0
    return {
      number: s.number ?? i + 1,
      shotType: s.shotType ?? '',
      angle: s.angle ?? '',
      cameraMove: s.cameraMove ?? '',
      description: s.description ?? '',
      dialogue: s.dialogue ?? '',
      sound: s.sound ?? '',
      timeRange: s.timeRange ?? '',
      startSec,
      endSec: s.endSec ?? (i < inputs.length - 1 ? inputs[i + 1].startSec ?? durationSec : durationSec),
      sceneScore: 0,
    }
  })

  const framePaths = !Array.isArray(raw) && raw.framePaths ? raw.framePaths : inputs.map((s) => s.frame ?? '')

  // 原生视频模式：agent 只给了镜头边界没给关键帧时，若提供了 --video 就自动抽帧嵌进 xlsx/html（模型不看帧，纯产物美化）
  let tempFramesDir: string | null = null
  try {
    if (videoPath && framePaths.some((p) => !p || !existsSync(p))) {
      tempFramesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-sbframes-'))
      for (let i = 0; i < shots.length; i++) {
        if (framePaths[i] && existsSync(framePaths[i])) continue
        const mid = shots[i].startSec + Math.min(0.5, Math.max(0.1, (shots[i].endSec - shots[i].startSec) / 2))
        try {
          framePaths[i] = await extractFrame(videoPath, mid, tempFramesDir)
        } catch {
          framePaths[i] = ''
        }
      }
    }

    const baseName = values.name?.trim() || path.basename(values.from).replace(/\.[^.]+$/, '') || '分镜表'
    const outputs = resolveOutputs({
      out: values.out,
      format: values.format,
      defaultFormat: 'xlsx',
      defaultName: baseName,
      allowed: ['xlsx', 'html'],
    })

    for (const { format, outPath } of outputs) {
      await fs.mkdir(path.dirname(outPath), { recursive: true })
      if (format === 'xlsx') {
        await generateStoryboardXlsx(shots, framePaths, outPath, durationSec)
      } else if (format === 'html') {
        const html = await buildProjectHtml({ projectName: baseName, videoPath, scenes: [], shots, framePaths })
        await fs.writeFile(outPath, html, 'utf-8')
      }
      reportOutput(outPath, !!values.quiet)
    }
  } finally {
    if (tempFramesDir) await fs.rm(tempFramesDir, { recursive: true, force: true }).catch(() => {})
  }
}
