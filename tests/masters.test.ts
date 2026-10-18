import { describe, it, expect } from 'vitest'
import {
  listMasters,
  resolveMasterId,
  masterLabelSuffix,
  getScriptMasterAddendum,
  getStoryboardMasterAddendum,
} from '@core/services/masters.js'

describe('剧本大师（masters）', () => {
  it('内置大师包含山之音', () => {
    const masters = listMasters()
    expect(masters.some((m) => m.id === 'shanzhiyin' && m.name === '山之音')).toBe(true)
  })

  it('resolveMasterId：id / 中文名 / 默认别名 / 未知值', () => {
    expect(resolveMasterId('shanzhiyin')).toBe('shanzhiyin')
    expect(resolveMasterId('山之音')).toBe('shanzhiyin')
    expect(resolveMasterId('')).toBe('')
    expect(resolveMasterId('default')).toBe('')
    expect(resolveMasterId('默认')).toBe('')
    expect(resolveMasterId(undefined)).toBe('')
    expect(resolveMasterId(null)).toBe('')
    expect(resolveMasterId('不存在的大师')).toBe('')
  })

  it('默认大师：附录与标签后缀均为空串', () => {
    expect(getScriptMasterAddendum('')).toBe('')
    expect(getScriptMasterAddendum(undefined)).toBe('')
    expect(getStoryboardMasterAddendum('')).toBe('')
    expect(masterLabelSuffix('')).toBe('')
    expect(masterLabelSuffix(undefined)).toBe('')
  })

  it('山之音剧本附录：解压出方法论原文并带护栏约束', () => {
    const addendum = getScriptMasterAddendum('shanzhiyin')
    // 解压出 core-methodology 原文
    expect(addendum).toContain('叙事目的')
    // 护栏：分析参考定位 + 交互流程失效 + 格式契约优先 + 不外泄
    expect(addendum).toContain('大师方法论参考')
    expect(addendum).toContain('一律忽略')
    expect(addendum).toContain('格式规范为唯一标准')
    expect(addendum).toContain('不要在输出中提及')
  })

  it('山之音分镜附录：含镜头设计（shot-design）与核心方法论两篇', () => {
    const addendum = getStoryboardMasterAddendum('shanzhiyin')
    expect(addendum).toContain('动作-反应')
    expect(addendum).toContain('叙事目的')
    // 分镜附录应比剧本附录多出 shot-design 内容
    expect(addendum.length).toBeGreaterThan(getScriptMasterAddendum('shanzhiyin').length)
  })

  it('masterLabelSuffix 拼出 " · 山之音"（也认中文名）', () => {
    expect(masterLabelSuffix('shanzhiyin')).toBe(' · 山之音')
    expect(masterLabelSuffix('山之音')).toBe(' · 山之音')
  })
})
