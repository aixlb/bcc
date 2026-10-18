/**
 * 解析 AI 输出的剧本文本，提取每个场景及其时间戳。
 *
 * 期望格式是场景头部行以 [HH:MM:SS] 开头（见 prompt.ts）。但不同模型会有偏差：
 * Kimi 等中文模型可能用全角【】、只写 分:秒、或在前面加 Markdown 标题/加粗。
 * 这里做「宽松匹配」——尽量把这些变体都识别成场景头部，避免无法同步播放。
 * 严格的 [HH:MM:SS] 格式是本宽松规则的子集，因此不会影响 Gemini 的正常输出。
 */
import type { ScriptScene } from '@shared/types'

/**
 * 从一行里尝试解析「场景头部时间戳」。
 * 允许：
 *  - 行首的 Markdown / 引用 / 列表前缀（# > * - • 以及全角空格）
 *  - 半角 [] 或全角【】或圆括号 () （） 包裹，或不加括号
 *  - 三段式 H:MM:SS / HH:MM:SS，或两段式 M:SS / MM:SS（按 分:秒 解释）
 * 返回 null 表示这一行不是场景头部。
 */
const HEADING_REGEX =
  /^[\s>#*\-•　]*[[【(（]?\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*[\]】)）]?[\s:：、.]*(.*)$/

/** 从头部剩余文本里拆出场景编号（如 1-1 / 1 / 第3场）和标题 */
const NUMBER_REGEX = /^(\d+(?:-\d+)?)[\s.:、)）]*(.*)$/

function parseHeading(line: string): { startSec: number; number: string; heading: string } | null {
  const m = line.match(HEADING_REGEX)
  if (!m) return null

  let hh = 0
  let mm = 0
  let ss = 0
  if (m[3] !== undefined) {
    // 三段：HH:MM:SS —— 分/秒必须 < 60，否则不是合法时间
    hh = parseInt(m[1], 10)
    mm = parseInt(m[2], 10)
    ss = parseInt(m[3], 10)
    if (mm > 59 || ss > 59) return null
  } else {
    // 两段：MM:SS（分:秒）。分钟是「总分钟数」，>59 合法（如 75:30 = 1h15m30s），
    // 仅校验秒，并把超出的分钟归一化进小时，避免长视频的分:秒头部被整段丢弃。
    mm = parseInt(m[1], 10)
    ss = parseInt(m[2], 10)
    if (ss > 59) return null
    hh = Math.floor(mm / 60)
    mm = mm % 60
  }

  const startSec = hh * 3600 + mm * 60 + ss
  const tail = (m[4] ?? '').trim()

  const numMatch = tail.match(NUMBER_REGEX)
  const number = numMatch ? numMatch[1] : ''
  const heading = (numMatch ? numMatch[2].trim() : tail) || number || formatTimecode(startSec)

  return { startSec, number, heading }
}

function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const p = (n: number) => String(n).padStart(2, '0')
  return `[${p(h)}:${p(m)}:${p(s)}]`
}

/**
 * 解析剧本文本为场景数组。
 * 算法：按行扫描，遇到能解析出时间戳的行视为新场景开始。
 */
export function parseScript(scriptText: string): ScriptScene[] {
  const scenes: ScriptScene[] = []
  const lines = scriptText.split('\n')
  let cursor = 0 // 累计字符偏移

  let current: {
    charStart: number
    startSec: number
    heading: string
    number: string
    body: string[]
  } | null = null

  for (const line of lines) {
    const parsed = parseHeading(line)
    const lineLen = line.length + 1 // +1 for \n

    if (parsed) {
      if (current) {
        scenes.push({
          charStart: current.charStart,
          charEnd: cursor,
          startSec: current.startSec,
          heading: current.heading,
          number: current.number,
          body: current.body.join('\n'),
        })
      }
      current = {
        charStart: cursor,
        startSec: parsed.startSec,
        heading: parsed.heading,
        number: parsed.number,
        body: [line],
      }
    } else if (current) {
      current.body.push(line)
    }
    // 头部之前的内容（如 markdown 标题）直接忽略，不归入任何场景

    cursor += lineLen
  }

  if (current) {
    scenes.push({
      charStart: current.charStart,
      charEnd: cursor,
      startSec: current.startSec,
      heading: current.heading,
      number: current.number,
      body: current.body.join('\n'),
    })
  }

  return scenes
}
