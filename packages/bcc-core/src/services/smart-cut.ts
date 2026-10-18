/**
 * smart 自适应混合分镜切割 — 四类互补检测器 + 长镜头覆盖补帧（v2：补打斗/高运动内容标定）。
 * 算法设计与常量标定见 sample/算法资料-handoff/分镜切割算法设计.md（参考实现 smart-cut.mjs，逐条对应）：
 *   hard     硬切：帧差突刺。常规分支（倍率 8x 局部中位数；弱突刺加「前后内容差」校验）+ 强突刺分支
 *            （d1≥24 且 [hd1≥0.26 或 单帧刀锋突出度≥3x]，倍率只需 2.2x——打斗等高运动内容
 *            基线高，8x 会淹没真切点；甩镜是多帧高原过不了突出度）
 *   blank    白/黑场转场：低细节或暗/亮占比极高的帧段整体视为转场，比较其前后内容决定是否切
 *   front    擦除锋面：画面 8 列的变化峰值沿列序依次传播（一镜到底穿门洞/墙角的签名）。
 *            双重门控：链首尾直方图必须大变 + 只在平稳运镜中生效（防甩镜/摇镜误报）
 *   dissolve 叠化脉冲：多列同时大变且呈脉冲状（起于平静、归于平静）
 *   sample   覆盖补帧：借鉴 crv 的 density floor + 滑窗去重，只在长镜头内部补“画面确实变了”的采样点
 * 锋面/叠化切点落在硬切/白黑场 ±1.2s 内时被抑制（回声——链跨度可能覆盖到邻近硬切）。
 *
 * 全部分析在 64×36 灰度 @30fps 缩略帧上进行，对码率/分辨率/帧率不敏感。
 * analyzeGrayFrames 为纯函数（喂原始灰度帧即可），供单元测试直接调用。
 */

import { spawn } from 'node:child_process'
import type { SceneScorePoint } from '@shared/types'
import { getFfmpegBin } from './storyboard.js'

/** 分析帧尺寸（灰度缩略帧） */
const W = 64
const H = 36
const FRAME_SIZE = W * H

/** 用户可调参数（其余常量经真值标定，改动需按设计文档 §8 回归） */
export interface SmartCutParams {
  /** 硬切最低帧差（绝对下限，0~255 尺度） */
  hardMin: number
  /** 硬切相对倍率（× 局部中位数） */
  hardRatio: number
  /** 切点最小间隔（秒）。调到 0.1~0.15 可拆动画连环快切（去重窗口跟随收缩），但会增加逐格动作误报 */
  minGap: number
}

export const SMART_CUT_DEFAULTS: SmartCutParams = {
  hardMin: 5.5,
  hardRatio: 8,
  minGap: 0.3,
}

/** 分析帧率（固定 30fps 抽帧，与标定常量绑定，不作为用户参数暴露） */
export const SMART_CUT_FPS = 30

export type SmartCutKind = 'hard' | 'blank' | 'front' | 'dissolve' | 'sample'

export interface SmartCut {
  /** 切点时间（秒） */
  time: number
  /** 归一化得分（0~1，仅同类比较有意义） */
  score: number
  kind: SmartCutKind
  /** 切点前的「干净帧」时间（已跳过变白变黑的转场部分），取帧对比/截图请用它 */
  preT: number
  /** 切点后的「干净帧」时间 */
  postT: number
}

export interface SmartAnalyzeResult {
  /** 已合并去重（但未做 minGap 过滤）的切点 */
  cuts: SmartCut[]
  /** 按抽帧数折算的视频时长（秒） */
  duration: number
  /** 每帧 d1 差异曲线（0~1 归一化，t=帧时间），供时间轴曲线展示 */
  series: SceneScorePoint[]
}

// 真值标定常量（见设计文档 §7 常量总表）
const C = {
  blankStd: 16,
  blankDark: 0.86,
  blankBright: 0.86,
  blankMinFrames: 4,
  blankLongSec: 1.2,
  blankPrePostDiff: 22,
  hardHd1: 0.12,
  strongD1: 24,
  strongHd1: 0.26,
  strongRatio: 2.2,
  strongProm: 3,
  colLagSec: 0.33,
  frontColThresh: 50,
  frontMinCols: 4,
  frontMaxStepSec: 0.7,
  frontSpan: [0.12, 1.5] as const,
  frontHistDiff: 0.35,
  frontCalmMed: 6,
  dissolveCols: 4,
  dissolveColThresh: 42,
  dissolveQuiet: 20,
  dissolveQuietSec: 1.3,
  dedupeSec: 0.28,
  dedupeSoftSec: 1.0,
  echoSec: 1.2,
  weakCrossDiff: 25,
  // crv-style density floor: 长镜头每隔一段时间才“考虑”补帧，真正保留还要过滑窗像素去重。
  // 这些补点不是剪辑切点，所以分数压低，maxShots 截断时真实切点永远优先。
  sampleEverySec: 8,
  sampleEdgeSec: 1,
  sampleDedupWindow: 4,
  sampleDedupPct: 8,
  samplePixelTol: 25,
  sampleScoreMax: 0.01,
}

const KIND_PRIORITY: Record<SmartCutKind, number> = { hard: 5, blank: 4, front: 3, dissolve: 2, sample: 1 }

/**
 * 纯分析函数：输入连续的 64×36 灰度帧（每帧 2304 字节），输出切点与差异曲线。
 * 与参考实现 smart-cut.mjs 的 analyze() 逐行对应。
 */
export function analyzeGrayFrames(
  data: Uint8Array,
  fps: number,
  params: SmartCutParams
): SmartAnalyzeResult {
  const { hardMin, hardRatio, minGap } = params
  const count = Math.floor(data.length / FRAME_SIZE)
  if (count === 0) return { cuts: [], duration: 0, series: [] }

  const frameDiff = (i: number, j: number): number => {
    i = Math.max(0, Math.min(count - 1, i))
    j = Math.max(0, Math.min(count - 1, j))
    const oi = i * FRAME_SIZE
    const oj = j * FRAME_SIZE
    let s = 0
    for (let p = 0; p < FRAME_SIZE; p++) s += Math.abs(data[oi + p] - data[oj + p])
    return s / FRAME_SIZE
  }

  const pctChanged = (i: number, j: number, tol: number): number => {
    i = Math.max(0, Math.min(count - 1, i))
    j = Math.max(0, Math.min(count - 1, j))
    const oi = i * FRAME_SIZE
    const oj = j * FRAME_SIZE
    let changed = 0
    for (let p = 0; p < FRAME_SIZE; p++) {
      if (Math.abs(data[oi + p] - data[oj + p]) > tol) changed++
    }
    return (100 * changed) / FRAME_SIZE
  }

  // ---------- 逐帧基础指标 ----------
  const mean = new Float32Array(count)
  const std = new Float32Array(count)
  const d1 = new Float32Array(count)
  const hd1 = new Float32Array(count)
  const darkFrac = new Float32Array(count)
  const brightFrac = new Float32Array(count)
  const BINS = 32
  // 逐帧直方图整段保留：hd1 与锋面门控的 histDiffAB 都要用
  const hists = new Float32Array(count * BINS)
  for (let i = 0; i < count; i++) {
    const off = i * FRAME_SIZE
    const hOff = i * BINS
    let sum = 0
    let sumSq = 0
    let dark = 0
    let bright = 0
    for (let p = 0; p < FRAME_SIZE; p++) {
      const v = data[off + p]
      sum += v
      sumSq += v * v
      hists[hOff + (v >> 3)]++
      if (v < 40) dark++
      else if (v > 200) bright++
    }
    const m = sum / FRAME_SIZE
    mean[i] = m
    std[i] = Math.sqrt(Math.max(0, sumSq / FRAME_SIZE - m * m))
    darkFrac[i] = dark / FRAME_SIZE
    brightFrac[i] = bright / FRAME_SIZE
    if (i > 0) {
      const prevOff = off - FRAME_SIZE
      let diff = 0
      for (let p = 0; p < FRAME_SIZE; p++) diff += Math.abs(data[off + p] - data[prevOff + p])
      d1[i] = diff / FRAME_SIZE
      const ph = (i - 1) * BINS
      let hdiff = 0
      for (let b = 0; b < BINS; b++) hdiff += Math.abs(hists[hOff + b] - hists[ph + b])
      hd1[i] = hdiff / FRAME_SIZE
    }
  }
  // 任意两帧的直方图差（0~2）。运镜/甩镜不改变调色盘（≈0），换场景才会大
  const histDiffAB = (i: number, j: number): number => {
    const oi = Math.max(0, Math.min(count - 1, i)) * BINS
    const oj = Math.max(0, Math.min(count - 1, j)) * BINS
    let s = 0
    for (let b = 0; b < BINS; b++) s += Math.abs(hists[oi + b] - hists[oj + b])
    return s / FRAME_SIZE
  }

  // ---------- 8 列滞后差（锋面/叠化的信号源） ----------
  const COLS = 8
  const lag = Math.max(1, Math.round(fps * C.colLagSec))
  const colW = Math.floor(W / COLS)
  const colD: Float32Array[] = Array.from({ length: COLS }, () => new Float32Array(count))
  for (let i = lag; i < count; i++) {
    const oi = i * FRAME_SIZE
    const oj = (i - lag) * FRAME_SIZE
    for (let c = 0; c < COLS; c++) {
      let s = 0
      const x0 = c * colW
      for (let y = 0; y < H; y++) {
        const row = y * W
        for (let x = x0; x < x0 + colW; x++) s += Math.abs(data[oi + row + x] - data[oj + row + x])
      }
      colD[c][i] = s / (colW * H)
    }
  }
  const d10 = new Float32Array(count)
  for (let i = lag; i < count; i++) {
    let s = 0
    for (let c = 0; c < COLS; c++) s += colD[c][i]
    d10[i] = s / COLS
  }

  // ---------- 1. blank：白/黑场段 ----------
  const isBlank = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    if (
      (std[i] < C.blankStd && (mean[i] < 50 || mean[i] > 190)) ||
      darkFrac[i] >= C.blankDark ||
      brightFrac[i] >= C.blankBright
    ) {
      isBlank[i] = 1
    }
  }
  const blankIntervals: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    if (!isBlank[i]) continue
    let end = i
    let gap = 0
    for (let j = i + 1; j < count && gap <= 2; j++) {
      if (isBlank[j]) {
        end = j
        gap = 0
      } else gap++
    }
    blankIntervals.push([i, end])
    i = end + 2
  }

  interface WorkCut {
    time: number
    score: number
    kind: SmartCutKind
    preT?: number
    postT?: number
  }
  const cuts: WorkCut[] = []
  const pad = Math.round(fps * 0.3)
  for (const [a, b] of blankIntervals) {
    if (b - a + 1 < C.blankMinFrames) continue
    const lenSec = (b - a + 1) / fps
    const preT = Math.max(0, a - pad) / fps
    const postT = Math.min(count - 1, b + pad) / fps
    if (lenSec >= C.blankLongSec) {
      // 长黑场（字卡/片尾）：只在入口切；出口由 hard/dissolve 兜底，避免把字卡内部切碎
      if (a > pad) cuts.push({ time: a / fps, score: 1, kind: 'blank', preT, postT: a / fps + 0.2 })
    } else {
      const diff = frameDiff(a - pad, b + pad)
      if (diff >= C.blankPrePostDiff)
        cuts.push({ time: (a + b) / 2 / fps, score: diff / 255, kind: 'blank', preT, postT })
    }
  }
  const inBlank = (i: number): boolean => isBlank[Math.max(0, Math.min(count - 1, i))] === 1

  // ---------- 2. hard：硬切突刺（常规分支 + 强突刺分支） ----------
  const win = Math.round(fps * 1.5)
  for (let i = 2; i < count - 1; i++) {
    if (d1[i] < hardMin || hd1[i] < C.hardHd1) continue
    if (d1[i] < d1[i - 1] || d1[i] < d1[i + 1]) continue
    if (inBlank(i) && inBlank(i - 1)) continue
    const nb: number[] = []
    for (let j = Math.max(1, i - win); j <= Math.min(count - 1, i + win); j++) if (j !== i) nb.push(d1[j])
    nb.sort((x, y) => x - y)
    const med = Math.max(0.4, nb[Math.floor(nb.length / 2)])
    // 强突刺：高运动内容（打斗）中位数被抬高，真切点相对倍率只有 5~7x。
    // 同景多机位切换 hd1 可低至 0.23，此时看突出度：切点是单帧刀锋，甩镜是多帧高原
    const prom = d1[i] / Math.max(0.5, d1[i - 1], d1[i + 1])
    const isStrong =
      d1[i] >= C.strongD1 &&
      d1[i] >= C.strongRatio * med &&
      (hd1[i] >= C.strongHd1 || (prom >= C.strongProm && hd1[i] >= 0.15))
    if (!isStrong) {
      if (d1[i] < hardRatio * med) continue
      // 弱突刺：额外要求切点前后内容确实不同（排除速度渐变/同场景跳变）
      if (d1[i] < 3 * hardMin && frameDiff(i - pad, i + pad) < C.weakCrossDiff) continue
    }
    cuts.push({ time: i / fps, score: d1[i] / 255, kind: 'hard' })
  }

  // ---------- 3. front：擦除锋面（一镜到底转场） ----------
  interface ColEvent {
    c: number
    i: number
    v: number
  }
  const colEvents: ColEvent[] = []
  const sep = Math.round(fps * 0.3)
  for (let c = 0; c < COLS; c++) {
    for (let i = lag + 1; i < count - 1; i++) {
      const v = colD[c][i]
      if (v < C.frontColThresh) continue
      let isMax = true
      for (let j = Math.max(0, i - sep); j <= Math.min(count - 1, i + sep); j++) {
        if (colD[c][j] > v) {
          isMax = false
          break
        }
      }
      if (isMax) colEvents.push({ c, i, v })
    }
  }
  const maxStep = Math.round(fps * C.frontMaxStepSec)
  // 按列分桶（生成顺序即按 i 升序），后继用二分查找：
  // 高动态素材事件很多时避免每步全量 filter+sort 的平方级扫描（本函数在主进程同步执行）
  const eventsByCol: ColEvent[][] = Array.from({ length: COLS }, () => [])
  for (const ev of colEvents) eventsByCol[ev.c].push(ev)
  const nextInCol = (c: number, afterI: number): ColEvent | undefined => {
    if (c < 0 || c >= COLS) return undefined
    const arr = eventsByCol[c]
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid].i <= afterI) lo = mid + 1
      else hi = mid
    }
    const cand = arr[lo]
    return cand && cand.i - afterI <= maxStep ? cand : undefined
  }
  for (const dir of [1, -1]) {
    for (const ev of colEvents) {
      const chain: ColEvent[] = [ev]
      let cur = ev
      for (;;) {
        const cand = nextInCol(cur.c + dir, cur.i)
        if (!cand) break
        chain.push(cand)
        cur = cand
      }
      if (chain.length >= C.frontMinCols) {
        const spanSec = (chain[chain.length - 1].i - chain[0].i) / fps
        if (spanSec >= C.frontSpan[0] && spanSec <= C.frontSpan[1]) {
          // 双重门控（防甩镜/摇镜的假传播链）：
          // ① 链首尾直方图必须大变——真擦除换场景调色盘必变，摇同一个场景不变
          if (histDiffAB(chain[0].i - lag, chain[chain.length - 1].i + pad) < C.frontHistDiff) continue
          const midI = chain[Math.floor(chain.length / 2)].i
          // ② 只在平稳运镜中生效——打斗摇镜局部 d1 基线 8~15，剧烈运动场景交给 hard 分支
          const nb2: number[] = []
          for (let j = Math.max(1, midI - win); j <= Math.min(count - 1, midI + win); j++) nb2.push(d1[j])
          nb2.sort((x, y) => x - y)
          if (nb2[Math.floor(nb2.length / 2)] > C.frontCalmMed) continue
          cuts.push({
            time: midI / fps,
            score: Math.min(1, chain.length / COLS),
            kind: 'front',
            preT: Math.max(0, chain[0].i - lag) / fps,
            postT: Math.min(count - 1, chain[chain.length - 1].i + pad) / fps,
          })
        }
      }
    }
  }

  // ---------- 4. dissolve：叠化脉冲 ----------
  const quietWin = Math.round(fps * C.dissolveQuietSec)
  for (let i = lag + 1; i < count - 1; i++) {
    if (d10[i] < d10[i - 1] || d10[i] < d10[i + 1]) continue
    let big = 0
    for (let c = 0; c < COLS; c++) if (colD[c][i] >= C.dissolveColThresh) big++
    if (big < C.dissolveCols) continue
    if (inBlank(i)) continue
    let quietBefore = false
    let quietAfter = false
    for (let j = Math.max(0, i - quietWin); j < i; j++) if (d10[j] < C.dissolveQuiet) quietBefore = true
    for (let j = i; j <= Math.min(count - 1, i + quietWin); j++) if (d10[j] < C.dissolveQuiet) quietAfter = true
    if (!quietBefore || !quietAfter) continue
    cuts.push({
      time: (i - lag / 2) / fps, // colD 是滞后差，变化中心比峰值早半个 lag
      score: Math.min(1, d10[i] / 100),
      kind: 'dissolve',
      preT: Math.max(0, i - lag - pad) / fps,
      postT: Math.min(count - 1, i + pad) / fps,
    })
  }

  // ---------- 干净前后帧：跳过过曝/全黑/空白帧，并沿亮度坡道走到平稳处 ----------
  const washed = (i: number): boolean => {
    i = Math.max(0, Math.min(count - 1, i))
    return isBlank[i] === 1 || mean[i] > 185 || mean[i] < 15 || brightFrac[i] > 0.7
  }
  const walkLimit = Math.round(fps * 1.0)
  const rampBack = (j: number): boolean => washed(j) || mean[j] > mean[Math.max(0, j - 1)] + 1.5
  const rampFwd = (j: number): boolean => washed(j) || mean[j] > mean[Math.min(count - 1, j + 1)] + 1.5
  for (const cut of cuts) {
    if (cut.preT != null) continue
    const ci = Math.round(cut.time * fps)
    // 先各留 2 帧余量再沿坡道/过曝帧继续外走，避免余量反而退回闪光里
    let pre = Math.max(0, ci - 3)
    for (let k = 0; k < walkLimit && pre > 1 && rampBack(pre); k++) pre--
    let post = Math.min(count - 1, ci + 2)
    for (let k = 0; k < walkLimit && post < count - 1 && rampFwd(post); k++) post++
    cut.preT = pre / fps
    cut.postT = post / fps
  }

  // ---------- 回声抑制：锋面/叠化链的时间跨度可能覆盖到邻近硬切，把硬切的画面剧变误算成自己的信号 ----------
  const hardTimes = cuts.filter((c) => c.kind === 'hard' || c.kind === 'blank').map((c) => c.time)
  const echoFree = cuts.filter(
    (c) => (c.kind !== 'front' && c.kind !== 'dissolve') || !hardTimes.some((t) => Math.abs(t - c.time) < C.echoSec)
  )

  // ---------- 合并去重（渐变类窗口 1.0s，涉及 hard 用 0.28s；minGap 调得更小时窗口跟随收缩，如拆动画连环快切） ----------
  const hardDedupe = Math.min(C.dedupeSec, Math.max(0.08, minGap || C.dedupeSec))
  echoFree.sort((x, y) => x.time - y.time)
  const merged: WorkCut[] = []
  for (const cut of echoFree) {
    const last = merged[merged.length - 1]
    const gap = last && last.kind !== 'hard' && cut.kind !== 'hard' ? C.dedupeSoftSec : hardDedupe
    if (last && cut.time - last.time < gap) {
      if (KIND_PRIORITY[cut.kind] > KIND_PRIORITY[last.kind] || (cut.kind === last.kind && cut.score > last.score))
        merged[merged.length - 1] = cut
    } else merged.push(cut)
  }

  // ---------- 5. sample：长镜头覆盖补帧（crv density floor + sliding-window dedup） ----------
  //
  // 这一步不寻找“切点”，只解决另一个问题：一个长镜头内部可能有连续表演、字幕/动作或慢推镜，
  // 如果只给模型镜头开头一帧，它会看漏中段信息。做法借鉴 claude-real-video：
  //   1) density floor：每 sampleEverySec 秒才考虑一个候选；
  //   2) sliding-window dedup：候选必须和最近 N 个已保留视觉状态足够不同；
  //   3) 低优先级：kind=sample、score 很低，maxShots 紧张时先让位给真实切点。
  const withSamples = addCoverageSamples(merged)

  function addCoverageSamples(baseCuts: WorkCut[]): WorkCut[] {
    if (count < fps * (C.sampleEverySec + C.sampleEdgeSec * 2)) return baseCuts

    const sorted = [...baseCuts].sort((a, b) => a.time - b.time)
    const out: WorkCut[] = []
    const recentFrames: number[] = []
    const remember = (frame: number) => {
      const clamped = Math.max(0, Math.min(count - 1, frame))
      recentFrames.push(clamped)
      if (recentFrames.length > C.sampleDedupWindow) recentFrames.shift()
    }
    const minRecentDiff = (frame: number): number =>
      recentFrames.length
        ? Math.min(...recentFrames.map((prev) => pctChanged(frame, prev, C.samplePixelTol)))
        : 100
    const keepIfDistinct = (t: number) => {
      const frame = Math.max(0, Math.min(count - 1, Math.round(t * fps)))
      const diff = minRecentDiff(frame)
      if (diff <= C.sampleDedupPct) return
      out.push({
        time: frame / fps,
        score: Math.min(C.sampleScoreMax, (diff / 100) * C.sampleScoreMax),
        kind: 'sample',
        preT: frame / fps,
        postT: frame / fps,
      })
      remember(frame)
    }
    const fillGap = (startSec: number, endSec: number) => {
      const margin = Math.max(C.sampleEdgeSec, minGap)
      if (endSec - startSec < C.sampleEverySec + margin * 2) return
      for (let t = startSec + C.sampleEverySec; t < endSec - margin; t += C.sampleEverySec) {
        keepIfDistinct(t)
      }
    }

    remember(0)
    let prevBoundary = 0
    for (const cut of sorted) {
      fillGap(prevBoundary, cut.time)
      out.push(cut)
      remember(Math.round((cut.postT ?? cut.time) * fps))
      prevBoundary = cut.time
    }
    fillGap(prevBoundary, count / fps)

    return out.sort((a, b) => a.time - b.time)
  }

  // d1 曲线（0~1 归一化）供时间轴排查展示
  const series: SceneScorePoint[] = new Array(count)
  for (let i = 0; i < count; i++) {
    series[i] = { t: i / fps, score: Math.min(1, d1[i] / 255) }
  }

  return {
    cuts: withSamples.map((c) => ({
      time: c.time,
      score: c.score,
      kind: c.kind,
      preT: c.preT ?? Math.max(0, c.time - 0.1),
      postT: c.postT ?? c.time + 0.1,
    })),
    duration: count / fps,
    series,
  }
}

/** minGap 二次过滤：间隔过近时按 kind 优先级保留 */
export function filterMinGap(cuts: SmartCut[], minGap: number): SmartCut[] {
  const filtered: SmartCut[] = []
  for (const cut of cuts) {
    const last = filtered[filtered.length - 1]
    if (last && cut.time - last.time < minGap) {
      if (KIND_PRIORITY[cut.kind] > KIND_PRIORITY[last.kind]) filtered[filtered.length - 1] = cut
    } else filtered.push(cut)
  }
  return filtered
}

export interface SmartShot {
  /** 分镜起点（秒） */
  start: number
  /** 分镜终点（秒） */
  end: number
  /** 封面/识别取帧时间（已避开转场的白/黑帧） */
  thumbT: number
  /** 该分镜起始切点的得分（首镜为 0） */
  score: number
  /** 起始切点类型（首镜无） */
  kind?: SmartCutKind
}

/** 把切点串成分镜边界（掐掉贴边切点，thumbT 取起始切点的 postT） */
export function buildShots(cuts: SmartCut[], duration: number): SmartShot[] {
  const valid = cuts.filter((c) => c.time > 0.01 && c.time < duration - 0.01)
  const bounds: Array<{ time: number; postT?: number; score?: number; kind?: SmartCutKind }> = [
    { time: 0, postT: Math.min(0.1, duration) },
    ...valid,
    { time: duration },
  ]
  const shots: SmartShot[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1].time - bounds[i].time < 0.001) continue
    shots.push({
      start: bounds[i].time,
      end: bounds[i + 1].time,
      thumbT: Math.min(bounds[i].postT ?? bounds[i].time + 0.04, bounds[i + 1].time),
      score: bounds[i].score ?? 0,
      kind: bounds[i].kind,
    })
  }
  return shots
}

/** 抽帧：64×36 灰度 @fps，返回连续 rawvideo 缓冲 */
async function extractGrayFrames(videoPath: string, fps: number, signal?: AbortSignal): Promise<Buffer> {
  const FFMPEG_BIN = await getFfmpegBin()
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG_BIN,
      [
        '-hide_banner', '-loglevel', 'error',
        '-i', videoPath,
        '-vf', `fps=${fps},scale=${W}:${H}`,
        '-pix_fmt', 'gray',
        '-f', 'rawvideo', '-',
      ],
      { windowsHide: true }
    )
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    let onAbort: (() => void) | null = null
    const cleanup = () => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
    }
    child.on('error', (e) => {
      cleanup()
      reject(e)
    })
    child.on('close', (code) => {
      cleanup()
      if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'))
      if (code !== 0) return reject(new Error(`ffmpeg 灰度抽帧失败 (${code})\n${stderr.slice(-1000)}`))
      resolve(Buffer.concat(chunks))
    })
    if (signal) {
      onAbort = () => {
        child.kill()
        reject(new DOMException('Cancelled', 'AbortError'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export interface SmartDetectResult {
  cuts: SmartCut[]
  shots: SmartShot[]
  duration: number
  /** 每帧 d1 差异曲线（0~1，未降采样） */
  series: SceneScorePoint[]
}

/** 完整 smart 检测：抽帧 → 四检测器分析 → minGap 过滤 → 分镜边界 */
export async function smartDetect(
  videoPath: string,
  params: Partial<SmartCutParams> = {},
  signal?: AbortSignal
): Promise<SmartDetectResult> {
  const p: SmartCutParams = { ...SMART_CUT_DEFAULTS, ...params }
  const data = await extractGrayFrames(videoPath, SMART_CUT_FPS, signal)
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (data.length < FRAME_SIZE) {
    throw new Error('无法从视频解出任何帧（文件可能损坏或不是视频）')
  }
  const { cuts, duration, series } = analyzeGrayFrames(data, SMART_CUT_FPS, p)
  const filtered = filterMinGap(cuts, Math.max(0.05, p.minGap))
  const shots = buildShots(filtered, duration)
  return { cuts: filtered, shots, duration, series }
}
