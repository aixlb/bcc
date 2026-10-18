/**
 * 模型预设清单（GUI「模型」下拉用）。内置默认值 + 可被数据目录下的 models.json 覆盖/扩展。
 *
 * 设计动机：以前每加一个新模型都要改源码再发版；现在用户可在 config.yaml 同目录放一个
 * models.json，免升级即可增删模型下拉项（合并语义见 mergeModelPresets）。
 *
 * 注意：本清单仅影响 GUI 的下拉预设；实际调用的模型是配置里保存的那个字符串。
 * CLI 一直支持任意模型名（`bcc config set gemini.model <任意值>`），不依赖本清单。
 */

export interface ModelPreset {
  /** 模型 ID（被选中后写入 config 的值） */
  value: string
  /** 下拉里显示的名字 */
  label: string
  /** 一行说明 */
  desc: string
}

/** 内置预设覆盖的五个供应商（自定义供应商不在此列） */
export type BuiltinProviderKey = 'gemini' | 'kimi' | 'minimax' | 'openai' | 'anthropic'

export type ModelPresetMap = Record<BuiltinProviderKey, ModelPreset[]>

export const BUILTIN_PROVIDER_KEYS: BuiltinProviderKey[] = ['gemini', 'kimi', 'minimax', 'openai', 'anthropic']

/**
 * 内置默认预设（随版本发布；models.json 缺失或解析失败时即用这套）。
 * Gemini 只保留官方在用的最新两个（gemini-3.1-flash-lite-preview / gemini-3-pro-preview 等已被 Google 下线）。
 */
export const BUILTIN_MODEL_PRESETS: ModelPresetMap = {
  gemini: [
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', desc: '推荐：最新主力 flash，1M 上下文，快且便宜' },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', desc: '最便宜最快，适合批量任务' },
  ],
  kimi: [
    { value: 'kimi-k3', label: 'Kimi K3', desc: '推荐：最新一代，支持视频/图像理解' },
    { value: 'kimi-k2.7-code', label: 'Kimi K2.7', desc: '支持视频/图像理解，推理能力强' },
    { value: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 高速版', desc: '同 K2.7，出字更快但更贵' },
  ],
  minimax: [
    { value: 'MiniMax-M3', label: 'MiniMax-M3', desc: '原生多模态，支持视频理解，1M 上下文' },
  ],
  openai: [
    { value: 'gpt-5.6', label: 'GPT-5.6', desc: '推荐：最新旗舰多模态，剧本走关键帧多图分析' },
    { value: 'gpt-5.5', label: 'GPT-5.5', desc: '上一代主力多模态，剧本走关键帧多图分析' },
  ],
  anthropic: [
    { value: 'claude-fable-5', label: 'Claude Fable 5', desc: '最强推理与视觉理解，剧本走关键帧多图分析' },
  ],
}

/** 把任意来源的数据宽松规整成 ModelPreset（容忍缺 label/desc）；不合法返回 null。 */
function coercePreset(raw: unknown): ModelPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const value = typeof r.value === 'string' ? r.value.trim() : ''
  if (!value) return null
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : value
  const desc = typeof r.desc === 'string' ? r.desc : ''
  return { value, label, desc }
}

/**
 * 合并语义：**扩展 + 覆盖**。
 * - 内置预设始终保留；
 * - override 里 value 与内置相同 → 覆盖其 label/desc（保持原顺序）；
 * - override 里新出现的 value → 追加到该供应商列表末尾；
 * - override 里同一 value 出现多次，以最后一次为准；
 * - 删不掉内置项（有意的安全取舍：再坏的 models.json 也不会让下拉变空）。
 *
 * @param override models.json 解析后的对象（形如 `{ gemini: [...], kimi: [...] }`），可为 null。
 */
export function mergeModelPresets(
  builtin: ModelPresetMap,
  override: Record<string, unknown> | null | undefined,
): ModelPresetMap {
  const result = {} as ModelPresetMap
  for (const key of BUILTIN_PROVIDER_KEYS) {
    const order: ModelPreset[] = (builtin[key] ?? []).map((p) => ({ ...p }))
    const byValue = new Map(order.map((p) => [p.value, p]))

    const rawList = override?.[key]
    if (Array.isArray(rawList)) {
      for (const rawItem of rawList) {
        const preset = coercePreset(rawItem)
        if (!preset) continue
        const existing = byValue.get(preset.value)
        if (existing) {
          existing.label = preset.label
          existing.desc = preset.desc
        } else {
          byValue.set(preset.value, preset)
          order.push(preset)
        }
      }
    }
    result[key] = order
  }
  return result
}
