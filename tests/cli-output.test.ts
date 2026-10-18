import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveOutputs, UsageError } from '../apps/bcc-cli/src/output.js'

describe('resolveOutputs（--out / --format 解析）', () => {
  it('扩展名推断：--out x.docx → 单个 docx 原样路径', () => {
    const r = resolveOutputs({ out: 'x.docx', defaultFormat: 'docx', defaultName: '剧本', allowed: ['docx', 'md', 'html'] })
    expect(r).toHaveLength(1)
    expect(r[0].format).toBe('docx')
    expect(r[0].outPath).toBe(path.resolve('x.docx'))
  })

  it('无 --out 无 --format → 默认格式落到 cwd/<默认名>', () => {
    const r = resolveOutputs({ defaultFormat: 'xlsx', defaultName: '分镜表', allowed: ['xlsx'] })
    expect(r).toHaveLength(1)
    expect(r[0].outPath).toBe(path.resolve('分镜表.xlsx'))
  })

  it('--format 批量：多格式各自落盘', () => {
    const r = resolveOutputs({ format: 'docx,html', defaultFormat: 'docx', defaultName: '剧本', allowed: ['docx', 'html', 'md'] })
    expect(r.map((x) => x.format)).toEqual(['docx', 'html'])
    expect(r[0].outPath).toBe(path.resolve('剧本.docx'))
    expect(r[1].outPath).toBe(path.resolve('剧本.html'))
  })

  it('--out 文件 + 多格式 → 以 --out 的目录与基名派生', () => {
    const r = resolveOutputs({ out: 'dir/名片.docx', format: 'docx,html', defaultFormat: 'docx', defaultName: '剧本', allowed: ['docx', 'html'] })
    expect(r[0].outPath).toBe(path.resolve('dir/名片.docx'))
    expect(r[1].outPath).toBe(path.resolve('dir/名片.html'))
  })

  it('不支持的格式抛 UsageError', () => {
    expect(() => resolveOutputs({ format: 'pdf', defaultFormat: 'docx', defaultName: 'x', allowed: ['docx'] })).toThrow(UsageError)
  })
})
