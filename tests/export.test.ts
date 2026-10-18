import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import exceljsPkg from 'exceljs'
import type { ScriptResult, StoryboardShot } from '@shared/types'
import { formatStoryboardDescription } from '@shared/defaults'
import { parseScript, generateScriptDocx, generateStoryboardXlsx, buildProjectHtml } from '@core/index.js'

const { Workbook } = exceljsPkg
const SCRIPT = ['[00:00:05] 1-1 教室 日/内', '△ 阳光', '小明：你好', '[00:00:30] 1-2 走廊', '小红：嗨'].join('\n')
const PROMPT_DESCRIPTION = formatStoryboardDescription({
  风格限定: '电影写实',
  景别: '中景',
  视角构图: '平视，三分法构图',
  主体描述: '小明背着书包走进教室',
  背景设定: '清晨的教室',
  细节修饰: '桌面有细微木纹',
  光影色调: '暖色自然光',
}, '中景')

function scriptResult(): ScriptResult {
  return {
    jobId: 'test',
    videoPath: '/x/a.mp4',
    durationSec: 60,
    script: SCRIPT,
    scenes: parseScript(SCRIPT),
    generatedInMs: 0,
    generatedAt: 0,
  }
}

function shotFixture(): StoryboardShot[] {
  return [
    {
      number: 1,
      shotType: '中景',
      angle: '平视',
      cameraMove: '固定',
      description: PROMPT_DESCRIPTION,
      dialogue: '你好',
      sound: '环境声',
      timeRange: '00:00-00:05',
      startSec: 0,
      endSec: 5,
      sceneScore: 0.4,
    },
  ]
}

describe('导出', () => {
  it('generateScriptDocx 产出有效 docx（zip/PK 头）', async () => {
    const buf = await generateScriptDocx(scriptResult())
    expect(buf.length).toBeGreaterThan(0)
    // docx 是 zip，魔数 "PK"
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('generateStoryboardXlsx 写出有效 xlsx 文件', async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-xlsx-')), 'sb.xlsx')
    await generateStoryboardXlsx(shotFixture(), [], out, 60)
    expect(fs.existsSync(out)).toBe(true)
    const head = fs.readFileSync(out).subarray(0, 2)
    expect(head[0]).toBe(0x50)
    expect(head[1]).toBe(0x4b)

    const workbook = new Workbook()
    await workbook.xlsx.readFile(out)
    const ws = workbook.getWorksheet('分镜表')
    expect(ws?.getCell('G1').value).toBe('提示词描述')
    expect(ws?.getCell('G2').value).toBe(PROMPT_DESCRIPTION)
  })

  it('buildProjectHtml 无视频时也产出含项目名与内容的 HTML', async () => {
    const html = await buildProjectHtml({
      projectName: '我的项目',
      videoPath: undefined,
      scenes: parseScript(SCRIPT),
      shots: shotFixture(),
      framePaths: [],
    })
    expect(typeof html).toBe('string')
    expect(html.toLowerCase()).toContain('<html')
    expect(html).toContain('我的项目')
    expect(html).toContain('提示词描述')
    expect(html).toContain('风格限定')
    expect(html).toContain('小明背着书包走进教室')
    expect(html).toContain('data-copy-shot')
  })
})
