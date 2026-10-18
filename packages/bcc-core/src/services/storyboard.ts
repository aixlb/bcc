/**
 * 分镜表核心服务：镜头检测、截图、图片理解、Excel 生成
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import readline from 'node:readline'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { ensureFfmpegBinaries } from './ffmpeg-runtime.js'
import type { SceneScorePoint, StoryboardShot } from '@shared/types'
import exceljsPkg, { type Anchor } from 'exceljs'
const { Workbook } = exceljsPkg

/** 解析一次 ffmpeg 路径（供 smart-cut 等模块复用） */
export async function getFfmpegBin(): Promise<string> {
  return (await ensureFfmpegBinaries()).ffmpeg
}

export interface StoryboardCallbacks {
  onStatus?: (status: string, message: string) => void
  onProgress?: (current: number, total: number) => void
  onShotAnalyzed?: (shot: StoryboardShot) => void
  signal?: AbortSignal
}

export interface DetectedShot {
  timestamp: number
  score: number
  /** 截图/识别取帧时间（smart 方式已避开转场白/黑帧；缺省用 timestamp） */
  thumbT?: number
  /** smart 方式该镜起始点的类型（hard/blank/front/dissolve/sample） */
  kind?: string
}

/** 镜头切分参数 */
export interface DetectParams {
  /** 切点判定阈值：每帧 scene 差异值 > 此值即判为切点（0~1） */
  threshold: number
  maxShots: number
}

/**
 * 镜头切换点检测（每帧差异值阈值法）：
 * 用 ffmpeg scene 算法拿到每帧与上一帧的差异值，差异值超过阈值的帧即为切点。
 * 用 metadata=print 只打印超阈值帧，stdout 量小、无需整段缓存。
 * 检测不到（或太少）时由 postProcessShots 退化为均匀补帧，保证分镜总能拆出来。
 */
export async function detectShots(
  videoPath: string,
  params: DetectParams,
  signal?: AbortSignal
): Promise<DetectedShot[]> {
  console.log(`[storyboard] detectShots: threshold=${params.threshold} maxShots=${params.maxShots}`)
  const raw = await detectShotsWithMetadata(videoPath, params.threshold, signal)
  // 与曲线路径(derivePeakCuts)对齐：同一过渡里连续多帧过阈，合并成峰值一帧，避免渐变/快切被拆成多刀
  const merged = mergeAdjacentCuts(raw, ADJACENT_CUT_GAP_SEC)
  return postProcessShots(merged, params.maxShots, videoPath)
}

/** 同一镜头切换里相邻多帧都过阈时，合并到峰值帧所用的最小时间间隔（秒） */
const ADJACENT_CUT_GAP_SEC = 0.2

/**
 * 合并相邻切点：按时间排序后，相邻两帧间隔 < gapSec 视为同一过渡，整簇只保留 score 最高的一帧。
 * detectShotsWithMetadata 只产出「过阈帧」，相邻过阈帧即同一过渡，合并后与 derivePeakCuts 等效。
 */
function mergeAdjacentCuts(shots: DetectedShot[], gapSec: number): DetectedShot[] {
  if (shots.length <= 1) return shots
  const sorted = [...shots].sort((a, b) => a.timestamp - b.timestamp)
  const out: DetectedShot[] = []
  let best = sorted[0]
  let prevTs = sorted[0].timestamp
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur.timestamp - prevTs < gapSec) {
      if (cur.score > best.score) best = cur // 同一簇：留分数更高的帧
    } else {
      out.push(best)
      best = cur
    }
    prevTs = cur.timestamp
  }
  out.push(best)
  return out
}

/**
 * 整段解码一遍，同时拿到「镜头切点」和「每帧差异值曲线」（单视频项目用）。
 * 曲线就是 ffmpeg 每帧 scene 差异值，越过阈值处即切点，便于直接排查/调参。
 * 失败时抛错，让调用方回退到 detectShots（单帧阈值法，stdout 量更小）。
 */
export async function detectShotsWithSeries(
  videoPath: string,
  params: DetectParams,
  signal?: AbortSignal
): Promise<{ shots: DetectedShot[]; series: SceneScorePoint[] }> {
  const points = await collectScenePoints(videoPath, signal)
  console.log(`[storyboard] detectShotsWithSeries: ${points.length} raw points`)
  // 空说明这趟 ffmpeg 没产出（失败/解析异常）→ 抛错，让调用方回退到 detectShots
  if (points.length === 0) throw new Error('scene 序列为空')

  const shots = await postProcessShots(derivePeakCuts(points, params.threshold), params.maxShots, videoPath)
  const series = downsampleSeries(points, SCENE_SERIES_MAX_POINTS)
  return { shots, series }
}

/**
 * 从每帧差异值序列里取切点：差异值 ≥ 阈值的每个连续区段记一个切点，
 * 落在该区段差异值的峰值帧（硬切是单帧尖峰；连续几帧都过阈则取最高的一帧，避免一刀拆成多刀）。
 */
function derivePeakCuts(points: SceneScorePoint[], threshold: number): DetectedShot[] {
  const cuts: DetectedShot[] = []
  let inZone = false
  let peakIdx = -1
  for (let i = 0; i < points.length; i++) {
    if (points[i].score >= threshold) {
      if (!inZone) {
        inZone = true
        peakIdx = i
      } else if (points[i].score > points[peakIdx].score) {
        peakIdx = i
      }
    } else if (inZone) {
      cuts.push({ timestamp: points[peakIdx].t, score: points[peakIdx].score })
      inZone = false
      peakIdx = -1
    }
  }
  if (inZone && peakIdx >= 0) {
    cuts.push({ timestamp: points[peakIdx].t, score: points[peakIdx].score })
  }
  return cuts
}

/** detectShots 的后处理：太少时均匀补帧、补第一帧、去重、按分数截断到 maxShots */
async function postProcessShots(
  shots: DetectedShot[],
  maxShots: number,
  videoPath: string
): Promise<DetectedShot[]> {
  // 如果检测到的镜头太少，用固定间隔补充
  if (shots.length < 2) {
    console.log(`[storyboard] too few shots detected, falling back to uniform sampling`)
    const duration = await getDuration(videoPath)
    console.log(`[storyboard] video duration=${duration}s`)
    const count = Math.min(maxShots, 60)
    const interval = duration / count
    const fallback: DetectedShot[] = [{ timestamp: 0, score: 0 }]
    for (let t = interval; t < duration; t += interval) {
      fallback.push({ timestamp: t, score: 0 })
    }
    return fallback.slice(0, maxShots)
  }

  // 第一帧总是关键帧，score=0（没有上一帧可对比）
  const withFirst = [{ timestamp: 0, score: 0 }, ...shots]

  // 去重并按时间排序
  const seen = new Set<string>()
  const unique: DetectedShot[] = []
  for (const s of withFirst) {
    const key = s.timestamp.toFixed(2)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(s)
    }
  }
  unique.sort((a, b) => a.timestamp - b.timestamp)

  console.log(`[storyboard] unique shots=${unique.length}`)

  // 限制数量：保留分数最高的
  if (unique.length > maxShots) {
    const first = unique[0] // 保留第一帧
    const rest = unique.slice(1)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxShots - 1)
      .sort((a, b) => a.timestamp - b.timestamp)
    return [first, ...rest]
  }
  return unique
}

/** 通过 ffmpeg metadata=print 获取超过阈值的 scene score 和时间戳（只打印切点，stdout 量小） */
async function detectShotsWithMetadata(
  videoPath: string,
  threshold: number,
  signal?: AbortSignal
): Promise<DetectedShot[]> {
  // 用单引号包裹 filter 表达式，避免 Windows 下逗号转义问题
  const args = [
    '-i', videoPath,
    '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`,
    '-an', '-f', 'null', '-',
  ]

  const { stdout } = await runFFmpegBoth(args, signal)

  const shots: DetectedShot[] = []
  const lines = stdout.split('\n')
  let currentPts: number | null = null

  for (const line of lines) {
    // 格式: frame:0    pts:0       pts_time:0.000000
    const ptsMatch = line.match(/pts_time:([\d.]+)/)
    if (ptsMatch) {
      currentPts = parseFloat(ptsMatch[1])
      continue
    }
    // 格式: lavfi.scene_score=0.234567
    const scoreMatch = line.match(/lavfi\.scene_score=([\d.eE+-]+)/)
    if (scoreMatch && currentPts !== null) {
      const score = parseFloat(scoreMatch[1])
      if (!isNaN(score)) {
        shots.push({ timestamp: currentPts, score })
      }
      currentPts = null
    }
  }

  return shots
}

/** 曲线最多保留的采样点数（再多就降采样，避免长视频拖慢渲染） */
export const SCENE_SERIES_MAX_POINTS = 1500

/**
 * 整段解码、流式收下「每一帧」的 scene 差异分（含低于阈值的）。
 * 用 readline 边读边解析，不把整份 stdout（长视频可达几十 MB）堆进内存。
 */
function collectScenePoints(videoPath: string, signal?: AbortSignal): Promise<SceneScorePoint[]> {
  // gte(scene,0) 恒为真 → 选中每一帧，metadata=print 打印其 scene_score
  const args = [
    '-i', videoPath,
    '-vf', `select='gte(scene,0)',metadata=print:file=-`,
    '-an', '-f', 'null', '-',
  ]
  console.log(`[storyboard] ffmpeg(scene-points) ${args.join(' ')}`)

  return getFfmpegBin().then((FFMPEG_BIN) => new Promise<SceneScorePoint[]>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true })
    const points: SceneScorePoint[] = []
    let currentPts: number | null = null

    const rl = readline.createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      const ptsMatch = line.match(/pts_time:([\d.]+)/)
      if (ptsMatch) {
        currentPts = parseFloat(ptsMatch[1])
        return
      }
      const scoreMatch = line.match(/lavfi\.scene_score=([\d.eE+-]+)/)
      if (scoreMatch && currentPts !== null) {
        const score = parseFloat(scoreMatch[1])
        if (!isNaN(score)) points.push({ t: currentPts, score })
        currentPts = null
      }
    })
    // 排空 stderr，避免管道写满阻塞 ffmpeg
    child.stderr.resume()

    let onAbort: (() => void) | null = null
    const cleanup = () => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
    }

    // 先挂好 error/close，再处理取消：否则「进入时已取消 + spawn 失败」会抛未捕获的 'error'
    child.on('error', (e) => {
      cleanup()
      reject(e)
    })
    child.on('close', (code) => {
      cleanup()
      console.log(`[storyboard] scene-points ffmpeg exited code=${code}, ${points.length} points`)
      resolve(points)
    })

    if (signal) {
      onAbort = () => {
        child.kill()
        reject(new DOMException('Cancelled', 'AbortError'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  }))
}

/** 桶内取峰值降采样：把序列压到 maxPoints 以内，同时保留每个桶里的最高差异（切点不丢） */
export function downsampleSeries(points: SceneScorePoint[], maxPoints: number): SceneScorePoint[] {
  if (points.length <= maxPoints) return points
  const bucketSize = Math.ceil(points.length / maxPoints)
  const out: SceneScorePoint[] = []
  for (let i = 0; i < points.length; i += bucketSize) {
    let peak = points[i]
    const end = Math.min(i + bucketSize, points.length)
    for (let j = i + 1; j < end; j++) {
      if (points[j].score > peak.score) peak = points[j]
    }
    out.push(peak)
  }
  // 桶内取的是峰值帧，其时间未必是末尾；补上真实最后一帧，保证曲线右端对齐、时长兜底不偏小
  const last = points[points.length - 1]
  if (out.length === 0 || out[out.length - 1].t !== last.t) out.push(last)
  return out
}

/** 获取视频时长 */
async function getDuration(videoPath: string): Promise<number> {
  const FFMPEG_BIN = await getFfmpegBin()
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, ['-i', videoPath, '-f', 'null', '-'], { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('close', () => {
      const m = err.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/)
      if (m) {
        resolve(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]))
      } else {
        resolve(0)
      }
    })
  })
}

/** 提取单帧截图 */
export async function extractFrame(
  videoPath: string,
  timestamp: number,
  outputDir: string
): Promise<string> {
  // round 避免 1.001 * 1000 的浮点结果变成 1000.999…，导致相邻毫秒帧文件名冲突。
  const outputPath = path.join(outputDir, `frame_${String(Math.round(timestamp * 1000)).padStart(8, '0')}.jpg`)
  await runFFmpeg([
    '-y',
    '-ss', String(timestamp),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    '-vf', 'scale=854:-2',
    outputPath,
  ])
  return outputPath
}

/** 生成 xlsx 分镜表 */
export async function generateStoryboardXlsx(
  shots: StoryboardShot[],
  framePaths: string[],
  outputPath: string,
  videoDuration: number
): Promise<void> {
  console.log(`[storyboard] generateStoryboardXlsx: shots=${shots.length}, output=${outputPath}`)
  const workbook = new Workbook()
  const ws = workbook.addWorksheet('分镜表')

  const FONT_NAME = '微软雅黑'

  // 列定义
  ws.columns = [
    { header: '镜号', key: 'number', width: 8 },
    { header: '景别', key: 'shotType', width: 12 },
    { header: '角度', key: 'angle', width: 12 },
    { header: '运镜', key: 'cameraMove', width: 14 },
    { header: '关键帧', key: 'frame', width: 40 },
    { header: '时长', key: 'timeRange', width: 14 },
    { header: '提示词描述', key: 'description', width: 58 },
    { header: '台词', key: 'dialogue', width: 40 },
    { header: '音效', key: 'sound', width: 30 },
  ]

  // 表头样式：蓝底白字 微软雅黑
  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: FONT_NAME, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF002060' },
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF002060' } },
    }
  })

  // 数据行（先全部写入，再统一插入图片；否则 addImage 会占用下一行导致跳行）
  const rowFrames: Array<{ rowNum: number; framePath: string }> = []
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    const nextSec = i < shots.length - 1 ? shots[i + 1].startSec : videoDuration
    shot.timeRange = `${formatHMS(shot.startSec)} - ${formatHMS(nextSec)}`
    shot.endSec = nextSec

    const row = ws.addRow({
      number: shot.number,
      shotType: shot.shotType,
      angle: shot.angle,
      cameraMove: shot.cameraMove,
      timeRange: shot.timeRange,
      description: shot.description,
      dialogue: shot.dialogue,
      sound: shot.sound,
    })

    // 七段式提示词固定至少七行；比仅容纳关键帧的旧行高稍高，避免底部两项被遮住。
    row.height = 180
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.font = { name: FONT_NAME, color: { argb: 'FF000000' } }
    })

    const framePath = framePaths[i]
    if (framePath && existsSync(framePath)) {
      rowFrames.push({ rowNum: row.number, framePath })
    }
  }

  // 全部行写完后再插图片，避免 ws.addImage 影响后续 addRow 的行号
  for (const { rowNum, framePath } of rowFrames) {
    try {
      const ext = path.extname(framePath).slice(1).toLowerCase()
      const extension: 'jpeg' | 'png' | 'gif' =
        ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : 'jpeg'
      const imageId = workbook.addImage({
        filename: framePath,
        extension,
      })
      // col/row 是 0-based；关键帧位于第 5 列（0-based 索引 4）
      ws.addImage(imageId, {
        tl: { col: 4, row: rowNum - 1 } as unknown as Anchor,
        br: { col: 5, row: rowNum } as unknown as Anchor,
        editAs: 'oneCell',
      })
    } catch (err) {
      console.warn(`[storyboard] addImage failed for row ${rowNum}:`, err)
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
  await workbook.xlsx.writeFile(outputPath)
  console.log(`[storyboard] xlsx written: ${outputPath}`)
}

function formatHMS(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 运行 ffmpeg，同时收集 stdout 和 stderr */
async function runFFmpegBoth(
  args: string[],
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string }> {
  console.log(`[storyboard] ffmpeg ${args.join(' ')}`)
  const FFMPEG_BIN = await getFfmpegBin()
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    if (signal) {
      const onAbort = () => {
        child.kill()
        reject(new DOMException('Cancelled', 'AbortError'))
      }
      if (signal.aborted) { onAbort(); return }
      signal.addEventListener('abort', onAbort, { once: true })
      child.on('close', () => signal.removeEventListener('abort', onAbort))
    }
    child.on('error', (e) => {
      console.error(`[storyboard] ffmpeg spawn error:`, e)
      reject(e)
    })
    child.on('close', (code) => {
      console.log(`[storyboard] ffmpeg exited code=${code}`)
      resolve({ stdout: out, stderr: err })
    })
  })
}

async function runFFmpeg(args: string[]): Promise<void> {
  const FFMPEG_BIN = await getFfmpegBin()
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))
    })
  })
}
