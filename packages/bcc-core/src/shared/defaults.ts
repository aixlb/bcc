/**
 * 应用默认值常量 — 主进程与渲染进程共享
 */

/**
 * 手动新增分镜后、AI 识别尚未完成时的占位描述。
 * 主进程先写入只含「截图 + 时间」的占位镜，渲染层据此判定该镜处于「识别中」态并显示转圈。
 */
export const STORYBOARD_PENDING_DESC = '已加入，等待 AI 识别…'

/** 新生成分镜统一使用的六档景别。 */
export const STORYBOARD_SHOT_TYPES = ['特写', '近景', '中景', '全景', '大全景', '远景'] as const
export type StoryboardShotType = (typeof STORYBOARD_SHOT_TYPES)[number]

/** 七段式提示词描述的固定标签；顺序也是展示、落盘与复制时的唯一顺序。 */
export const STORYBOARD_DESCRIPTION_LABELS = [
  '风格限定',
  '景别',
  '视角构图',
  '主体描述',
  '背景设定',
  '细节修饰',
  '光影色调',
] as const

export type StoryboardDescriptionLabel = (typeof STORYBOARD_DESCRIPTION_LABELS)[number]
export type StoryboardDescriptionParts = Record<StoryboardDescriptionLabel, string>

const DESCRIPTION_KEY_ALIASES: Record<StoryboardDescriptionLabel, string[]> = {
  风格限定: ['风格限定', 'style', 'styleLimit', 'visualStyle'],
  景别: ['景别', 'shotType', 'shotSize'],
  视角构图: ['视角构图', 'viewComposition', 'viewpointComposition', 'composition'],
  主体描述: ['主体描述', 'subject', 'subjectDescription'],
  背景设定: ['背景设定', 'background', 'backgroundSetting'],
  细节修饰: ['细节修饰', 'details', 'detailDecoration'],
  光影色调: ['光影色调', 'lightingColor', 'lightAndColor'],
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

/**
 * 把历史九档/模型自由文本归一成六档。新内容不再产生「极特写/中近景/中远景/极远景」。
 * 无法判断时使用近景，保持与历史兜底一致。
 */
export function normalizeStoryboardShotType(value: unknown): StoryboardShotType {
  const raw = textValue(value)
  if (!raw) return '近景'
  if (raw.includes('大全景')) return '大全景'
  if (raw.includes('极特写') || raw.includes('大特写') || raw.includes('特写')) return '特写'
  if (raw.includes('中近景') || raw.includes('近景')) return '近景'
  if (raw.includes('中远景')) return '全景'
  if (raw.includes('中景')) return '中景'
  if (raw.includes('极远景') || raw.includes('远景')) return '远景'
  if (raw.includes('全景')) return '全景'
  return '近景'
}

function emptyDescriptionParts(): StoryboardDescriptionParts {
  return {
    风格限定: '',
    景别: '',
    视角构图: '',
    主体描述: '',
    背景设定: '',
    细节修饰: '',
    光影色调: '',
  }
}

/**
 * 接受模型常见的两种返回：七键对象，或已经排成七行的字符串。
 * 普通旧版 prose 返回 null，由调用方决定保留还是升级为七段。
 */
export function parseStoryboardDescriptionParts(value: unknown): StoryboardDescriptionParts | null {
  const parts = emptyDescriptionParts()
  let matched = 0

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const label of STORYBOARD_DESCRIPTION_LABELS) {
      const key = DESCRIPTION_KEY_ALIASES[label].find((candidate) => candidate in record)
      if (!key) continue
      parts[label] = textValue(record[key]).replace(/\r?\n+/g, ' ')
      matched++
    }
    return matched > 0 ? parts : null
  }

  if (typeof value !== 'string') return null
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s*/, '')
    for (const label of STORYBOARD_DESCRIPTION_LABELS) {
      const match = line.match(new RegExp(`^${label}\\s*[：:]\\s*(.*)$`))
      if (!match) continue
      parts[label] = match[1].trim()
      matched++
      break
    }
  }
  return matched > 0 ? parts : null
}

/** 把七项内容排成稳定、可直接复制给图像模型的七行提示词。 */
export function formatStoryboardDescription(
  parts: Partial<StoryboardDescriptionParts>,
  shotType: unknown
): string {
  const normalized: StoryboardDescriptionParts = {
    ...emptyDescriptionParts(),
    ...parts,
    // 顶层 shotType 是唯一权威值，避免同一镜头出现两个互相矛盾的景别。
    景别: normalizeStoryboardShotType(shotType),
  }
  return STORYBOARD_DESCRIPTION_LABELS.map(
    (label) => `${label}：${textValue(normalized[label]).replace(/\r?\n+/g, ' ')}`
  ).join('\n')
}

/** 识别新七段格式；旧版自然语言描述、等待态和失败态均返回 false。 */
export function isStructuredStoryboardDescription(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parts = parseStoryboardDescriptionParts(value)
  return !!parts && STORYBOARD_DESCRIPTION_LABELS.every((label) =>
    new RegExp(`(?:^|\\n)${label}\\s*[：:]`).test(value)
  )
}

/** 新建/人工改写时使用的空白七段模板。 */
export function createStoryboardDescriptionTemplate(shotType: unknown = '近景'): string {
  return formatStoryboardDescription(emptyDescriptionParts(), shotType)
}

/**
 * 无论默认 prompt、自定义 prompt 还是大师方法论，最终都必须以此契约收尾。
 * `storyboard-manager.buildAnalyzePrompt` 应把它放在自定义内容与大师附录之后。
 */
export const STORYBOARD_OUTPUT_CONTRACT = `## 固定输出契约

请严格只返回一个 JSON 对象，不要包含 Markdown 代码块或其他说明文字：

{
  "shotType": "特写/近景/中景/全景/大全景/远景之一",
  "angle": "角度",
  "cameraMove": "运镜",
  "description": {
    "风格限定": "画面风格类型",
    "景别": "必须与顶层 shotType 完全一致",
    "视角构图": "视角+构图方式",
    "主体描述": "核心主体的外形、动作、表情、服饰等",
    "背景设定": "主体所处环境",
    "细节修饰": "画面微观细节与质感",
    "光影色调": "光影效果与色彩基调"
  },
  "dialogue": "截图中可见或可推断的台词/对白",
  "sound": "推断的音效/音乐/环境声"
}

要求：
- shotType 只能是：特写、近景、中景、全景、大全景、远景
- description 必须包含上述七项，不能合并、改名或遗漏
- description.景别 必须与顶层 shotType 完全一致
- 方括号式说明是填写要求，不要把方括号原样输出
- 严格基于画面内容，不要编造不存在的信息；无法判断的项使用空字符串`

export const STORYBOARD_DEFAULT_ANALYSIS_PROMPT = `你是一位资深影视分镜分析师。请分析提供的视频截图，为每个镜头提取景别、视角、运镜、台词、声音，以及可直接用于视觉生成的七段式提示词描述。

## 字段说明

1. **shotType（景别）**：请从以下选项中选择最准确的一个
   - 特写、近景、中景、全景、大全景、远景
   - 如果有多个主体在画面中的不同距离，选择主导画面的那个

2. **angle（角度）**：请从以下选项中选择
   - 平视角、俯视、仰视、侧视角、鸟瞰、低角度、高角度

3. **cameraMove（运镜）**：请从以下选项中选择
   - 静态镜头、推镜、拉镜、摇镜、移镜、跟拍镜头、升降镜头、手持镜头、切镜

4. **description（七段式提示词描述）**：
   - 风格限定：[画面风格类型]
   - 景别：[特写/近景/中景/全景/大全景/远景]
   - 视角构图：[视角+构图方式]
   - 主体描述：[核心主体的外形、动作、表情、服饰等]
   - 背景设定：[主体所处环境]
   - 细节修饰：[画面微观细节与质感]
   - 光影色调：[光影效果与色彩基调]

5. **dialogue（台词）**：
   - 如果截图中有字幕或人物口型在说话，写出可见的台词
   - 如果没有可见台词但画面暗示了对话内容，用"（暗示：xxx）"标注
   - 如果完全无法推断，留空字符串 ""

6. **sound（音效）**：
   - 根据画面内容推断可能伴随的音效或音乐
   - 例如："悲伤的钢琴背景音乐"、"城市街道的环境噪音"、"急促的呼吸声"
   - 如果无法推断，留空字符串 ""

## 重要原则

- 严格基于画面内容，不要编造不存在的信息
- 如果画面模糊或信息不足，如实说明
- 重点关注画面的情感氛围和镜头语言
`

/** 默认路径自身保持完整；manager 改造后应改用 ANALYSIS + 大师附录 + OUTPUT_CONTRACT。 */
export const STORYBOARD_DEFAULT_PROMPT =
  `${STORYBOARD_DEFAULT_ANALYSIS_PROMPT.trim()}\n\n${STORYBOARD_OUTPUT_CONTRACT}`
