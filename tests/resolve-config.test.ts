import { describe, it, expect } from 'vitest'
import type { AppConfig } from '@shared/types'
import { resolveAnalyzerConfig, resolveSynthesizerConfig } from '@core/index.js'

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    gemini: { api_key: 'g-key', model: 'gemini-x', video_resolution: 'low', proxy: '' },
    kimi: { api_key: 'k-key', model: 'kimi-x', base_url: '' },
    minimax: { api_key: 'm-key', model: 'MiniMax-M3', base_url: '' },
    openai: { api_key: 'o-key', model: 'gpt-5.5', base_url: '' },
    anthropic: { api_key: 'a-key', model: 'claude-fable-5', base_url: '' },
    custom_providers: [],
    script_provider: 'gemini',
    script_master: '',
    storyboard_provider: 'gemini',
    storyboard_master: '',
    storyboard: {
      prompt: '',
      cut_method: 'smart',
      scene_threshold: 0.3,
      smart_hard_min: 5.5,
      smart_hard_ratio: 8,
      smart_min_gap: 0.5,
      max_shots: 200,
      concurrency: 3,
    },
    research: { video_concurrency: 2, synthesis_provider: null, mosaic_frames_per_video: 6, synthesis_prompt: '' },
    ...over,
  }
}

describe('resolveAnalyzerConfig', () => {
  it('gemini 供应商映射', () => {
    const c = resolveAnalyzerConfig(makeConfig())
    expect(c.provider).toBe('gemini')
    expect(c.apiKey).toBe('g-key')
    expect(c.model).toBe('gemini-x')
  })

  it('kimi 走 openai 兼容 + 默认 base_url', () => {
    const c = resolveAnalyzerConfig(makeConfig({ storyboard_provider: 'kimi' }))
    expect(c.provider).toBe('openai')
    expect(c.apiKey).toBe('k-key')
    expect(c.baseUrl).toContain('moonshot')
  })

  it('openai 走 openai 兼容 + 官方默认 base_url', () => {
    const c = resolveAnalyzerConfig(makeConfig({ storyboard_provider: 'openai' }))
    expect(c.provider).toBe('openai')
    expect(c.apiKey).toBe('o-key')
    expect(c.baseUrl).toBe('https://api.openai.com/v1')
    expect(c.model).toBe('gpt-5.5')
  })

  it('anthropic 走 anthropic 专属分析器', () => {
    const c = resolveAnalyzerConfig(makeConfig({ storyboard_provider: 'anthropic' }))
    expect(c.provider).toBe('anthropic')
    expect(c.apiKey).toBe('a-key')
    expect(c.model).toBe('claude-fable-5')
  })

  it('自定义供应商按 id 解析', () => {
    const c = resolveAnalyzerConfig(
      makeConfig({
        storyboard_provider: 'custom1',
        custom_providers: [{ id: 'custom1', name: 'C1', api_key: 'c-key', base_url: 'https://x/v1', model: 'c-model' }],
      })
    )
    expect(c.provider).toBe('openai')
    expect(c.apiKey).toBe('c-key')
    expect(c.model).toBe('c-model')
  })

  it('缺 API Key 抛错', () => {
    expect(() => resolveAnalyzerConfig(makeConfig({ gemini: { api_key: '', model: 'x', video_resolution: 'low', proxy: '' } }))).toThrow()
  })
})

describe('resolveSynthesizerConfig', () => {
  it('synthesis_provider 为 null 时继承 storyboard_provider', () => {
    const c = resolveSynthesizerConfig(makeConfig({ storyboard_provider: 'gemini' }))
    expect(c.provider).toBe('gemini')
  })

  it('显式 minimax 走 openai 兼容', () => {
    const c = resolveSynthesizerConfig(
      makeConfig({ research: { video_concurrency: 2, synthesis_provider: 'minimax', mosaic_frames_per_video: 6, synthesis_prompt: '' } })
    )
    expect(c.provider).toBe('openai')
    expect(c.apiKey).toBe('m-key')
    expect(c.baseUrl).toContain('minimax')
  })

  it('显式 openai 走官方端点', () => {
    const c = resolveSynthesizerConfig(
      makeConfig({ research: { video_concurrency: 2, synthesis_provider: 'openai', mosaic_frames_per_video: 6, synthesis_prompt: '' } })
    )
    expect(c.provider).toBe('openai')
    expect(c.apiKey).toBe('o-key')
    expect(c.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('显式 anthropic 走 anthropic 专属合成器', () => {
    const c = resolveSynthesizerConfig(
      makeConfig({ research: { video_concurrency: 2, synthesis_provider: 'anthropic', mosaic_frames_per_video: 6, synthesis_prompt: '' } })
    )
    expect(c.provider).toBe('anthropic')
    expect(c.apiKey).toBe('a-key')
    expect(c.model).toBe('claude-fable-5')
  })
})
