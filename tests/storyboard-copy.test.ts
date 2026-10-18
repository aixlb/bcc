import { describe, expect, it } from 'vitest'
import { formatStoryboardShotForClipboard } from '../apps/bcc-desktop/src/renderer/src/lib/storyboard-copy'
import type { StoryboardShot } from '@shared/types'

function shot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    number: 3,
    shotType: '近景',
    angle: '平视',
    cameraMove: '缓慢推近',
    description: '风格限定：电影感\n景别：近景',
    dialogue: '你好。',
    sound: '雨声',
    timeRange: '00:00:02 - 00:00:05',
    startSec: 2,
    endSec: 5,
    sceneScore: 0.4,
    ...overrides,
  }
}

describe('storyboard shot clipboard text', () => {
  it('按分镜表字段顺序复制完整单镜文字', () => {
    expect(formatStoryboardShotForClipboard(shot())).toBe(
      [
        '镜号：003',
        '时间：00:00:02 - 00:00:05',
        '景别：近景',
        '角度：平视',
        '运镜：缓慢推近',
        '提示词描述：',
        '风格限定：电影感',
        '景别：近景',
        '台词：你好。',
        '音效：雨声',
      ].join('\n')
    )
  })

  it('空字段不产生空标签', () => {
    const text = formatStoryboardShotForClipboard(
      shot({ angle: '', cameraMove: '', description: '', dialogue: '', sound: '' })
    )
    expect(text).toContain('镜号：003')
    expect(text).toContain('景别：近景')
    expect(text).not.toContain('角度：')
    expect(text).not.toContain('提示词描述：')
  })
})
