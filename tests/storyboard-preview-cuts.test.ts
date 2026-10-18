import { describe, expect, it } from 'vitest'
import {
  insertStoryboardPreviewBoundary,
  validateStoryboardPreviewBoundary,
  type DetectAndCaptureResult,
} from '@core/services/storyboard-manager.js'

function capture(times: number[]): DetectAndCaptureResult {
  return {
    detected: times.map((timestamp, index) => ({
      timestamp,
      score: index / 10,
    })),
    framePaths: times.map((time) => `/frames/${time}.jpg`),
    durationSec: 3,
    seriesThreshold: 0.3,
  }
}

describe('storyboard cut preview manual boundary', () => {
  it('允许在距既有切点不足 0.4 秒但属于不同源帧的位置新增', () => {
    const original = capture([0, 1, 2])
    expect(validateStoryboardPreviewBoundary(original, 1.05, 3, 25)).toBeUndefined()

    const result = insertStoryboardPreviewBoundary(original, 1.05, '/frames/manual.jpg', 25)
    expect(result.index).toBe(2)
    expect(result.captured.detected.map((shot) => shot.timestamp)).toEqual([0, 1, 1.05, 2])
    expect(result.captured.framePaths).toEqual([
      '/frames/0.jpg',
      '/frames/1.jpg',
      '/frames/manual.jpg',
      '/frames/2.jpg',
    ])
    expect(result.captured.detected[2]).toMatchObject({
      score: 0,
      thumbT: 1.05,
      kind: 'manual',
    })
  })

  it('拒绝同毫秒、同源视频帧、首帧与视频末尾', () => {
    const original = capture([0, 1, 2])
    expect(validateStoryboardPreviewBoundary(original, 1.0004, 3, 25)).toBe('该毫秒已有切点')
    expect(validateStoryboardPreviewBoundary(original, 1.01, 3, 25)).toBe('该视频帧已有切点')
    expect(validateStoryboardPreviewBoundary(original, 0, 3, 25)).toBe('第一镜起点不可重复新增')
    expect(validateStoryboardPreviewBoundary(original, 3, 3, 25)).toBe(
      '切点必须位于视频结束时间之前'
    )
  })

  it('同步其他切割方式时以人工点替换同源帧自动点并保持路径对齐', () => {
    const otherMethod = capture([0, 1.04, 2])
    const result = insertStoryboardPreviewBoundary(
      otherMethod,
      1.05,
      '/frames/manual.jpg',
      25
    )
    expect(result.removedTimeMs).toEqual([1040])
    expect(result.captured.detected.map((shot) => shot.timestamp)).toEqual([0, 1.05, 2])
    expect(result.captured.framePaths).toEqual([
      '/frames/0.jpg',
      '/frames/manual.jpg',
      '/frames/2.jpg',
    ])
  })
})
