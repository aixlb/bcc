import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StoryboardProject, StoryboardShot } from '@shared/types'
import {
  STORYBOARD_DEFAULT_PROMPT,
  STORYBOARD_DESCRIPTION_LABELS,
  STORYBOARD_OUTPUT_CONTRACT,
  formatStoryboardDescription,
  isStructuredStoryboardDescription,
  normalizeStoryboardShotType,
} from '@shared/defaults'
import { parseStoryboardResponse } from '@core/services/storyboard-analyzer.js'
import { RESEARCH_DEFAULT_PROMPT } from '@core/services/research-prompt.js'
import {
  loadStoryboardProject,
  serializeStoryboardMd,
} from '@core/services/storyboard-storage.js'

const PARTS = {
  风格限定: '电影写实',
  景别: '远景',
  视角构图: '低机位，中心构图',
  主体描述: '穿黑色风衣的女人快步向前',
  背景设定: '雨夜的城市街道',
  细节修饰: '湿润路面与细密雨丝',
  光影色调: '冷蓝色霓虹侧逆光',
}

function makeShot(description: string, overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    number: 1,
    shotType: '特写',
    angle: '平视角',
    cameraMove: '静态镜头',
    description,
    dialogue: '',
    sound: '雨声',
    timeRange: '00:00:00 - 00:00:05',
    startSec: 0,
    endSec: 5,
    sceneScore: 0,
    ...overrides,
  }
}

function makeProject(shot: StoryboardShot): StoryboardProject {
  return {
    id: 'test-project',
    videoPath: '/tmp/example.mp4',
    createdAt: 0,
    shots: [shot],
    framePaths: [''],
  }
}

describe('七段式分镜提示词描述', () => {
  it('默认 prompt 自带完整七项与六档景别契约', () => {
    expect(STORYBOARD_DEFAULT_PROMPT).toContain(STORYBOARD_OUTPUT_CONTRACT)
    expect(STORYBOARD_DEFAULT_PROMPT).toContain('"description": {')
    for (const label of STORYBOARD_DESCRIPTION_LABELS) {
      expect(STORYBOARD_OUTPUT_CONTRACT).toContain(`"${label}"`)
    }
    expect(STORYBOARD_OUTPUT_CONTRACT).toContain('特写、近景、中景、全景、大全景、远景')
    expect(RESEARCH_DEFAULT_PROMPT).toContain('风格限定、景别、视角构图、主体描述、背景设定、细节修饰、光影色调')
    expect(RESEARCH_DEFAULT_PROMPT).toContain('特写/近景/中景/全景/大全景/远景')
  })

  it('统一顶层景别，并以顶层 shotType 覆盖 description 内冲突值', () => {
    const shot = parseStoryboardResponse(JSON.stringify({
      shotType: '极特写',
      angle: '俯视',
      cameraMove: '推镜',
      description: PARTS,
      dialogue: '',
      sound: '',
    }))

    expect(shot.shotType).toBe('特写')
    expect(shot.description.split('\n')).toHaveLength(7)
    expect(shot.description).toContain('景别：特写')
    expect(shot.description).not.toContain('景别：远景')
    expect(isStructuredStoryboardDescription(shot.description)).toBe(true)
    expect(normalizeStoryboardShotType('中近景')).toBe('近景')
    expect(normalizeStoryboardShotType('中远景')).toBe('全景')
    expect(normalizeStoryboardShotType('极远景')).toBe('远景')
  })

  it('兼容已格式化字符串与普通 prose，解析器的新输出始终固定七行', () => {
    const formatted = formatStoryboardDescription(PARTS, '大全景')
    const fromString = parseStoryboardResponse(JSON.stringify({
      shotType: '大全景',
      description: formatted,
    }))
    expect(fromString.description).toBe(formatted)

    const fromLegacy = parseStoryboardResponse(JSON.stringify({
      shotType: '中景',
      description: '女孩站在窗前。',
    }))
    expect(fromLegacy.description.split('\n')).toHaveLength(7)
    expect(fromLegacy.description).toContain('主体描述：女孩站在窗前。')
  })

  it('新 Markdown 多行块与 userEdited 可往返，旧描述仍保留旧标签', async () => {
    const description = formatStoryboardDescription(PARTS, '特写')
    const project = makeProject(makeShot(description, { userEdited: true }))
    const md = serializeStoryboardMd(project)
    expect(md).toContain('**提示词描述**:')
    expect(md).toContain('```text')
    expect(md).toContain('<!-- userEdited: true -->')
    expect(md).not.toContain('**描述**:')

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-storyboard-description-'))
    await fs.writeFile(path.join(dir, 'storyboard.md'), md, 'utf8')
    const loaded = await loadStoryboardProject(dir)
    expect(loaded?.shots[0].description).toBe(description)
    expect(loaded?.shots[0].userEdited).toBe(true)

    const legacy = serializeStoryboardMd(makeProject(makeShot('女孩站在窗前。')))
    expect(legacy).toContain('**描述**: 女孩站在窗前。')
    expect(legacy).not.toContain('**提示词描述**:')
    await fs.writeFile(path.join(dir, 'storyboard.md'), legacy, 'utf8')
    const loadedLegacy = await loadStoryboardProject(dir)
    expect(loadedLegacy?.shots[0].description).toBe('女孩站在窗前。')

    const labelledLegacyText = '景别：中景\n这是旧版叙述，不是完整七段式。'
    const labelledLegacy = serializeStoryboardMd(
      makeProject(makeShot(labelledLegacyText))
    )
    await fs.writeFile(path.join(dir, 'storyboard.md'), labelledLegacy, 'utf8')
    const loadedLabelledLegacy = await loadStoryboardProject(dir)
    expect(loadedLabelledLegacy?.shots[0].description).toBe(labelledLegacyText)

    const precise = serializeStoryboardMd(
      makeProject(makeShot(description, { startSec: 1.0009, endSec: 2.0009 }))
    )
    expect(precise).toContain('**起始秒**: 1.001')
    expect(precise).toContain('**结束秒**: 2.001')
  })
})
