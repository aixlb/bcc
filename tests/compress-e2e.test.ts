import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { compressIfNeeded } from '@core/services/video.js'

describe('compressIfNeeded 端到端（真实 ffmpeg）', () => {
  it('超限时压缩，必要时二次降码率，最终体积受控', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2s-e2e-'))
    const src = path.join(dir, 'src.mp4')
    // 8 秒 640x480 高码率测试视频 + 正弦音轨
    const gen = spawnSync(
      ffmpegStatic as unknown as string,
      [
        '-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=640x480:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
        '-c:v', 'libx264', '-b:v', '2000k', '-c:a', 'aac', '-shortest', src,
      ],
      { windowsHide: true }
    )
    expect(gen.status).toBe(0)
    const srcSize = fs.statSync(src).size
    expect(srcSize).toBeGreaterThan(0.2 * 1024 * 1024)

    // maxMB 设得极小：第一遍 CRF 已达标时直接返回，否则第二遍码率硬压。
    const result = await compressIfNeeded(src, 0.05)
    expect(result.compressed).toBe(true)
    // 不同 ffmpeg 构建的 CRF 压缩率略有差异，两种路径都是有效产物。
    expect(['compressed_lowq.mp4', 'compressed_bitrate.mp4']).toContain(path.basename(result.outputPath))
    expect(result.outputMB).toBeLessThan(result.originalMB)
    // 40k 视频下限 + 12k 音频 ≈ 8s * 52kbps ≈ 0.05MB，给容器开销留 3 倍余量
    expect(result.outputMB).toBeLessThan(0.15)

    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(path.dirname(result.outputPath), { recursive: true, force: true })
  }, 60000)
})
