/**
 * bcc research <video...> [--input-dir dir] [--project id] --out <file> [--format md,txt] [--name 名称]
 * 风格研究：对多条视频各自拆分镜，再合成《风格指南》。
 * 输入兼收：直接喂多个视频（可叠加 --input-dir 扫目录），或 --project 复用已建研究项目。
 */
import { parseArgs } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { runResearch, createResearch, loadResearch, readStyleGuide } from '@core/index.js'
import { bootstrap } from '../context.js'
import { resolveOutputs, makeProgress, reportOutput, UsageError } from '../output.js'

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi', '.flv', '.wmv', '.m4v'])

async function scanVideos(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name))
    .sort()
}

export async function runResearchCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      'input-dir': { type: 'string' },
      project: { type: 'string' },
      name: { type: 'string' },
      'data-dir': { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      verbose: { type: 'boolean' },
      'ffmpeg-path': { type: 'string' },
      'ffprobe-path': { type: 'string' },
    },
  })

  // ffmpeg/ffprobe 显式路径 → 注入环境变量（ffmpeg-runtime 解析链第一优先级）
  if (values['ffmpeg-path']) process.env.BCC_FFMPEG_PATH = values['ffmpeg-path']
  if (values['ffprobe-path']) process.env.BCC_FFPROBE_PATH = values['ffprobe-path']

  const { config } = await bootstrap({ dataDir: values['data-dir'], network: true, verbose: values.verbose })

  // 确定 researchId：复用已有项目，或由视频集新建
  let researchId: string
  let baseName: string
  if (values.project) {
    const loaded = await loadResearch(values.project)
    if (!loaded) throw new UsageError(`找不到研究项目: ${values.project}`)
    researchId = loaded.meta.id
    baseName = loaded.meta.name || '风格指南'
  } else {
    const videos: string[] = [...positionals.map((p) => path.resolve(p))]
    if (values['input-dir']) {
      const dir = path.resolve(values['input-dir'])
      if (!existsSync(dir)) throw new UsageError(`目录不存在: ${dir}`)
      videos.push(...(await scanVideos(dir)))
    }
    const uniq = [...new Set(videos)]
    if (uniq.length === 0) {
      throw new UsageError('用法: bcc research <video...> [--input-dir dir] --out style.md  （或 --project <id>）')
    }
    for (const v of uniq) {
      if (!existsSync(v)) throw new UsageError(`视频文件不存在: ${v}`)
    }
    baseName = values.name?.trim() || `风格研究_${path.basename(uniq[0]).replace(/\.[^.]+$/, '')}等${uniq.length}条`
    const meta = await createResearch({ name: baseName, videoPaths: uniq })
    researchId = meta.id
    if (!values.quiet) process.stderr.write(`  研究项目已建: ${researchId}（${uniq.length} 条视频）\n`)
  }

  const progress = makeProgress(!!values.quiet)
  const { styleGuide } = await runResearch({
    researchId,
    config,
    onProgress: (ev) => progress.research(ev),
  })
  progress.done(values.quiet ? undefined : `  风格指南合成完成（${styleGuide.length} 字）`)

  // 兜底：若返回为空则从盘读
  const content = styleGuide || (await readStyleGuide(researchId)) || ''

  const outputs = resolveOutputs({
    out: values.out,
    format: values.format,
    defaultFormat: 'md',
    defaultName: baseName,
    allowed: ['md', 'txt'],
  })

  for (const { outPath } of outputs) {
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, content, 'utf-8')
    reportOutput(outPath, !!values.quiet)
  }
}
