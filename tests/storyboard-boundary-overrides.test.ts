import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __resetRuntime, setDataRoot } from '@core/runtime.js'
import {
  getProjectStoryboardOverridesPath,
  readStoryboardBoundaryOverrides,
  updateStoryboardBoundaryOverrides,
} from '@core/services/project-storage.js'
import {
  applyStoryboardShotTextEdits,
  deleteStoryboardBoundaryOverride,
  extendLeftShotThroughDeletedBoundary,
  mergeStoryboardBoundaryTimes,
  renumberShots,
  storyboardBoundaryMs,
  storyboardFrameIndex,
} from '@core/services/storyboard-manager.js'
import { createStoryboardDescriptionTemplate } from '@shared/defaults.js'
import type { StoryboardBoundaryOverrides, StoryboardShot } from '@shared/types'

const tempRoots: string[] = []

async function freshDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-boundary-overrides-'))
  tempRoots.push(root)
  __resetRuntime()
  setDataRoot(root)
  return root
}

afterEach(async () => {
  __resetRuntime()
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('storyboard boundary override merge', () => {
  const base = (forced: number[], suppressed: number[]): StoryboardBoundaryOverrides => ({
    version: 1,
    forced,
    suppressed,
    updatedAt: 0,
  })

  it('按最近毫秒稳定归一，且不再使用 0.4 秒近邻限制', () => {
    expect(storyboardBoundaryMs(1.0001)).toBe(1000)
    expect(storyboardBoundaryMs(1.0004)).toBe(1000)
    expect(storyboardBoundaryMs(1.0009)).toBe(1001)
    expect(storyboardBoundaryMs(1.001)).toBe(1001)
    expect(storyboardBoundaryMs(1.01)).toBe(1010)
    expect(storyboardBoundaryMs(Number.NaN)).toBeNull()
  })

  it('帧率可用时识别同一源视频帧', () => {
    expect(storyboardFrameIndex(0, 25)).toBe(0)
    expect(storyboardFrameIndex(0.039, 25)).toBe(0)
    expect(storyboardFrameIndex(0.04, 25)).toBe(1)
    expect(storyboardFrameIndex(0.041, 25)).toBe(1)
    expect(storyboardFrameIndex(1, 0)).toBeNull()
  })

  it('suppressed 删除自动点，forced 跨近邻保留且同毫秒 manual wins', () => {
    const merged = mergeStoryboardBoundaryTimes(
      [0, 1, 1.01, 2],
      base([1010, 1500], [1000, 1010]),
      3
    )
    expect(merged).toEqual([
      { timeMs: 0, manual: false },
      { timeMs: 1010, manual: true },
      { timeMs: 1500, manual: true },
      { timeMs: 2000, manual: false },
    ])
  })

  it('forced 在自动结果完成截断后仍全部加入', () => {
    const merged = mergeStoryboardBoundaryTimes(
      [0, 10],
      base([1000, 2000, 3000, 4000], []),
      20
    )
    expect(merged.filter((point) => point.manual).map((point) => point.timeMs)).toEqual([
      1000, 2000, 3000, 4000,
    ])
  })

  it('删除 forced 后留下 suppression，重切不会在旧位置复活', () => {
    const overrides = deleteStoryboardBoundaryOverride(base([1000], []), 1000)
    expect(overrides.forced).toEqual([])
    expect(overrides.suppressed).toEqual([1000])
    expect(mergeStoryboardBoundaryTimes([0, 1, 2], overrides, 3)).toEqual([
      { timeMs: 0, manual: false },
      { timeMs: 2000, manual: false },
    ])
  })

  it('删除末镜时左镜继承其视频末端', () => {
    const shot = (number: number, startSec: number, endSec: number): StoryboardShot => ({
      number,
      shotType: '中景',
      angle: '',
      cameraMove: '',
      description: '',
      dialogue: '',
      sound: '',
      timeRange: '',
      startSec,
      endSec,
      sceneScore: 0,
    })
    const shots = [shot(1, 0, 5)]
    extendLeftShotThroughDeletedBoundary(shots, 1, 12)
    renumberShots(shots)
    expect(shots[0].endSec).toBe(12)
  })

  it('文本编辑归一景别，并同步七段式 description 的景别', () => {
    const old: StoryboardShot = {
      number: 1,
      shotType: '极远景',
      angle: '',
      cameraMove: '',
      description: createStoryboardDescriptionTemplate('极远景'),
      dialogue: '',
      sound: '',
      timeRange: '',
      startSec: 0,
      endSec: 1,
      sceneScore: 0,
    }
    const next = applyStoryboardShotTextEdits(old, { shotType: '中近景' })
    expect(next.shotType).toBe('近景')
    expect(next.description).toContain('景别：近景')
    expect(next.userEdited).toBe(true)
  })
})

describe('storyboard boundary override sidecar', () => {
  it('以原子 sidecar 持久化，并串行合并并发更新', async () => {
    await freshDataRoot()
    const projectId = 'project-a'

    await Promise.all([
      updateStoryboardBoundaryOverrides(projectId, (current) => ({
        ...current,
        forced: [...current.forced, 1000],
      })),
      updateStoryboardBoundaryOverrides(projectId, (current) => ({
        ...current,
        suppressed: [...current.suppressed, 2000],
      })),
    ])

    const loaded = await readStoryboardBoundaryOverrides(projectId)
    expect(loaded.forced).toEqual([1000])
    expect(loaded.suppressed).toEqual([2000])
    expect(loaded.updatedAt).toBeGreaterThan(0)
    expect(JSON.parse(await fs.readFile(getProjectStoryboardOverridesPath(projectId), 'utf-8'))).toMatchObject({
      version: 1,
      forced: [1000],
      suppressed: [2000],
    })
  })
})
