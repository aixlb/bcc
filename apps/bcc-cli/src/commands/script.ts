/**
 * bcc script <video|projectId> --out <file> [--format docx,md,txt,html]
 * 拆剧本：探测视频 → 按配置选 provider 流式生成剧本 → 导出。
 * 输入兼收视频路径与已存在的 projectId；--save-project 把裸视频也建成项目入库。
 */
import { parseArgs } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import type { ScriptResult, StoryboardShot } from '@shared/types'
import {
  runScript,
  generateScriptDocx,
  buildProjectHtml,
  createProject,
  loadProject,
  writeScriptMd,
  readStoryboard,
} from '@core/index.js'
import { bootstrap } from '../context.js'
import { resolveOutputs, resolveMasterArg, makeProgress, reportOutput, UsageError } from '../output.js'

export async function runScriptCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      master: { type: 'string' },
      'data-dir': { type: 'string' },
      'save-project': { type: 'boolean' },
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
    throw new UsageError('用法: bcc script <video|projectId> --out <file> [--format docx,md,txt,html] [--master shanzhiyin]')
  }
  const masterId = resolveMasterArg(values.master)

  const { config } = await bootstrap({ dataDir: values['data-dir'], network: true, verbose: values.verbose })

  // 解析输入：文件 → 视频；否则按 projectId
  let videoPath: string
  let projectId: string | undefined
  let baseName: string
  if (existsSync(input) && statSync(input).isFile()) {
    videoPath = path.resolve(input)
    baseName = path.basename(videoPath).replace(/\.[^.]+$/, '') || '剧本'
    if (values['save-project']) {
      const p = await createProject({ name: baseName, videoPath })
      projectId = p.id
    }
  } else {
    const proj = await loadProject(input)
    if (!proj) throw new UsageError(`找不到视频文件或项目: ${input}`)
    videoPath = proj.videoPath
    projectId = proj.id
    baseName = proj.name || '剧本'
  }

  const progress = makeProgress(!!values.quiet)
  const result = await runScript({
    videoPath,
    config,
    masterId,
    onProgress: (ev) => progress.script(ev),
  })
  progress.done(values.quiet ? undefined : `  剧本生成完成（${result.scenes.length} 场，${result.script.length} 字）`)

  if (projectId) {
    try {
      await writeScriptMd(projectId, result.script)
    } catch (e) {
      process.stderr.write(`  ! 写入项目 script.md 失败: ${(e as Error).message}\n`)
    }
  }

  const scriptResult: ScriptResult = {
    jobId: 'cli',
    videoPath,
    durationSec: result.durationSec,
    script: result.script,
    scenes: result.scenes,
    generatedInMs: result.generatedInMs,
    generatedAt: Date.now(),
  }

  const outputs = resolveOutputs({
    out: values.out,
    format: values.format,
    defaultFormat: 'docx',
    defaultName: baseName,
    allowed: ['docx', 'md', 'txt', 'html'],
  })

  // HTML 合并视图：若项目里已存在分镜产物，读出来并入，让同一个 HTML 同时带「剧本」「分镜」两个标签页。
  // 仅复用已算好的分镜，不会触发分镜管线（无额外 AI 开销）；裸视频或项目无分镜时退化为只有剧本标签页。
  let mergedShots: StoryboardShot[] = []
  let mergedFramePaths: string[] = []
  if (projectId && outputs.some((o) => o.format === 'html')) {
    try {
      const sb = await readStoryboard(projectId)
      if (sb) {
        mergedShots = sb.shots
        mergedFramePaths = sb.framePaths
      }
    } catch {
      /* 读分镜失败不影响剧本导出 */
    }
  }

  for (const { format, outPath } of outputs) {
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    if (format === 'docx') {
      await fs.writeFile(outPath, await generateScriptDocx(scriptResult))
    } else if (format === 'md' || format === 'txt') {
      await fs.writeFile(outPath, result.script, 'utf-8')
    } else if (format === 'html') {
      const html = await buildProjectHtml({
        projectName: baseName,
        videoPath,
        scenes: result.scenes,
        shots: mergedShots,
        framePaths: mergedFramePaths,
      })
      await fs.writeFile(outPath, html, 'utf-8')
    }
    reportOutput(outPath, !!values.quiet)
  }
}
