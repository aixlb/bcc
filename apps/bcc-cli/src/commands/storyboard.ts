/**
 * bcc storyboard <video|projectId> --out <file> [--format xlsx,html]
 * 拆分镜：检测镜头 → 截帧 → 并发分析 → 导出 Excel / HTML。
 * 输入兼收视频路径与 projectId；给 projectId 时分镜落进该项目库，裸视频走临时帧目录。
 */
import { parseArgs } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import type { StoryboardProject, ScriptScene } from '@shared/types'
import {
  runStoryboardOnce,
  generateStoryboardXlsx,
  buildProjectHtml,
  getVideoInfo,
  loadProject,
  createProject,
  getProjectFramesDir,
  writeStoryboardMd,
  readScriptMd,
  parseScript,
} from '@core/index.js'
import { bootstrap } from '../context.js'
import { resolveOutputs, resolveMasterArg, makeProgress, reportOutput, UsageError } from '../output.js'

export async function runStoryboardCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      master: { type: 'string' },
      'data-dir': { type: 'string' },
      'save-project': { type: 'boolean' },
      // 切割方式与参数（缺省读配置 storyboard.cut_method / scene_threshold / smart_*）
      'cut-method': { type: 'string' },
      threshold: { type: 'string' },
      'hard-min': { type: 'string' },
      'hard-ratio': { type: 'string' },
      'min-gap': { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      verbose: { type: 'boolean' },
      'ffmpeg-path': { type: 'string' },
      'ffprobe-path': { type: 'string' },
    },
  })

  // ffmpeg/ffprobe 显式路径 → 注入环境变量（ffmpeg-runtime 解析链第一优先级）
  if (values['ffmpeg-path']) process.env.BCC_FFMPEG_PATH = values['ffmpeg-path']
  if (values['ffprobe-path']) process.env.BCC_FFPROBE_PATH = values['ffprobe-path']

  const input = positionals[0]
  if (!input) {
    throw new UsageError(
      '用法: bcc storyboard <video|projectId> --out <file> [--format xlsx,html] [--cut-method smart|scene] [--threshold 0.3] [--hard-min 5.5] [--hard-ratio 8] [--min-gap 0.3] [--master shanzhiyin]'
    )
  }
  const masterId = resolveMasterArg(values.master)

  if (values['cut-method'] && values['cut-method'] !== 'smart' && values['cut-method'] !== 'scene') {
    throw new UsageError(`--cut-method 只支持 smart 或 scene，收到: ${values['cut-method']}`)
  }
  const numOpt = (name: 'threshold' | 'hard-min' | 'hard-ratio' | 'min-gap'): number | undefined => {
    const raw = values[name]
    if (raw == null) return undefined
    const v = Number(raw)
    if (isNaN(v)) throw new UsageError(`--${name} 需要数字，收到: ${raw}`)
    return v
  }

  const { config } = await bootstrap({ dataDir: values['data-dir'], network: true, verbose: values.verbose })

  let videoPath: string
  let projectId: string | undefined
  let baseName: string
  if (existsSync(input) && statSync(input).isFile()) {
    videoPath = path.resolve(input)
    baseName = path.basename(videoPath).replace(/\.[^.]+$/, '') || '分镜表'
    if (values['save-project']) {
      const p = await createProject({ name: baseName, videoPath })
      projectId = p.id
    }
  } else {
    const proj = await loadProject(input)
    if (!proj) throw new UsageError(`找不到视频文件或项目: ${input}`)
    videoPath = proj.videoPath
    projectId = proj.id
    baseName = proj.name || '分镜表'
  }

  // 帧目录：有项目用项目帧目录（持久化）；裸视频用临时目录，导出后清理
  let framesDir: string
  let tempFrames = false
  if (projectId) {
    framesDir = getProjectFramesDir(projectId)
  } else {
    framesDir = path.join(os.tmpdir(), `bcc-storyboard-${Date.now()}`)
    tempFrames = true
  }

  const sbCfg = config.storyboard
  const progress = makeProgress(!!values.quiet)
  const { shots, framePaths } = await runStoryboardOnce({
    videoPath,
    framesDir,
    prompt: sbCfg.prompt?.trim() || undefined,
    master: masterId,
    cutMethod: (values['cut-method'] as 'smart' | 'scene' | undefined) ?? sbCfg.cut_method,
    threshold: numOpt('threshold') ?? sbCfg.scene_threshold,
    smartParams: {
      hardMin: numOpt('hard-min') ?? sbCfg.smart_hard_min,
      hardRatio: numOpt('hard-ratio') ?? sbCfg.smart_hard_ratio,
      minGap: numOpt('min-gap') ?? sbCfg.smart_min_gap,
    },
    maxShots: sbCfg.max_shots,
    concurrency: sbCfg.concurrency,
    onProgress: (ev) => progress.storyboard(ev),
  })
  progress.done(values.quiet ? undefined : `  分镜完成（${shots.length} 镜）`)

  let durationSec = 0
  try {
    durationSec = (await getVideoInfo(videoPath)).durationSec
  } catch {
    /* duration 仅用于 xlsx 展示，失败无妨 */
  }

  if (projectId) {
    try {
      const sbProject: StoryboardProject = {
        id: projectId,
        videoPath,
        createdAt: Date.now(),
        shots,
        framePaths,
      }
      await writeStoryboardMd(projectId, sbProject)
    } catch (e) {
      process.stderr.write(`  ! 写入项目分镜失败: ${(e as Error).message}\n`)
    }
  }

  try {
    const outputs = resolveOutputs({
      out: values.out,
      format: values.format,
      defaultFormat: 'xlsx',
      defaultName: baseName,
      allowed: ['xlsx', 'html'],
    })

    // HTML 合并视图：若项目里已存在剧本产物，读出来并入，让同一个 HTML 同时带「剧本」「分镜」两个标签页。
    // 仅复用已算好的剧本，不会触发剧本管线（无额外 AI 开销）；裸视频或项目无剧本时退化为只有分镜标签页。
    let mergedScenes: ScriptScene[] = []
    if (projectId && outputs.some((o) => o.format === 'html')) {
      try {
        const md = await readScriptMd(projectId)
        if (md && md.trim()) mergedScenes = parseScript(md)
      } catch {
        /* 读剧本失败不影响分镜导出 */
      }
    }

    for (const { format, outPath } of outputs) {
      await fs.mkdir(path.dirname(outPath), { recursive: true })
      if (format === 'xlsx') {
        await generateStoryboardXlsx(shots, framePaths, outPath, durationSec)
      } else if (format === 'html') {
        const html = await buildProjectHtml({ projectName: baseName, videoPath, scenes: mergedScenes, shots, framePaths })
        await fs.writeFile(outPath, html, 'utf-8')
      }
      reportOutput(outPath, !!values.quiet)
    }
  } finally {
    if (tempFrames) {
      try {
        await fs.rm(framesDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}
