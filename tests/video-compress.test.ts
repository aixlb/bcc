import { describe, it, expect } from 'vitest'
import { computeTargetBitrates } from '@core/services/video.js'

describe('computeTargetBitrates — 按目标体积反推第二遍压缩码率', () => {
  it('短视频（10 分钟压进 95MB）：音频顶格 32k，视频拿走剩余预算', () => {
    const { videoKbps, audioKbps } = computeTargetBitrates(95, 600)
    expect(audioKbps).toBe(32)
    expect(videoKbps).toBe(1174) // 95*0.93*8*1024/600 - 32 ≈ 1174
  })

  it('长视频（2 小时压进 95MB）：音频按比例降档，视频仍在下限之上', () => {
    const { videoKbps, audioKbps } = computeTargetBitrates(95, 7200)
    expect(audioKbps).toBe(20) // total≈100.5k 的 20%
    expect(videoKbps).toBe(81)
  })

  it('超长视频：命中 40k 视频下限与 12k 音频下限（体积可能仍超，交调用方报错）', () => {
    const { videoKbps, audioKbps } = computeTargetBitrates(95, 30000)
    expect(audioKbps).toBe(12)
    expect(videoKbps).toBe(40)
  })

  it('码率随目标体积线性缩放（同时长下 50MB 目标约为 95MB 的一半出头）', () => {
    const big = computeTargetBitrates(95, 1200)
    const small = computeTargetBitrates(50, 1200)
    expect(small.videoKbps).toBeLessThan(big.videoKbps)
    expect(small.videoKbps + small.audioKbps).toBeLessThan(big.videoKbps + big.audioKbps)
  })
})
