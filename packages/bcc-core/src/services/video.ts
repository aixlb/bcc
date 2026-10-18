/**
 * 视频处理服务：时长探测、分段、压缩
 * ffmpeg/ffprobe 二进制由 ffmpeg-runtime 解析（显式路径 → skill runtime → node_modules → 缓存 → 按需下载）
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { ensureFfmpegBinaries } from './ffmpeg-runtime.js'

/** 长视频分段阈值 */
export const SEGMENT_THRESHOLD_SEC = 2 * 60 * 60 // 2 小时
/** 每段时长 */
export const SEGMENT_DURATION_SEC = 30 * 60 // 30 分钟
/** 分段重叠 */
export const SEGMENT_OVERLAP_SEC = 30

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export interface VideoInfo {
  path: string
  durationSec: number
  width: number
  height: number
  sizeBytes: number
  format: string
  videoCodec: string
  audioCodec: string
  /** 平均帧率（fps），无法解析时为 0 */
  fps: number
  /** 整体码率（bit/s），format.bit_rate 缺失时为 0（调用方可用 size/duration 兜底） */
  bitrateBps: number
}

export interface VideoSegment {
  /** 截取后的文件路径（若不分段则为原文件） */
  path: string
  startSec: number
  endSec: number
  index: number
  total: number
  /** 是否为原始视频（不需删除） */
  isOriginal: boolean
}

/** 获取视频信息（时长、分辨率、编码） */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  if (!existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`)
  }

  const result = await runProbe([
    '-v',
    'error',
    '-show_entries',
    'format=duration,size,bit_rate,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate',
    '-of',
    'json',
    videoPath,
  ])

  const parsed = JSON.parse(result) as {
    format: { duration: string; size: string; format_name: string; bit_rate?: string }
    streams: Array<{
      codec_type: string
      codec_name: string
      width?: number
      height?: number
      avg_frame_rate?: string
    }>
  }

  const video = parsed.streams.find((s) => s.codec_type === 'video')
  const audio = parsed.streams.find((s) => s.codec_type === 'audio')
  const stat = await fs.stat(videoPath)

  // ffprobe 对部分流式/分片输入会把 duration 报成字符串 'N/A'，parseFloat 得到 NaN；
  // NaN 会污染分段判断与进度/ETA 计算，这里兜底成 0。
  const parsedDuration = parseFloat(parsed.format?.duration ?? '')

  // avg_frame_rate 形如 "30000/1001" / "25/1" / "0/0"
  let fps = 0
  const fr = video?.avg_frame_rate ?? ''
  const m = fr.match(/^(\d+)\/(\d+)$/)
  if (m) {
    const den = parseInt(m[2], 10)
    if (den > 0) fps = parseInt(m[1], 10) / den
  } else if (fr && Number.isFinite(parseFloat(fr))) {
    fps = parseFloat(fr)
  }

  const parsedBitrate = parseFloat(parsed.format?.bit_rate ?? '')

  return {
    path: videoPath,
    durationSec: Number.isFinite(parsedDuration) ? parsedDuration : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    sizeBytes: stat.size,
    format: parsed.format.format_name ?? '',
    videoCodec: video?.codec_name ?? '',
    audioCodec: audio?.codec_name ?? '',
    fps: Number.isFinite(fps) ? fps : 0,
    bitrateBps: Number.isFinite(parsedBitrate) ? parsedBitrate : 0,
  }
}

/** 判断是否需要分段 */
export function needSegmentation(durationSec: number): boolean {
  return durationSec > SEGMENT_THRESHOLD_SEC
}

/**
 * 将视频分段。短视频返回单个 segment（指向原文件，isOriginal=true）。
 * 长视频使用 ffmpeg -c copy 快速切片（不重新编码）。
 */
export async function segmentVideo(
  videoPath: string,
  durationSec: number,
  outputDir: string,
  onProgress?: (idx: number, total: number) => void,
  signal?: AbortSignal
): Promise<VideoSegment[]> {
  if (!needSegmentation(durationSec)) {
    return [
      {
        path: videoPath,
        startSec: 0,
        endSec: durationSec,
        index: 1,
        total: 1,
        isOriginal: true,
      },
    ]
  }

  await fs.mkdir(outputDir, { recursive: true })

  const total = Math.ceil(durationSec / SEGMENT_DURATION_SEC)
  const segments: VideoSegment[] = []

  for (let i = 0; i < total; i++) {
    const isFirst = i === 0
    const isLast = i === total - 1
    const start = isFirst ? 0 : Math.max(0, i * SEGMENT_DURATION_SEC - SEGMENT_OVERLAP_SEC)
    const end = isLast
      ? durationSec
      : Math.min(durationSec, (i + 1) * SEGMENT_DURATION_SEC + SEGMENT_OVERLAP_SEC)
    const segPath = path.join(outputDir, `segment_${String(i + 1).padStart(3, '0')}.mp4`)

    await runFFmpeg(
      [
        '-y',
        '-ss',
        String(start),
        '-t',
        String(end - start),
        '-i',
        videoPath,
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        segPath,
      ],
      undefined,
      undefined,
      signal
    )

    segments.push({
      path: segPath,
      startSec: start,
      endSec: end,
      index: i + 1,
      total,
      isOriginal: false,
    })

    onProgress?.(i + 1, total)
  }

  return segments
}

/**
 * 按目标体积反推第二遍压缩的音视频码率（kbps）。
 * 预留 7% 余量给容器开销与码率浮动；音频压到 32k 以下（长视频里音频占比可观），
 * 视频码率设 40k 下限——低于此画面已不可辨，宁可超限让调用方报错。
 */
export function computeTargetBitrates(
  maxMB: number,
  durationSec: number
): { videoKbps: number; audioKbps: number } {
  const totalKbps = (maxMB * 0.93 * 8 * 1024) / durationSec
  const audioKbps = Math.min(32, Math.max(12, Math.round(totalKbps * 0.2)))
  const videoKbps = Math.max(40, Math.round(totalKbps - audioKbps))
  return { videoKbps, audioKbps }
}

/**
 * 压缩视频以减小上传体积（Kimi 上限 100MB、MiniMax 等同类限制）。
 * 当文件大于 maxMB 时：
 * 1. 第一遍固定画质（854p + 2fps + CRF 32）——多数视频一遍即可达标；
 * 2. 仍超限（常见于长视频，CRF 不控体积）→ 按目标体积反推码率再压一遍硬压达标，
 *    音频同时降到 32k 单声道。第二遍从第一遍产物转码（已是低分辨率低帧率，解码快），
 *    画质损失对大模型理解可接受。
 * 返回（可能是临时文件的）路径以及是否实际做了压缩。
 */
export async function compressIfNeeded(
  videoPath: string,
  maxMB = 50,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<{ outputPath: string; compressed: boolean; originalMB: number; outputMB: number }> {
  const stat = await fs.stat(videoPath)
  const originalMB = stat.size / (1024 * 1024)
  if (originalMB <= maxMB) {
    return { outputPath: videoPath, compressed: false, originalMB, outputMB: originalMB }
  }

  // 时长用于码率反推与进度；探测失败不阻塞压缩（退化为无第二遍，行为同旧版）
  let durationSec = 0
  try {
    durationSec = (await getVideoInfo(videoPath)).durationSec
  } catch {
    /* ignore */
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'v2s-compress-'))
  // Use ASCII-only filename so the path is safe as an HTTP header / FormData value
  const outputPath = path.join(tmpDir, 'compressed_lowq.mp4')

  // 本函数自己拥有 tmpDir 生命周期：ffmpeg 失败会在调用方拿到 compressed 之前抛出，
  // 调用方 finally 里的清理就跑不到，tmpDir（含半截输出）会被遗留。这里失败即就地清理。
  try {
    await runFFmpeg(
      [
        '-y',
        '-i',
        videoPath,
        '-vf',
        'scale=854:-2,fps=2',
        '-c:v',
        'libx264',
        '-crf',
        '32',
        '-preset',
        'veryfast',
        '-c:a',
        'aac',
        '-b:a',
        '48k',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      onProgress,
      { totalDurationSec: durationSec },
      signal
    )

    let outStat = await fs.stat(outputPath)
    let outputMB = outStat.size / (1024 * 1024)

    // 第二遍：按目标体积反推码率硬压（CRF 不控体积，长视频常在这一步救回来）
    if (outputMB > maxMB && durationSec > 0) {
      const { videoKbps, audioKbps } = computeTargetBitrates(maxMB, durationSec)
      const bitratePath = path.join(tmpDir, 'compressed_bitrate.mp4')
      await runFFmpeg(
        [
          '-y',
          '-i',
          outputPath,
          '-c:v',
          'libx264',
          '-b:v',
          `${videoKbps}k`,
          '-maxrate',
          `${Math.round(videoKbps * 1.2)}k`,
          '-bufsize',
          `${videoKbps * 2}k`,
          '-preset',
          'veryfast',
          '-c:a',
          'aac',
          '-b:a',
          `${audioKbps}k`,
          '-ac',
          '1',
          '-movflags',
          '+faststart',
          bitratePath,
        ],
        onProgress,
        { totalDurationSec: durationSec },
        signal
      )
      await fs.rm(outputPath, { force: true }).catch(() => {})
      outStat = await fs.stat(bitratePath)
      outputMB = outStat.size / (1024 * 1024)
      return { outputPath: bitratePath, compressed: true, originalMB, outputMB }
    }

    return { outputPath, compressed: true, originalMB, outputMB }
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/** 运行 ffprobe，返回 stdout 字符串 */
async function runProbe(args: string[]): Promise<string> {
  const { ffprobe } = await ensureFfmpegBinaries()
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, args, { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`ffprobe exited ${code}: ${err}`))
    })
  })
}

/** 运行 ffmpeg，支持进度回调（基于 stderr 解析 time= 字段）与取消（abort 即杀子进程） */
async function runFFmpeg(
  args: string[],
  onProgress?: (percent: number) => void,
  ctx?: { totalDurationSec: number },
  signal?: AbortSignal
): Promise<void> {
  const { ffmpeg } = await ensureFfmpegBinaries()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let err = ''
    let onAbort: (() => void) | null = null
    const cleanup = () => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
    }
    child.stderr.on('data', (d) => {
      const s = d.toString()
      err += s
      if (onProgress && ctx && ctx.totalDurationSec > 0) {
        const m = s.match(/time=(\d+):(\d+):(\d+\.?\d*)/)
        if (m) {
          const cur = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])
          onProgress(Math.min(1, cur / ctx.totalDurationSec))
        }
      }
    })
    child.on('error', (e) => {
      cleanup()
      reject(e)
    })
    child.on('close', (code) => {
      cleanup()
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))
    })
    if (signal) {
      onAbort = () => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export function formatHMS(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
