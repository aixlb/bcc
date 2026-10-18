import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryboardShot } from '@shared/types'

const analyzerMocks = vi.hoisted(() => ({
  analyze: vi.fn(),
}))

vi.mock('@core/services/config.js', () => ({
  getConfig: () => ({
    storyboard_provider: 'gemini',
    storyboard: {},
    gemini: { api_key: 'test-key', model: 'test-model' },
    kimi: {},
    minimax: {},
  }),
}))

vi.mock('@core/services/storyboard-analyzer.js', () => ({
  createAnalyzer: () => ({ analyze: analyzerMocks.analyze }),
}))

import { analyzeCapturedShots } from '@core/services/storyboard-manager.js'

function shot(startSec: number, description: string, userEdited = false): StoryboardShot {
  return {
    number: 9,
    shotType: '中景',
    angle: '平视角',
    cameraMove: '静态镜头',
    description,
    dialogue: '人工台词',
    sound: '人工声音',
    timeRange: '旧区间',
    startSec,
    endSec: startSec + 1,
    sceneScore: 0.99,
    userEdited,
  }
}

describe('analyzeCapturedShots preserved user content', () => {
  beforeEach(() => {
    analyzerMocks.analyze.mockReset()
  })

  it('整表重切时同起始毫秒保留人工内容，并跳过该镜 AI', async () => {
    const preserved = shot(1.0004, '人工描述', true)
    analyzerMocks.analyze.mockResolvedValue(shot(2, 'AI 描述'))
    const scaffold: StoryboardShot[][] = []

    const result = await analyzeCapturedShots({
      detected: [
        { timestamp: 1.0001, score: 0.2 },
        { timestamp: 2, score: 0.3 },
      ],
      framePaths: ['/tmp/preserved.jpg', '/tmp/analyze.jpg'],
      durationSec: 4,
      prompt: 'test prompt',
      preservedUserContent: new Map([[1000, preserved]]),
      onScaffold: (shots) => scaffold.push(shots),
    })

    expect(analyzerMocks.analyze).toHaveBeenCalledTimes(1)
    expect(analyzerMocks.analyze).toHaveBeenCalledWith('/tmp/analyze.jpg', 'test prompt', undefined)
    expect(result.shots[0]).toMatchObject({
      number: 1,
      description: '人工描述',
      dialogue: '人工台词',
      startSec: 1.0001,
      endSec: 2,
      sceneScore: 0.2,
      userEdited: true,
    })
    expect(result.shots[1]).toMatchObject({
      number: 2,
      description: 'AI 描述',
      startSec: 2,
      endSec: 4,
      sceneScore: 0.3,
      userEdited: false,
    })
    expect(scaffold[0][0]).toMatchObject({
      description: '人工描述',
      userEdited: true,
    })
  })
})
