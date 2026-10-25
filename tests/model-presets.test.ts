import { describe, it, expect } from 'vitest'
import {
  BUILTIN_MODEL_PRESETS,
  DEFAULT_MODELS,
  mergeModelPresets,
  type ModelPresetMap,
} from '@shared/model-presets'

describe('模型目录完整性', () => {
  it('每个供应商的模型 ID 唯一，默认模型存在且每项有名称', () => {
    for (const [provider, presets] of Object.entries(BUILTIN_MODEL_PRESETS)) {
      expect(new Set(presets.map((preset) => preset.value)).size).toBe(presets.length)
      expect(presets.some((preset) => preset.value === DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS])).toBe(true)
      expect(presets.every((preset) => preset.value.trim() && preset.label.trim())).toBe(true)
    }
  })
})

describe('mergeModelPresets — 扩展 + 覆盖', () => {
  // 合并行为使用固定夹具，日后增删正式模型只需修改 JSON 目录。
  const builtin: ModelPresetMap = {
    ...BUILTIN_MODEL_PRESETS,
    gemini: [
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', desc: 'Flash' },
      { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', desc: 'Lite' },
    ],
  }
  it('override 为 null/缺省时原样返回内置（深拷贝，不串改）', () => {
    const merged = mergeModelPresets(builtin, null)
    expect(merged.gemini.map((m) => m.value)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite'])
    merged.gemini[0].label = '改了'
    expect(builtin.gemini[0].label).not.toBe('改了')
  })

  it('同名 value 覆盖 label/desc 且保持原顺序', () => {
    const merged = mergeModelPresets(builtin, {
      gemini: [{ value: 'gemini-3.5-flash', label: '我的 3.5', desc: '自定义说明' }],
    })
    expect(merged.gemini[0]).toEqual({ value: 'gemini-3.5-flash', label: '我的 3.5', desc: '自定义说明' })
    expect(merged.gemini.map((m) => m.value)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite'])
  })

  it('新 value 追加到列表末尾', () => {
    const merged = mergeModelPresets(builtin, {
      gemini: [{ value: 'gemini-4.0-flash', label: 'Gemini 4 Flash', desc: '将来的模型' }],
    })
    expect(merged.gemini.map((m) => m.value)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-4.0-flash',
    ])
  })

  it('缺 label 时回退用 value；缺 desc 时为空串', () => {
    const merged = mergeModelPresets(builtin, {
      kimi: [{ value: 'kimi-k3.1' }],
    })
    const added = merged.kimi.find((m) => m.value === 'kimi-k3.1')
    expect(added).toEqual({ value: 'kimi-k3.1', label: 'kimi-k3.1', desc: '' })
  })

  it('忽略非法条目（缺 value / 非对象），不抛错', () => {
    const merged = mergeModelPresets(builtin, {
      gemini: [null, 42, { label: '没有 value' }, { value: '   ' }],
    } as unknown as Record<string, unknown>)
    expect(merged.gemini.map((m) => m.value)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite'])
  })

  it('删不掉内置项（override 不含某内置 value 时它仍在）', () => {
    const merged = mergeModelPresets(builtin, { gemini: [] })
    expect(merged.gemini.length).toBe(2)
  })

  it('同一 value 在 override 中多次出现以最后一次为准', () => {
    const merged = mergeModelPresets(builtin, {
      minimax: [
        { value: 'MiniMax-M4', label: '第一次', desc: 'a' },
        { value: 'MiniMax-M4', label: '最后一次', desc: 'b' },
      ],
    })
    const m4 = merged.minimax.filter((m) => m.value === 'MiniMax-M4')
    expect(m4).toHaveLength(1)
    expect(m4[0]).toEqual({ value: 'MiniMax-M4', label: '最后一次', desc: 'b' })
  })

  it('未知供应商键被忽略，五个内置键始终存在', () => {
    const merged: ModelPresetMap = mergeModelPresets(builtin, {
      somethingElse: [{ value: 'x', label: 'x', desc: '' }],
    })
    expect(Object.keys(merged).sort()).toEqual(['anthropic', 'gemini', 'kimi', 'minimax', 'openai'])
  })
})
