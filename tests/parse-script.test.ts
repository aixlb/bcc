import { describe, it, expect } from 'vitest'
import { parseScript } from '@shared/parse-script'

describe('parseScript', () => {
  it('解析标准 [HH:MM:SS] 头部 + 编号 + 标题', () => {
    const text = ['[00:00:05] 1-1 大学教室 日/内', '△ 阳光洒进来', '小明：你好'].join('\n')
    const scenes = parseScript(text)
    expect(scenes).toHaveLength(1)
    expect(scenes[0].startSec).toBe(5)
    expect(scenes[0].number).toBe('1-1')
    expect(scenes[0].heading).toBe('大学教室 日/内')
    expect(scenes[0].body).toContain('小明：你好')
  })

  it('把两段式 分:秒 中超过 59 的分钟归一化进小时（75:30 = 1h15m30s）', () => {
    const scenes = parseScript('75:30 长视频场景')
    expect(scenes).toHaveLength(1)
    expect(scenes[0].startSec).toBe(75 * 60 + 30)
  })

  it('拒绝非法时间（三段式 分/秒 > 59 不算头部）', () => {
    const scenes = parseScript('[00:75:00] 不合法')
    expect(scenes).toHaveLength(0)
  })

  it('多个场景按头部切分，首个头部之前的内容被忽略', () => {
    const text = ['# 剧本标题（应忽略）', '[00:00:00] 1 开场', 'a', '[00:01:00] 2 第二场', 'b'].join('\n')
    const scenes = parseScript(text)
    expect(scenes).toHaveLength(2)
    expect(scenes[0].number).toBe('1')
    expect(scenes[0].startSec).toBe(0)
    expect(scenes[1].startSec).toBe(60)
    expect(scenes[1].body).toContain('b')
    // 标题行不应进入任何场景 body
    expect(scenes[0].body).not.toContain('剧本标题')
  })

  it('全角【】括号与中文模型变体也能识别', () => {
    const scenes = parseScript('【00:00:12】第3场 咖啡馆')
    expect(scenes).toHaveLength(1)
    expect(scenes[0].startSec).toBe(12)
  })

  it('空文本返回空数组', () => {
    expect(parseScript('')).toEqual([])
  })
})
