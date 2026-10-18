import { describe, it, expect } from 'vitest'
import {
  BUILTIN_MODEL_PRESETS,
  mergeModelPresets,
  type ModelPresetMap,
} from '@shared/model-presets'

describe('BUILTIN_MODEL_PRESETS', () => {
  it('Gemini 只保留最新两个模型', () => {
    expect(BUILTIN_MODEL_PRESETS.gemini.map((m) => m.value)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
    ])
  })

  it('已下线的旧 Gemini 模型不再出现在预设里', () => {
    const values = BUILTIN_MODEL_PRESETS.gemini.map((m) => m.value)
    expect(values).not.toContain('gemini-3.1-flash-lite-preview')
    expect(values).not.toContain('gemini-3-flash-preview')
    expect(values).not.toContain('gemini-3-pro-preview')
    expect(values).not.toContain('gemini-2.5-flash')
  })

  it('Anthropic 预设只保留最新主力模型', () => {
    expect(BUILTIN_MODEL_PRESETS.anthropic.map((m) => m.value)).toEqual(['claude-fable-5'])
  })

  it('OpenAI 以 GPT-5.6 为推荐并保留 GPT-5.5', () => {
    expect(BUILTIN_MODEL_PRESETS.openai.map((m) => m.value)).toEqual(['gpt-5.6', 'gpt-5.5'])
  })

  it('Kimi 支持 K3，且不再内置 K2.7 以前的模型', () => {
    expect(BUILTIN_MODEL_PRESETS.kimi.map((m) => m.value)).toEqual([
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
    ])
    expect(BUILTIN_MODEL_PRESETS.kimi).not.toContainEqual(expect.objectContaining({ value: 'kimi-k2.6' }))
    expect(BUILTIN_MODEL_PRESETS.kimi).not.toContainEqual(expect.objectContaining({ value: 'kimi-k2.5' }))
  })
})

describe('mergeModelPresets — 扩展 + 覆盖', () => {
  it('override 为 null/缺省时原样返回内置（深拷贝，不串改）', () => {
    const merged = mergeModelPresets(BUILTIN_MODEL_PRESETS, null)
    expect(merged.gemini.map((m) => m.value)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite'])
    merged.gemini[0].label = '改了'
    expect(BUILTIN_MODEL_PRESETS.gemini[0].label).not.toBe('改了')
  })

  it('同名 value 覆盖 label/desc 且保持原顺序', () => {
    const merged = mergeModelPresets(BUILTIN_MODEL_PRESETS, {
      gemini: [{ value: 'gemini-3.5-flash', label: '我的 3.5', desc: '自定义说明' }],
    })
    expect(merged.gemini[0]).toEqual({ value: 'gemini-3.5-flash', label: '我的 3.5', desc: '自定义说明' })
    expect(merged.gemini.map((m) => m.value)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite'])
  })

  it('新 value 追加到列表末尾', () => {
    const merged = mergeModelPresets(BUILTIN_MODEL_PRESETS, {
      gemini: [{ value: 'gemini-4.0-flash', label: 'Gemini 4 Flash', desc: '将来的模型' }],
    })
    expect(merged.gemini.map((m) => m.value)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-4.0-flash',
    ])
  })

  it('缺 label 时回退用 value；缺 desc 时为空串', () => {
    const merged = mergeModelPresets(BUILTIN_MODEL_PRESETS, {
      kimi: [{ value: 'kimi-k3.1' }],
    })
    const added = merged.kimi.find((m) => m.value === 'kimi-k3.1')
    expect(added).toEqual({ value: 'kimi-k3.1', label: 'kimi-k3.1', desc: '' })
  })

  it('忽略非法条目（缺 value / 非对象），不抛错', () => {
    const merged = mergeModelPresets(BUILTIN_MODEL_PRESETS, {
      gemini: [null, 42, { label: '没有 value' }, { value: '   ' }],
    } as unknown as Record<string, unknown>)
    expect(merged.gemini.map((m) => m.value)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite'])
  })

  it('删不掉内置项（override 不含某内置 value 时它仍在）', () => {
    const merged = mergeModelPresets(BUILTIN_MODEL_PRESETS, { gemini: [] })
    expect(merged.gemini.length).toBe(2)
  })

  it('同一 value 在 override 中多次出现以最后一次为准', () => {
    const merged = mergeModelPresets(BUILTIN_MODEL_PRESETS, {
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
    const merged: ModelPresetMap = mergeModelPresets(BUILTIN_MODEL_PRESETS, {
      somethingElse: [{ value: 'x', label: 'x', desc: '' }],
    })
    expect(Object.keys(merged).sort()).toEqual(['anthropic', 'gemini', 'kimi', 'minimax', 'openai'])
  })
})
