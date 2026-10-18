/**
 * smart 分镜切割 — 纯函数级测试。
 * 用合成的 64×36 灰度帧序列驱动 analyzeGrayFrames，验证四检测器融合的可观测契约：
 * 硬切命中、白闪/渐白转场命中、连续渐变（运镜/变焦模拟）不误报、minGap 过滤、分镜边界组装；
 * v2 新增：强突刺分支（高运动基线）、锋面双重门控（甩镜拦截/慢擦除命中）、去重窗口跟随 minGap 收缩；
 * v3 新增：借鉴 crv 的 density floor + sliding-window dedup，为长镜头补覆盖帧但不补重复静态画面。
 */
import { describe, it, expect } from 'vitest'
import {
  analyzeGrayFrames,
  buildShots,
  filterMinGap,
  SMART_CUT_DEFAULTS,
  SMART_CUT_FPS,
  type SmartCut,
} from '@core/services/smart-cut'

const W = 64
const H = 36
const FRAME_SIZE = W * H
const FPS = SMART_CUT_FPS

/** 生成 n 帧恒定灰度值的帧序列片段 */
function constFrames(value: number, n: number): number[] {
  return Array(n).fill(value)
}

/** 生成 from → to 的线性渐变片段（不含 from 本身，含 to 前的中间帧） */
function rampFrames(from: number, to: number, n: number): number[] {
  const out: number[] = []
  for (let i = 1; i <= n; i++) out.push(Math.round(from + ((to - from) * i) / n))
  return out
}

/** 把「每帧灰度值」序列展开成 rawvideo 缓冲（整帧同值） */
function framesToBuffer(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * FRAME_SIZE)
  for (let i = 0; i < values.length; i++) {
    buf.fill(values[i], i * FRAME_SIZE, (i + 1) * FRAME_SIZE)
  }
  return buf
}

/** 生成 n 帧、像素值由 pixelAt(帧号, x, y) 决定的帧序列（用于合成空间结构：条纹/擦除锋面） */
function pixelFrames(n: number, pixelAt: (i: number, x: number, y: number) => number): Uint8Array {
  const buf = new Uint8Array(n * FRAME_SIZE)
  for (let i = 0; i < n; i++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) buf[i * FRAME_SIZE + y * W + x] = pixelAt(i, x, y)
    }
  }
  return buf
}

function analyze(values: number[]) {
  return analyzeGrayFrames(framesToBuffer(values), FPS, SMART_CUT_DEFAULTS)
}

describe('analyzeGrayFrames', () => {
  it('硬切：中灰 → 亮灰 的单帧突变，命中且只命中一个 hard 切点', () => {
    const values = [...constFrames(100, 3 * FPS), ...constFrames(160, 3 * FPS)]
    const { cuts, duration } = analyze(values)

    expect(cuts).toHaveLength(1)
    expect(cuts[0].kind).toBe('hard')
    expect(cuts[0].time).toBeGreaterThan(2.8)
    expect(cuts[0].time).toBeLessThan(3.2)
    expect(duration).toBeCloseTo(6, 1)
  })

  it('恒定画面：零切点、单分镜', () => {
    const values = constFrames(100, 6 * FPS)
    const { cuts, duration } = analyze(values)
    expect(cuts).toHaveLength(0)

    const shots = buildShots(cuts, duration)
    expect(shots).toHaveLength(1)
    expect(shots[0].start).toBe(0)
    expect(shots[0].end).toBeCloseTo(6, 1)
  })

  it('连续缓慢渐变（推拉镜/速度渐变模拟）：不误报', () => {
    // 6 秒内 100 → 160，每帧差约 0.33，远低于 hardMin，也够不着锋面/叠化阈值
    const values = [...constFrames(100, FPS), ...rampFrames(100, 160, 6 * FPS), ...constFrames(160, FPS)]
    const { cuts } = analyze(values)
    expect(cuts).toHaveLength(0)
  })

  it('长恒定画面：density floor 候选被滑窗去重丢掉，不制造假分镜', () => {
    const values = constFrames(100, 30 * FPS)
    const { cuts, duration } = analyze(values)
    expect(cuts).toHaveLength(0)

    const shots = buildShots(cuts, duration)
    expect(shots).toHaveLength(1)
    expect(shots[0].end).toBeCloseTo(30, 1)
  })

  it('长镜头缓慢变化：按 density floor 补 sample 覆盖点，分数低于真实切点', () => {
    const values = rampFrames(80, 180, 24 * FPS)
    const { cuts, duration } = analyze(values)

    expect(cuts.map((c) => c.kind)).toEqual(['sample', 'sample'])
    expect(cuts[0].time).toBeGreaterThan(7.8)
    expect(cuts[0].time).toBeLessThan(8.2)
    expect(cuts[1].time).toBeGreaterThan(15.8)
    expect(cuts[1].time).toBeLessThan(16.2)
    expect(Math.max(...cuts.map((c) => c.score))).toBeLessThanOrEqual(0.01)

    const shots = buildShots(cuts, duration)
    expect(shots).toHaveLength(3)
    expect(shots[1].kind).toBe('sample')
    expect(shots[2].kind).toBe('sample')
  })

  it('单帧白闪：合并去重后只出一个切点', () => {
    const values = [...constFrames(100, 2 * FPS), 255, ...constFrames(160, 2 * FPS)]
    const { cuts } = analyze(values)
    expect(cuts).toHaveLength(1)
    expect(cuts[0].time).toBeGreaterThan(1.8)
    expect(cuts[0].time).toBeLessThan(2.2)
  })

  it('渐白长转场（帧差摊薄在坡道上，硬切检测失明）：由 blank 检测器兜底', () => {
    // 100 →(1.2s 渐白)→ 255 →(0.3s 白场)→(1.2s 渐暗)→ 160，坡道每帧差 <hardMin
    const values = [
      ...constFrames(100, 2 * FPS),
      ...rampFrames(100, 255, 36),
      ...constFrames(255, 9),
      ...rampFrames(255, 160, 36),
      ...constFrames(160, 2 * FPS),
    ]
    const { cuts } = analyze(values)
    expect(cuts).toHaveLength(1)
    expect(cuts[0].kind).toBe('blank')
    // 白场区间（mean>190）约始于 2.7s
    expect(cuts[0].time).toBeGreaterThan(2.4)
    expect(cuts[0].time).toBeLessThan(3.0)
  })

  it('切点带干净前后帧（preT < time ≤ postT 合理排布）', () => {
    const values = [...constFrames(100, 3 * FPS), ...constFrames(160, 3 * FPS)]
    const { cuts } = analyze(values)
    expect(cuts[0].preT).toBeLessThan(cuts[0].time)
    expect(cuts[0].postT).toBeGreaterThan(cuts[0].time)
  })

  it('强突刺分支：高运动基线（打斗模拟）抬高中位数，真切点仅 4× 倍率仍命中', () => {
    // 交替亮度模拟逐帧高运动：基线 d1 恒为 12（局部中位数 12），
    // 切点 d1=48 只有 4× 中位数——常规 8x 分支会漏检，强突刺分支（d1≥24 且 hd1 大）接住
    const seg = (base: number, n: number): number[] =>
      Array.from({ length: n }, (_, i) => (i % 2 === 0 ? base : base + 12))
    const values = [...seg(100, 3 * FPS), ...seg(160, 3 * FPS)]
    const { cuts } = analyze(values)
    expect(cuts).toHaveLength(1)
    expect(cuts[0].kind).toBe('hard')
    expect(cuts[0].time).toBeGreaterThan(2.8)
    expect(cuts[0].time).toBeLessThan(3.2)
  })

  it('甩镜/摇镜模拟（条纹平移，调色盘不变）：锋面双重门控拦截，0 切点', () => {
    // 周期 16px 竖条纹每帧右移 1px：列差远超锋面阈值且成完美传播链，
    // 但直方图恒定（histDiff≈0）且 d1 基线高——v2 双重门控应全数拦下
    const buf = pixelFrames(6 * FPS, (i, x) => (((x + i) % 16) < 8 ? 40 : 200))
    const { cuts } = analyzeGrayFrames(buf, FPS, SMART_CUT_DEFAULTS)
    expect(cuts).toHaveLength(0)
  })

  it('一镜到底慢擦除（锋面左→右扫过，帧差摊薄硬切失明）：front 命中', () => {
    const start = 3 * FPS
    const wipeFrames = 42 // 1.4s 扫完 64px：每帧 ~1.5px，d1≈2.9 低于 hardMin，唯有锋面能抓
    const buf = pixelFrames(6 * FPS + wipeFrames, (i, x) => {
      const edge = ((i - start) * W) / wipeFrames
      return i < start ? 60 : x < edge ? 180 : 60
    })
    const { cuts } = analyzeGrayFrames(buf, FPS, SMART_CUT_DEFAULTS)
    expect(cuts).toHaveLength(1)
    expect(cuts[0].kind).toBe('front')
    expect(cuts[0].time).toBeGreaterThan(3.0)
    expect(cuts[0].time).toBeLessThan(4.5)
  })

  it('去重窗口跟随 minGap 收缩：0.17s 相邻双硬切默认合并，minGap=0.1 时拆开', () => {
    const values = [...constFrames(100, 2 * FPS), ...constFrames(160, 5), ...constFrames(60, 2 * FPS)]
    const def = analyze(values)
    expect(def.cuts).toHaveLength(1)
    const fine = analyzeGrayFrames(framesToBuffer(values), FPS, { ...SMART_CUT_DEFAULTS, minGap: 0.1 })
    expect(fine.cuts).toHaveLength(2)
    expect(fine.cuts.map((c) => c.kind)).toEqual(['hard', 'hard'])
  })
})

describe('filterMinGap', () => {
  const mk = (time: number, kind: SmartCut['kind'], score = 0.5): SmartCut => ({
    time,
    score,
    kind,
    preT: time - 0.1,
    postT: time + 0.1,
  })

  it('间隔过近时按 kind 优先级保留（hard > blank > front > dissolve > sample）', () => {
    expect(filterMinGap([mk(1.0, 'dissolve'), mk(1.2, 'hard')], 0.5).map((c) => c.kind)).toEqual(['hard'])
    expect(filterMinGap([mk(1.0, 'hard'), mk(1.2, 'dissolve')], 0.5).map((c) => c.kind)).toEqual(['hard'])
    expect(filterMinGap([mk(1.0, 'sample'), mk(1.2, 'dissolve')], 0.5).map((c) => c.kind)).toEqual(['dissolve'])
  })

  it('间隔足够时全部保留', () => {
    const out = filterMinGap([mk(1.0, 'hard'), mk(2.0, 'blank')], 0.5)
    expect(out).toHaveLength(2)
  })
})

describe('buildShots', () => {
  const mk = (time: number, postT: number): SmartCut => ({
    time,
    score: 0.5,
    kind: 'hard',
    preT: time - 0.1,
    postT,
  })

  it('掐掉贴边切点，边界成对拼装', () => {
    const shots = buildShots([mk(0.005, 0.1), mk(2, 2.1), mk(5.995, 6)], 6)
    expect(shots).toHaveLength(2)
    expect(shots[0].start).toBe(0)
    expect(shots[0].end).toBe(2)
    expect(shots[1].start).toBe(2)
    expect(shots[1].end).toBe(6)
  })

  it('thumbT 用起始切点的 postT（避开转场白/黑帧），且不越过下一边界', () => {
    const shots = buildShots([mk(2, 2.3)], 6)
    expect(shots[1].thumbT).toBeCloseTo(2.3, 5)
    const tight = buildShots([mk(2, 9)], 6)
    expect(tight[1].thumbT).toBeLessThanOrEqual(6)
  })
})
