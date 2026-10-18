import { describe, expect, it } from 'vitest'
import { getClaudeMaxOutputTokens } from '@core/services/claude.js'

describe('Claude 必填输出上限', () => {
  it('Fable 5 使用模型公开支持的最大输出值', () => {
    expect(getClaudeMaxOutputTokens('claude-fable-5')).toBe(128_000)
    expect(getClaudeMaxOutputTokens('claude-mythos-5')).toBe(128_000)
  })

  it('当前 Opus/Sonnet 4.x 使用 128K，未知旧模型保留兼容值', () => {
    expect(getClaudeMaxOutputTokens('claude-opus-4-8')).toBe(128_000)
    expect(getClaudeMaxOutputTokens('claude-sonnet-4-7')).toBe(128_000)
    expect(getClaudeMaxOutputTokens('claude-legacy')).toBe(64_000)
  })
})
