import { describe, expect, it } from 'vitest'
import {
  STORYBOARD_DEFAULT_ANALYSIS_PROMPT,
  STORYBOARD_OUTPUT_CONTRACT,
} from '@shared/defaults.js'
import { buildAnalyzePrompt } from '@core/services/storyboard-manager.js'

describe('buildAnalyzePrompt', () => {
  it('自定义任务 + 大师之后始终以固定输出契约收尾', () => {
    const prompt = buildAnalyzePrompt('  自定义分析任务  ', 'shanzhiyin')
    expect(prompt.startsWith('自定义分析任务')).toBe(true)
    expect(prompt).toContain('大师方法论参考')
    expect(prompt.endsWith(STORYBOARD_OUTPUT_CONTRACT)).toBe(true)
    expect(prompt.indexOf('大师方法论参考')).toBeLessThan(prompt.indexOf(STORYBOARD_OUTPUT_CONTRACT))
  })

  it('默认路径只拼一次分析任务与输出契约', () => {
    const prompt = buildAnalyzePrompt(undefined, undefined)
    expect(prompt.startsWith(STORYBOARD_DEFAULT_ANALYSIS_PROMPT)).toBe(true)
    expect(prompt.endsWith(STORYBOARD_OUTPUT_CONTRACT)).toBe(true)
    expect(prompt.split(STORYBOARD_OUTPUT_CONTRACT).length - 1).toBe(1)
  })
})
