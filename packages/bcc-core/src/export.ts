/**
 * 可复用的项目导出逻辑（framework-agnostic）。
 *
 * docx / xlsx 已是纯函数（generateScriptDocx / generateStoryboardXlsx），直接调用即可；
 * html 较复杂（需按剧本场景时码从视频抓帧再内嵌 base64），抽到这里供 GUI 与 CLI 共用，
 * 用 os.tmpdir() 替代 electron 的 app.getPath('temp')。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { ScriptScene, StoryboardShot } from '@shared/types'
import { getVideoInfo, formatBytes } from './services/video.js'
import { extractFrame } from './services/storyboard.js'
import { generateProjectHtml } from './services/html-export.js'

function formatBitrate(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} kbps`
  return `${Math.round(bps)} bps`
}

function formatFps(f: number): string {
  const r = Math.round(f * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(2)
}

export interface BuildProjectHtmlOptions {
  projectName: string
  /** 源视频绝对路径（用于抓取技术参数 + 剧本场景关键帧）；缺省/不存在则跳过 */
  videoPath?: string
  scenes: ScriptScene[]
  shots: StoryboardShot[]
  /** 与 shots 对齐的关键帧绝对路径 */
  framePaths: string[]
}

/**
 * 生成单文件交互 HTML（剧本 + 分镜合并视图）。scenes / shots 任一非空即可。
 * 若提供有效 videoPath 且有剧本场景，会按各场景时码并发抓帧，内嵌后清理临时目录。
 */
export async function buildProjectHtml(opts: BuildProjectHtmlOptions): Promise<string> {
  const { projectName, videoPath, scenes, shots, framePaths } = opts
  const hasVideo = !!videoPath && existsSync(videoPath)

  let durationSec = 0
  let videoMeta:
    | { resolution: string; fps: string; bitrate: string; size: string; codec: string }
    | undefined
  if (hasVideo) {
    try {
      const info = await getVideoInfo(videoPath as string)
      durationSec = info.durationSec
      const bps =
        info.bitrateBps > 0
          ? info.bitrateBps
          : info.sizeBytes > 0 && info.durationSec > 0
            ? (info.sizeBytes * 8) / info.durationSec
            : 0
      videoMeta = {
        resolution: info.width && info.height ? `${info.width}×${info.height}` : '',
        fps: info.fps > 0 ? formatFps(info.fps) : '',
        bitrate: bps > 0 ? formatBitrate(bps) : '',
        size: info.sizeBytes > 0 ? formatBytes(info.sizeBytes) : '',
        codec: info.videoCodec || '',
      }
    } catch {
      /* ignore：无技术参数不影响导出 */
    }
  }

  const videoName = videoPath ? videoPath.replace(/.*[\\/]/, '') : ''

  // 剧本场景关键帧：按每个场景时间码从视频抓帧（剧本本身不含截图），内嵌后清理临时目录
  let sceneFramePaths: string[] = []
  let sceneFramesDir: string | null = null
  const canCaptureScenes = scenes.length > 0 && hasVideo
  if (canCaptureScenes) {
    sceneFramesDir = path.join(os.tmpdir(), `v2s-scene-frames-${Date.now()}`)
    await fs.mkdir(sceneFramesDir, { recursive: true })
    sceneFramePaths = new Array(scenes.length).fill('')
    const CONCURRENCY = 4
    let next = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, scenes.length) }, async () => {
      while (next < scenes.length) {
        const i = next++
        try {
          sceneFramePaths[i] = await extractFrame(videoPath as string, scenes[i].startSec, sceneFramesDir as string)
        } catch {
          sceneFramePaths[i] = ''
        }
      }
    })
    await Promise.all(workers)
  }

  try {
    return await generateProjectHtml({
      projectName,
      videoName,
      durationSec,
      videoMeta,
      scenes,
      shots,
      framePaths,
      sceneFramePaths,
      generatedAt: Date.now(),
    })
  } finally {
    if (sceneFramesDir) {
      try {
        await fs.rm(sceneFramesDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}
