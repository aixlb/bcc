import { describe, expect, it } from 'vitest'
import { findActiveTimestampIndex } from '../apps/bcc-desktop/src/renderer/src/lib/storyboard-timeline'

describe('storyboard preview timeline follow', () => {
  const timestamps = [0, 1.25, 3.5, 8]

  it('空时间轴或首镜之前没有当前分镜', () => {
    expect(findActiveTimestampIndex([], 1)).toBe(-1)
    expect(findActiveTimestampIndex(timestamps, -0.001)).toBe(-1)
    expect(findActiveTimestampIndex(timestamps, Number.NaN)).toBe(-1)
  })

  it('区间内取左侧分镜，精确切点进入新分镜', () => {
    expect(findActiveTimestampIndex(timestamps, 0)).toBe(0)
    expect(findActiveTimestampIndex(timestamps, 1.249)).toBe(0)
    expect(findActiveTimestampIndex(timestamps, 1.25)).toBe(1)
    expect(findActiveTimestampIndex(timestamps, 6)).toBe(2)
    expect(findActiveTimestampIndex(timestamps, 99)).toBe(3)
  })
})
