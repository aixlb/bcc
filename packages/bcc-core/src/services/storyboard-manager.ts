/**
 * Storyboard Job Manager：管理分镜表生成作业
 *
 * `runStoryboardOnce` 是无状态的可复用入口，被本管理器（给单视频项目用）
 * 和 ResearchManager（给风格研究批量用）共享。
 */

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { ProgressTarget } from '../runtime.js'
import type {
  CutParams,
  SceneScorePoint,
  StoryboardCapturedFrame,
  StoryboardBoundaryOverrides,
  StoryboardCutDecision,
  StoryboardProgressEvent,
  StoryboardProject,
  StoryboardShot,
} from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import { getConfig } from './config.js'
import {
  detectShots,
  detectShotsWithSeries,
  downsampleSeries,
  extractFrame,
  SCENE_SERIES_MAX_POINTS,
  type DetectedShot,
  type DetectParams,
} from './storyboard.js'
import { smartDetect } from './smart-cut.js'
import { getVideoInfo } from './video.js'
import {
  STORYBOARD_DEFAULT_ANALYSIS_PROMPT,
  formatStoryboardDescription,
  isStructuredStoryboardDescription,
  normalizeStoryboardShotType,
  parseStoryboardDescriptionParts,
  STORYBOARD_OUTPUT_CONTRACT,
  STORYBOARD_PENDING_DESC,
} from '@shared/defaults.js'
import { getStoryboardMasterAddendum } from './masters.js'
import { createAnalyzer, type AnalyzerConfig } from './storyboard-analyzer.js'
import {
  getProjectFramesDir,
  getProjectDir,
  writeStoryboardMd,
  writeSceneScores,
  readStoryboard,
  readStoryboardBoundaryOverrides,
  updateStoryboardBoundaryOverrides,
  loadProject,
} from './project-storage.js'

interface ActiveJob {
  id: string
  controller: AbortController
}

interface CutPreviewSession {
  projectId: string
  videoPath: string
  framesDir: string
  capturedByMethod: Map<CutParams['method'], DetectAndCaptureResult>
  signal: AbortSignal
  sender: ProgressTarget
  acceptingEdits: boolean
  mutationChain: Promise<void>
}

/**
 * 逐镜分析 prompt = 基础 prompt（自定义或默认）+ 大师方法论附录。
 * masterId：''/未知 = 不注入；undefined 视同 ''（调用方自行决定回退 config.storyboard_master）。
 */
export function buildAnalyzePrompt(base: string | undefined, masterId: string | undefined): string {
  const task = base?.trim() || STORYBOARD_DEFAULT_ANALYSIS_PROMPT
  return task + getStoryboardMasterAddendum(masterId) + '\n\n' + STORYBOARD_OUTPUT_CONTRACT
}

/** 人工边界与 sidecar 统一使用毫秒精度；同一毫秒视为同一切点。 */
export function storyboardBoundaryMs(timeSec: number): number | null {
  if (!Number.isFinite(timeSec)) return null
  // 输入与 Markdown 都以三位小数表达；round 可避免 1.001 * 1000
  // 在 IEEE-754 下变成 1000.999… 而被错误吞回前一毫秒。
  return Math.round(timeSec * 1000)
}

/** 平均帧率可用时，把秒定位到源视频帧；同一帧无法形成两个有效切点。 */
export function storyboardFrameIndex(timeSec: number, fps: number): number | null {
  if (!Number.isFinite(timeSec) || timeSec < 0 || !Number.isFinite(fps) || fps <= 0) {
    return null
  }
  return Math.floor(timeSec * fps + 1e-7)
}

export interface StoryboardBoundaryPlanPoint {
  timeMs: number
  manual: boolean
}

/** 纯函数：自动切点先应用 suppression，再叠加 forced；forced 同毫秒覆盖自动点。 */
export function mergeStoryboardBoundaryTimes(
  automaticTimesSec: number[],
  overrides: StoryboardBoundaryOverrides,
  durationSec?: number
): StoryboardBoundaryPlanPoint[] {
  const forced = new Set(overrides.forced)
  const suppressed = new Set(overrides.suppressed)
  const durationMs =
    durationSec && Number.isFinite(durationSec) && durationSec > 0
      ? storyboardBoundaryMs(durationSec)
      : null
  const merged = new Map<number, StoryboardBoundaryPlanPoint>()

  for (const timeSec of automaticTimesSec) {
    const timeMs = storyboardBoundaryMs(timeSec)
    if (timeMs === null || timeMs < 0) continue
    if (durationMs !== null && timeMs >= durationMs) continue
    if (timeMs !== 0 && suppressed.has(timeMs) && !forced.has(timeMs)) continue
    merged.set(timeMs, { timeMs, manual: forced.has(timeMs) })
  }
  for (const timeMs of forced) {
    if (!Number.isFinite(timeMs) || timeMs <= 0) continue
    if (durationMs !== null && timeMs >= durationMs) continue
    merged.set(timeMs, { timeMs, manual: true })
  }
  return [...merged.values()].sort((a, b) => a.timeMs - b.timeMs)
}

function storyboardBoundarySec(timeMs: number): number {
  return timeMs / 1000
}

function withForcedBoundary(
  current: StoryboardBoundaryOverrides,
  timeMs: number
): StoryboardBoundaryOverrides {
  return {
    ...current,
    forced: [...new Set([...current.forced, timeMs])].sort((a, b) => a - b),
    // 同一位置人工强制保留优先于旧的 suppression。
    suppressed: current.suppressed.filter((t) => t !== timeMs),
  }
}

function withoutForcedBoundary(
  current: StoryboardBoundaryOverrides,
  timeMs: number
): StoryboardBoundaryOverrides {
  return { ...current, forced: current.forced.filter((t) => t !== timeMs) }
}

function withSuppressedBoundary(
  current: StoryboardBoundaryOverrides,
  timeMs: number
): StoryboardBoundaryOverrides {
  return {
    ...current,
    suppressed: [...new Set([...current.suppressed, timeMs])].sort((a, b) => a - b),
  }
}

export function moveStoryboardBoundaryOverride(
  current: StoryboardBoundaryOverrides,
  oldTimeMs: number,
  newTimeMs: number
): StoryboardBoundaryOverrides {
  const suppressedOld = withSuppressedBoundary(
    withoutForcedBoundary(current, oldTimeMs),
    oldTimeMs
  )
  return withForcedBoundary(suppressedOld, newTimeMs)
}

export function deleteStoryboardBoundaryOverride(
  current: StoryboardBoundaryOverrides,
  timeMs: number
): StoryboardBoundaryOverrides {
  return withSuppressedBoundary(withoutForcedBoundary(current, timeMs), timeMs)
}

/** 校验等待识别的内存切割结果能否插入人工切点；只限制同毫秒/同源帧，不设近邻秒数。 */
export function validateStoryboardPreviewBoundary(
  captured: DetectAndCaptureResult,
  timeSec: number,
  durationSec: number,
  fps: number
): string | undefined {
  const timeMs = storyboardBoundaryMs(timeSec)
  if (timeMs === null) return '切点时间无效'
  if (timeMs <= 0) return '第一镜起点不可重复新增'
  const durationMs = storyboardBoundaryMs(durationSec)
  if (durationMs === null || durationMs <= 0) return '无法确定视频时长'
  if (timeMs >= durationMs) return '切点必须位于视频结束时间之前'
  if (captured.detected.some((shot) => storyboardBoundaryMs(shot.timestamp) === timeMs)) {
    return '该毫秒已有切点'
  }
  const frameIndex = storyboardFrameIndex(storyboardBoundarySec(timeMs), fps)
  if (
    frameIndex !== null &&
    captured.detected.some(
      (shot) => storyboardFrameIndex(shot.timestamp, fps) === frameIndex
    )
  ) {
    return '该视频帧已有切点'
  }
  return undefined
}

/**
 * 把人工切点插入一套内存切割结果，并保持 detected/framePaths 严格按时间对齐。
 * 其他切割方式若在同毫秒或同源帧已有自动点，则以人工点替换它。
 */
export function insertStoryboardPreviewBoundary(
  captured: DetectAndCaptureResult,
  timeSec: number,
  framePath: string,
  fps: number
): { captured: DetectAndCaptureResult; index: number; removedTimeMs: number[] } {
  const timeMs = storyboardBoundaryMs(timeSec)
  if (timeMs === null) throw new Error('切点时间无效')
  const normalizedTimeSec = storyboardBoundarySec(timeMs)
  const frameIndex = storyboardFrameIndex(normalizedTimeSec, fps)
  const removedTimeMs: number[] = []
  const entries: Array<{ shot: DetectedShot; framePath: string }> = []

  captured.detected.forEach((shot, index) => {
    const shotMs = storyboardBoundaryMs(shot.timestamp)
    const sameMillisecond = shotMs === timeMs
    const sameFrame =
      frameIndex !== null && storyboardFrameIndex(shot.timestamp, fps) === frameIndex
    if (sameMillisecond || sameFrame) {
      if (shotMs !== null) removedTimeMs.push(shotMs)
      return
    }
    entries.push({ shot: { ...shot }, framePath: captured.framePaths[index] })
  })
  entries.push({
    shot: {
      timestamp: normalizedTimeSec,
      score: 0,
      thumbT: normalizedTimeSec,
      kind: 'manual',
    },
    framePath,
  })
  entries.sort((a, b) => a.shot.timestamp - b.shot.timestamp)
  const index = entries.findIndex(
    (entry) => storyboardBoundaryMs(entry.shot.timestamp) === timeMs
  )

  return {
    captured: {
      ...captured,
      detected: entries.map((entry) => entry.shot),
      framePaths: entries.map((entry) => entry.framePath),
    },
    index,
    removedTimeMs: [...new Set(removedTimeMs)],
  }
}

type StoryboardShotTextFields = Partial<
  Pick<StoryboardShot, 'shotType' | 'angle' | 'cameraMove' | 'description' | 'dialogue' | 'sound'>
>

/** 合并用户文本编辑：景别归一为六档，七段式 description 的景别同步跟随顶层字段。 */
export function applyStoryboardShotTextEdits(
  old: StoryboardShot,
  fields: StoryboardShotTextFields
): StoryboardShot {
  const shotType = normalizeStoryboardShotType(fields.shotType ?? old.shotType)
  const rawDescription = fields.description ?? old.description
  const descriptionParts = isStructuredStoryboardDescription(rawDescription)
    ? parseStoryboardDescriptionParts(rawDescription)
    : null
  return {
    ...old,
    shotType,
    angle: fields.angle ?? old.angle,
    cameraMove: fields.cameraMove ?? old.cameraMove,
    description: descriptionParts
      ? formatStoryboardDescription(descriptionParts, shotType)
      : rawDescription,
    dialogue: fields.dialogue ?? old.dialogue,
    sound: fields.sound ?? old.sound,
    userEdited: true,
  }
}

class StoryboardManager {
  private active = new Map<string, ActiveJob>()
  /** 按项目串行化重新识别，避免并发加载/写盘相互覆盖 */
  private reanalyzeChains = new Map<string, Promise<unknown>>()
  /** 等待「切割确认」决定的作业：jobId → resolver */
  private cutWaiters = new Map<string, (d: StoryboardCutDecision) => void>()
  /** 切割已完成但尚未开始识别的内存结果；只在 awaiting_confirm 期间接受人工切点。 */
  private cutPreviewSessions = new Map<string, CutPreviewSession>()

  /** 渲染端对 awaiting_confirm 作业作出决定（确认 / 调参重切 / 取消） */
  async decideCut(jobId: string, decision: StoryboardCutDecision): Promise<boolean> {
    const waiter = this.cutWaiters.get(jobId)
    if (!waiter) return false
    const session = this.cutPreviewSessions.get(jobId)
    if (session) {
      // 先关闭入口，再等已经受理的人工编辑完成，避免“新增后立即识别”读到旧快照。
      session.acceptingEdits = false
      await session.mutationChain
    }
    if (this.cutWaiters.get(jobId) !== waiter) return false
    this.cutWaiters.delete(jobId)
    waiter(decision)
    return true
  }

  /** 挂起等待渲染端的切割确认；作业被取消时立刻以 AbortError 结束等待 */
  private waitCutDecision(jobId: string, signal: AbortSignal): Promise<StoryboardCutDecision> {
    return new Promise<StoryboardCutDecision>((resolve, reject) => {
      const onAbort = () => {
        this.cutWaiters.delete(jobId)
        reject(new DOMException('Cancelled', 'AbortError'))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.cutWaiters.set(jobId, (d) => {
        signal.removeEventListener('abort', onAbort)
        resolve(d)
      })
    })
  }

  async start(
    args: { projectId: string; videoPath: string; cutParams?: CutParams; skipConfirm?: boolean; master?: string },
    sender: ProgressTarget
  ): Promise<string> {
    const jobId = randomUUID()
    const controller = new AbortController()
    this.active.set(jobId, { id: jobId, controller })

    this.runJob(
      jobId,
      args.projectId,
      args.videoPath,
      sender,
      controller.signal,
      args.cutParams,
      args.skipConfirm === true,
      args.master
    ).catch((err) => {
      console.error('[Storyboard] failed:', err)
    })

    return jobId
  }

  cancel(jobId: string): boolean {
    const job = this.active.get(jobId)
    if (job) {
      job.controller.abort()
      return true
    }
    return false
  }

  cancelAll(): void {
    for (const job of this.active.values()) {
      job.controller.abort()
    }
    this.active.clear()
  }

  /** 在切割完成、等待识别的 job 内存快照中新增人工切点。 */
  addPreviewCut(
    args: { jobId: string; method: CutParams['method']; timeSec: number },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; index: number; reason?: string }> {
    const session = this.cutPreviewSessions.get(args.jobId)
    if (
      !session ||
      !session.acceptingEdits ||
      session.signal.aborted ||
      session.sender.id !== sender.id
    ) {
      return Promise.resolve({
        ok: false,
        index: -1,
        reason: '当前切割结果已进入识别或作业已结束',
      })
    }
    if (!session.capturedByMethod.has(args.method)) {
      return Promise.resolve({
        ok: false,
        index: -1,
        reason: '当前切割方式还没有可编辑的结果',
      })
    }

    const run = session.mutationChain.then(() =>
      this.runAddPreviewCut(args, session)
    )
    session.mutationChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async runAddPreviewCut(
    args: { jobId: string; method: CutParams['method']; timeSec: number },
    session: CutPreviewSession
  ): Promise<{ ok: boolean; index: number; reason?: string }> {
    const selected = session.capturedByMethod.get(args.method)
    if (!selected || session.signal.aborted) {
      return { ok: false, index: -1, reason: '当前切割结果已不可编辑' }
    }

    const videoInfo = await getVideoInfo(session.videoPath)
    const durationSec =
      videoInfo.durationSec > 0
        ? videoInfo.durationSec
        : selected.durationSec && selected.durationSec > 0
          ? selected.durationSec
          : 0
    const reason = validateStoryboardPreviewBoundary(
      selected,
      args.timeSec,
      durationSec,
      videoInfo.fps
    )
    if (reason) return { ok: false, index: -1, reason }

    const timeMs = storyboardBoundaryMs(args.timeSec)!
    const timeSec = storyboardBoundarySec(timeMs)
    const framePath = await extractFrame(session.videoPath, timeSec, session.framesDir)
    if (session.signal.aborted) {
      return { ok: false, index: -1, reason: '作业已取消' }
    }

    const nextByMethod = new Map<
      CutParams['method'],
      ReturnType<typeof insertStoryboardPreviewBoundary>
    >()
    const removedTimeMs = new Set<number>()
    for (const [method, captured] of session.capturedByMethod) {
      const next = insertStoryboardPreviewBoundary(
        captured,
        timeSec,
        framePath,
        videoInfo.fps
      )
      nextByMethod.set(method, next)
      next.removedTimeMs.forEach((value) => {
        if (value > 0 && value !== timeMs) removedTimeMs.add(value)
      })
    }

    await updateStoryboardBoundaryOverrides(session.projectId, (current) => {
      let next = current
      for (const removed of removedTimeMs) {
        next = deleteStoryboardBoundaryOverride(next, removed)
      }
      return withForcedBoundary(next, timeMs)
    })
    if (session.signal.aborted) {
      return { ok: false, index: -1, reason: '作业已取消' }
    }

    for (const [method, next] of nextByMethod) {
      session.capturedByMethod.set(method, next.captured)
      if (!session.sender.isDestroyed()) {
        session.sender.send(IPC.EVENT_STORYBOARD_PROGRESS, {
          jobId: args.jobId,
          status: 'awaiting_confirm',
          progress: 0.45,
          message: `已手动新增切点 ${timeSec.toFixed(3)}s`,
          cutResult: {
            method,
            frames: captureFrames(next.captured),
            sceneSeries: captureSceneSeries(next.captured),
          },
        } satisfies StoryboardProgressEvent)
      }
    }

    const selectedResult = nextByMethod.get(args.method)
    return { ok: true, index: selectedResult?.index ?? -1 }
  }

  /**
   * 复用已有截图，对指定镜头重新调用 AI 识别。
   * - 逐镜增量推送 EVENT_STORYBOARD_SHOT_UPDATED，让 UI 实时更新单张卡片
   * - 全部完成后落盘并推送 EVENT_PROJECT_UPDATED
   * - 失败时保留旧分镜数据（不破坏已成功的内容），仅在事件里带上 error
   */
  reanalyze(
    args: { projectId: string; indices: number[] },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; updated: number; failed: number }> {
    const { projectId } = args
    const prev = this.reanalyzeChains.get(projectId) ?? Promise.resolve()
    const run = prev.then(
      () => this.runReanalyze(args, sender),
      () => this.runReanalyze(args, sender)
    )
    // 链尾吞掉结果/异常，保证后续排队任务总能继续
    this.reanalyzeChains.set(projectId, run.then(() => undefined, () => undefined))
    return run
  }

  private async runReanalyze(
    args: { projectId: string; indices: number[] },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; updated: number; failed: number }> {
    const { projectId } = args
    // 注册可取消作业：重新识别也建任务卡 + 可即时丢弃在途大模型 session
    const jobId = randomUUID()
    const controller = new AbortController()
    const signal = controller.signal
    this.active.set(jobId, { id: jobId, controller })

    const log = (msg: string) => console.log(`[Storyboard][reanalyze][${jobId.slice(0, 8)}] ${msg}`)

    const cfg = getConfig()
    const prompt = buildAnalyzePrompt(cfg.storyboard.prompt, cfg.storyboard_master)
    const analyzerCfg = resolveAnalyzerConfig(cfg)
    const analyzer = createAnalyzer(analyzerCfg)
    const concurrency = Math.max(1, Math.min(10, cfg.storyboard.concurrency ?? 3))
    const providerLabel = providerLabelFor(cfg)

    // 计数器/helper 提到 try 外，让 catch 也能据此把卡片收尾到终态
    let total = 0
    let updated = 0
    let failed = 0
    let done = 0
    let cardCreated = false

    const sendProgress = (
      status: StoryboardProgressEvent['status'],
      progress: number,
      message: string,
      currentShot?: number
    ) => {
      if (sender.isDestroyed()) return
      const ev: StoryboardProgressEvent = {
        jobId,
        status,
        progress,
        message,
        currentShot,
        totalShots: total,
        kind: 'reanalyze',
        projectId,
        providerLabel,
      }
      sender.send(IPC.EVENT_STORYBOARD_PROGRESS, ev)
    }

    const sendShot = (index: number, shot: StoryboardShot, error?: string) => {
      if (sender.isDestroyed()) return
      sender.send(IPC.EVENT_STORYBOARD_SHOT_UPDATED, { projectId, index, shot, error })
    }

    try {
      const sbProject = await readStoryboard(projectId)
      if (!sbProject) throw new Error('分镜表不存在或尚未生成')

      // 去重、过滤越界与无截图的镜头，并按序处理
      const indices = [...new Set(args.indices)]
        .filter(
          (i) =>
            Number.isInteger(i) &&
            i >= 0 &&
            i < sbProject.shots.length &&
            !!sbProject.framePaths[i]
        )
        .sort((a, b) => a - b)

      log(`provider=${analyzerCfg.provider} model=${analyzerCfg.model} 待识别 ${indices.length} 个镜头`)

      // 没有可识别的镜头：不建卡，直接返回
      if (indices.length === 0) return { ok: true, updated: 0, failed: 0 }

      total = indices.length

      // 首个事件 → 渲染进程据此建任务卡
      sendProgress('analyzing', 0, `重新识别 ${total} 个镜头...`, 0)
      cardCreated = true

      for (let start = 0; start < indices.length; start += concurrency) {
        if (signal.aborted) break
        const batch = indices.slice(start, start + concurrency)
        await Promise.all(
          batch.map(async (idx) => {
            if (signal.aborted) return
            const old = sbProject.shots[idx]
            try {
              const shot = await analyzer.analyze(sbProject.framePaths[idx], prompt, signal)
              // 保留与镜头位置相关的元数据，只替换 AI 识别的内容
              shot.number = old.number
              shot.startSec = old.startSec
              shot.endSec = old.endSec
              shot.timeRange = old.timeRange
              shot.sceneScore = old.sceneScore
              shot.userEdited = false
              sbProject.shots[idx] = shot
              updated++
              log(`✓ 镜${old.number}: ${shot.shotType} · ${shot.angle}`)
              sendShot(idx, shot)
            } catch (err: any) {
              if (signal.aborted) return // 取消时静默，不污染日志/进度
              const msg = err?.message ?? String(err)
              failed++
              log(`✗ 镜${old.number} 重新识别失败: ${msg}`)
              // 保留旧分镜，避免把已成功的内容覆盖成「分析失败」
              sendShot(idx, old, msg)
            }
            done++
            sendProgress('analyzing', 0.05 + 0.9 * (done / total), `已识别 ${done}/${total}`, done)
          })
        )
      }

      // 已成功的部分始终落盘（即便中途取消，也不丢已完成的识别结果）
      if (updated > 0) {
        await writeStoryboardMd(projectId, sbProject)
        log(`已写盘，成功 ${updated} / 失败 ${failed}`)
      }
      if (!sender.isDestroyed()) {
        sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
      }

      if (signal.aborted) {
        sendProgress('cancelled', 0.05 + 0.9 * (done / Math.max(1, total)), `已取消（成功 ${updated}）`, done)
        return { ok: false, updated, failed }
      }

      sendProgress('completed', 1, `完成：成功 ${updated}${failed ? ` / 失败 ${failed}` : ''}`, done)
      if (!sender.isDestroyed()) {
        sender.send(IPC.EVENT_STORYBOARD_COMPLETED, {
          jobId,
          videoPath: sbProject.videoPath,
          xlsxPath: '',
          shots: sbProject.shots,
        })
      }
      return { ok: true, updated, failed }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      log(`错误: ${msg}`)
      // 卡片还没建（如分镜表不存在）→ 交给调用方处理，不无端建一张失败卡
      if (!cardCreated) throw err
      // 卡片已存在：把它收尾到终态，否则会卡在 analyzing 且取消/清除都不可用
      if (signal.aborted) {
        sendProgress('cancelled', 0.05 + 0.9 * (done / Math.max(1, total)), `已取消（成功 ${updated}）`, done)
      } else {
        sendProgress('failed', 1, msg, done)
        if (!sender.isDestroyed()) {
          sender.send(IPC.EVENT_STORYBOARD_FAILED, { jobId, message: msg })
        }
      }
      return { ok: false, updated, failed }
    } finally {
      this.active.delete(jobId)
    }
  }

  /**
   * 在指定时间手动新增一个分镜：截帧 → best-effort AI 识别 → 按时间插入 → 重排编号/区间 → 落盘。
   * 与 reanalyze 共用每项目串行链，避免并发写盘互相覆盖。
   */
  addShot(
    args: { projectId: string; timeSec: number },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; index: number; reason?: string }> {
    const { projectId } = args
    const prev = this.reanalyzeChains.get(projectId) ?? Promise.resolve()
    const run = prev.then(
      () => this.runAddShot(args, sender),
      () => this.runAddShot(args, sender)
    )
    this.reanalyzeChains.set(projectId, run.then(() => undefined, () => undefined))
    return run
  }

  private async runAddShot(
    args: { projectId: string; timeSec: number },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; index: number; reason?: string }> {
    const { projectId } = args
    const timeMs = storyboardBoundaryMs(args.timeSec)
    const log = (msg: string) => console.log(`[Storyboard][addShot][${projectId.slice(0, 8)}] ${msg}`)

    const sbProject = await readStoryboard(projectId)
    if (!sbProject) throw new Error('分镜表不存在或尚未生成')

    if (timeMs === null) {
      return { ok: false, index: -1, reason: '切点时间无效' }
    }
    if (timeMs <= 0) {
      return { ok: false, index: -1, reason: '第一镜起点不可重复新增' }
    }
    if (sbProject.shots.some((s) => storyboardBoundaryMs(s.startSec) === timeMs)) {
      log(`${storyboardBoundarySec(timeMs).toFixed(3)}s 已有同毫秒切点，跳过`)
      return { ok: false, index: -1, reason: '该毫秒已有切点' }
    }

    // storyboard.md 里只存了视频文件名（basename），不能直接喂给 ffmpeg。
    // 截新帧要用 project.json 里持久化的完整路径；缺失时才退回 markdown 里的值。
    const project = await loadProject(projectId)
    const videoPath = project?.videoPath || sbProject.videoPath
    if (!videoPath) throw new Error('找不到源视频路径')
    const videoInfo = await getVideoInfo(videoPath)
    const probedDuration = videoInfo.durationSec
    const durationSec =
      probedDuration > 0
        ? probedDuration
        : Math.max(0, ...sbProject.shots.map((shot) => shot.endSec))
    if (!(durationSec > 0)) {
      return { ok: false, index: -1, reason: '无法确定视频时长' }
    }
    const durationMs = storyboardBoundaryMs(durationSec)
    if (durationMs !== null && timeMs >= durationMs) {
      return { ok: false, index: -1, reason: '切点必须位于视频结束时间之前' }
    }
    const timeSec = storyboardBoundarySec(timeMs)
    const frameIndex = storyboardFrameIndex(timeSec, videoInfo.fps)
    if (
      frameIndex !== null &&
      sbProject.shots.some((shot) => storyboardFrameIndex(shot.startSec, videoInfo.fps) === frameIndex)
    ) {
      return { ok: false, index: -1, reason: '该视频帧已有切点' }
    }

    const framesDir = getProjectFramesDir(projectId)
    await fs.mkdir(framesDir, { recursive: true })
    const framePath = await extractFrame(videoPath, timeSec, framesDir)

    // 先只落「截图 + 时间」的占位镜，AI 识别交给后台异步补（见 recognizeShotByFrame）。
    // 这样用户右键后立刻看到新镜，不必干等大模型；渲染层据 description 标记显示「识别中」。
    const shot: StoryboardShot = {
      number: 0,
      shotType: '识别中',
      angle: '—',
      cameraMove: '—',
      description: STORYBOARD_PENDING_DESC,
      dialogue: '',
      sound: '',
      timeRange: '',
      startSec: timeSec,
      // 插到末尾时 renumberShots 会保留它作为视频末端；插到中间则会被下一镜起点覆盖。
      endSec: durationSec,
      sceneScore: 0, // 手动新增，无差异分
      userEdited: false,
    }

    // 按时间插入，并同步插入截图路径
    let insertAt = sbProject.shots.findIndex((s) => s.startSec > timeSec)
    if (insertAt === -1) insertAt = sbProject.shots.length
    sbProject.shots.splice(insertAt, 0, shot)
    sbProject.framePaths.splice(insertAt, 0, framePath)

    // 重排编号 + 重算时间区间（前一镜的结束变为新镜起点）
    renumberShots(sbProject.shots)

    await writeStoryboardMd(projectId, sbProject)
    await updateStoryboardBoundaryOverrides(projectId, (current) => withForcedBoundary(current, timeMs))
    if (!sender.isDestroyed()) {
      sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
    }
    log(`已新增占位分镜 #${insertAt + 1} @ ${formatHMS(timeSec)}，后台识别中`)

    // 后台异步识别：排进同一串行链，按截图路径定位镜头（避免后续插入导致索引漂移）
    void this.recognizeShotByFrame(projectId, framePath, sender)

    return { ok: true, index: insertAt }
  }

  /**
   * 移动指定分镜的起始切点。切点属于右镜：左镜只改结束时间，右镜重截关键帧；
   * 用户编辑过的右镜保留内容，否则进入占位态并在后台重新识别。
   */
  moveShot(
    args: { projectId: string; index: number; timeSec: number },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; index: number; reason?: string }> {
    const { projectId } = args
    const prev = this.reanalyzeChains.get(projectId) ?? Promise.resolve()
    const run = prev.then(
      () => this.runMoveShot(args, sender),
      () => this.runMoveShot(args, sender)
    )
    this.reanalyzeChains.set(projectId, run.then(() => undefined, () => undefined))
    return run
  }

  private async runMoveShot(
    args: { projectId: string; index: number; timeSec: number },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; index: number; reason?: string }> {
    const { projectId, index } = args
    const timeMs = storyboardBoundaryMs(args.timeSec)
    const sbProject = await readStoryboard(projectId)
    if (!sbProject) throw new Error('分镜表不存在或尚未生成')
    if (!Number.isInteger(index) || index < 0 || index >= sbProject.shots.length) {
      return { ok: false, index: -1, reason: '镜头序号无效（分镜可能已被修改，请重试）' }
    }
    if (index === 0) {
      return { ok: false, index, reason: '第一镜起点不可移动' }
    }
    if (timeMs === null) {
      return { ok: false, index, reason: '切点时间无效' }
    }

    const old = sbProject.shots[index]
    const oldMs = storyboardBoundaryMs(old.startSec)
    if (oldMs === null) {
      return { ok: false, index, reason: '原切点时间无效' }
    }
    if (timeMs === oldMs) {
      return { ok: false, index, reason: '切点位置没有变化' }
    }

    const project = await loadProject(projectId)
    const videoPath = project?.videoPath || sbProject.videoPath
    if (!videoPath) throw new Error('找不到源视频路径')
    const videoInfo = await getVideoInfo(videoPath)
    const probedDuration = videoInfo.durationSec
    const durationSec =
      probedDuration > 0
        ? probedDuration
        : Math.max(0, ...sbProject.shots.map((shot) => shot.endSec))
    const prevMs = storyboardBoundaryMs(sbProject.shots[index - 1].startSec) ?? 0
    const nextMs =
      index + 1 < sbProject.shots.length
        ? storyboardBoundaryMs(sbProject.shots[index + 1].startSec)
        : durationSec > 0
          ? storyboardBoundaryMs(durationSec)
          : storyboardBoundaryMs(old.endSec)
    if (timeMs <= prevMs) {
      return { ok: false, index, reason: '切点必须位于上一切点之后' }
    }
    if (nextMs !== null && timeMs >= nextMs) {
      return { ok: false, index, reason: '切点必须位于下一切点（或视频结束）之前' }
    }

    const timeSec = storyboardBoundarySec(timeMs)
    const frameIndex = storyboardFrameIndex(timeSec, videoInfo.fps)
    const oldFrameIndex = storyboardFrameIndex(old.startSec, videoInfo.fps)
    if (frameIndex !== null && frameIndex === oldFrameIndex) {
      return { ok: false, index, reason: '新时间仍位于原关键帧，请移动到其他帧' }
    }
    if (
      frameIndex !== null &&
      sbProject.shots.some(
        (shot, shotIndex) =>
          shotIndex !== index &&
          storyboardFrameIndex(shot.startSec, videoInfo.fps) === frameIndex
      )
    ) {
      return { ok: false, index, reason: '该视频帧已有切点' }
    }
    const framesDir = getProjectFramesDir(projectId)
    await fs.mkdir(framesDir, { recursive: true })
    const framePath = await extractFrame(videoPath, timeSec, framesDir)
    const oldFrame = sbProject.framePaths[index]
    const preserveUserContent = old.userEdited === true

    sbProject.shots[index] = preserveUserContent
      ? {
          ...old,
          startSec: timeSec,
          sceneScore: 0,
          userEdited: true,
        }
      : {
          ...old,
          shotType: '识别中',
          angle: '—',
          cameraMove: '—',
          description: STORYBOARD_PENDING_DESC,
          dialogue: '',
          sound: '',
          startSec: timeSec,
          sceneScore: 0,
          userEdited: false,
        }
    sbProject.framePaths[index] = framePath
    renumberShots(sbProject.shots)
    await writeStoryboardMd(projectId, sbProject)
    await updateStoryboardBoundaryOverrides(projectId, (current) =>
      moveStoryboardBoundaryOverride(current, oldMs, timeMs)
    )

    if (oldFrame && oldFrame !== framePath && !sbProject.framePaths.includes(oldFrame)) {
      const resolvedFramesDir = path.resolve(framesDir)
      if (path.resolve(oldFrame).startsWith(resolvedFramesDir)) {
        await fs.unlink(oldFrame).catch(() => {})
      }
    }
    if (!sender.isDestroyed()) {
      sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
    }
    console.log(
      `[Storyboard][moveShot][${projectId.slice(0, 8)}] 镜${index + 1} ${storyboardBoundarySec(oldMs).toFixed(3)}s → ${timeSec.toFixed(3)}s`
    )

    if (!preserveUserContent) {
      void this.recognizeShotByFrame(projectId, framePath, sender)
    }
    return { ok: true, index }
  }

  /**
   * 编辑单个分镜的文本字段（景别/角度/运镜/提示词描述/台词/音效）。
   * 与 reanalyze/addShot 共用每项目串行链，避免并发写盘互相覆盖。
   */
  updateShot(
    args: {
      projectId: string
      index: number
      fields: Partial<Pick<StoryboardShot, 'shotType' | 'angle' | 'cameraMove' | 'description' | 'dialogue' | 'sound'>>
    },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; reason?: string }> {
    const { projectId } = args
    const prev = this.reanalyzeChains.get(projectId) ?? Promise.resolve()
    const run = prev.then(
      () => this.runUpdateShot(args, sender),
      () => this.runUpdateShot(args, sender)
    )
    this.reanalyzeChains.set(projectId, run.then(() => undefined, () => undefined))
    return run
  }

  private async runUpdateShot(
    args: {
      projectId: string
      index: number
      fields: Partial<Pick<StoryboardShot, 'shotType' | 'angle' | 'cameraMove' | 'description' | 'dialogue' | 'sound'>>
    },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; reason?: string }> {
    const { projectId, index, fields } = args
    const sbProject = await readStoryboard(projectId)
    if (!sbProject) throw new Error('分镜表不存在或尚未生成')
    if (!Number.isInteger(index) || index < 0 || index >= sbProject.shots.length) {
      return { ok: false, reason: '镜头序号无效（分镜可能已被修改，请重试）' }
    }
    const old = sbProject.shots[index]
    // 只接受文本内容字段；镜号/时间等位置元数据不可改
    const next = applyStoryboardShotTextEdits(old, fields)
    sbProject.shots[index] = next
    await writeStoryboardMd(projectId, sbProject)
    if (!sender.isDestroyed()) {
      sender.send(IPC.EVENT_STORYBOARD_SHOT_UPDATED, { projectId, index, shot: next })
      sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
    }
    console.log(`[Storyboard][updateShot][${projectId.slice(0, 8)}] 镜${old.number} 已编辑`)
    return { ok: true }
  }

  /**
   * 删除单个分镜：移除镜头与截图引用，重排编号/时间区间后落盘。
   * 与 reanalyze/addShot 共用每项目串行链。
   */
  deleteShot(
    args: { projectId: string; index: number },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; reason?: string }> {
    const { projectId } = args
    const prev = this.reanalyzeChains.get(projectId) ?? Promise.resolve()
    const run = prev.then(
      () => this.runDeleteShot(args, sender),
      () => this.runDeleteShot(args, sender)
    )
    this.reanalyzeChains.set(projectId, run.then(() => undefined, () => undefined))
    return run
  }

  private async runDeleteShot(
    args: { projectId: string; index: number },
    sender: ProgressTarget
  ): Promise<{ ok: boolean; reason?: string }> {
    const { projectId, index } = args
    const sbProject = await readStoryboard(projectId)
    if (!sbProject) throw new Error('分镜表不存在或尚未生成')
    if (!Number.isInteger(index) || index < 0 || index >= sbProject.shots.length) {
      return { ok: false, reason: '镜头序号无效（分镜可能已被修改，请重试）' }
    }
    if (index === 0) {
      return { ok: false, reason: '第一镜起点不可删除' }
    }
    if (sbProject.shots.length <= 1) {
      return { ok: false, reason: '至少要保留一个分镜' }
    }
    const [removed] = sbProject.shots.splice(index, 1)
    const [removedFrame] = sbProject.framePaths.splice(index, 1)
    const removedMs = storyboardBoundaryMs(removed.startSec)
    // 删除的是右镜：左镜吞并其区间。尤其删除末镜时，必须先把视频末端传给左镜，
    // 否则 renumberShots 会沿用左镜原来的 end（正好等于被删切点），形成截断。
    extendLeftShotThroughDeletedBoundary(sbProject.shots, index, removed.endSec)
    renumberShots(sbProject.shots)
    await writeStoryboardMd(projectId, sbProject)
    if (removedMs !== null) {
      await updateStoryboardBoundaryOverrides(projectId, (current) =>
        deleteStoryboardBoundaryOverride(current, removedMs)
      )
    }
    // 截图文件 best-effort 清理（仅删项目 frames 目录内、且不再被引用的文件）
    if (removedFrame && !sbProject.framePaths.includes(removedFrame)) {
      const framesDir = path.resolve(getProjectFramesDir(projectId))
      if (path.resolve(removedFrame).startsWith(framesDir)) {
        await fs.unlink(removedFrame).catch(() => {})
      }
    }
    if (!sender.isDestroyed()) {
      sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
    }
    console.log(`[Storyboard][deleteShot][${projectId.slice(0, 8)}] 已删除镜${removed.number}（原序号 ${index + 1}）`)
    return { ok: true }
  }

  /**
   * 手动新增分镜的后台识别：复用占位镜的截图，调 AI 补全内容后落盘。
   * 与 reanalyze/addShot 共用每项目串行链，避免并发写盘互相覆盖。
   */
  private recognizeShotByFrame(
    projectId: string,
    framePath: string,
    sender: ProgressTarget
  ): Promise<void> {
    const prev = this.reanalyzeChains.get(projectId) ?? Promise.resolve()
    const run = prev.then(
      () => this.runRecognizeShotByFrame(projectId, framePath, sender),
      () => this.runRecognizeShotByFrame(projectId, framePath, sender)
    )
    this.reanalyzeChains.set(projectId, run.then(() => undefined, () => undefined))
    return run
  }

  private async runRecognizeShotByFrame(
    projectId: string,
    framePath: string,
    sender: ProgressTarget
  ): Promise<void> {
    // 注册为可取消作业：取消窗口/cancelAll 时能即时丢弃在途大模型请求，并阻止取消后再落盘
    const jobId = randomUUID()
    const controller = new AbortController()
    const signal = controller.signal
    this.active.set(jobId, { id: jobId, controller })

    const log = (msg: string) =>
      console.log(`[Storyboard][addShot:recognize][${projectId.slice(0, 8)}] ${msg}`)

    try {
      const sbProject = await readStoryboard(projectId)
      if (!sbProject) return
      // 按截图路径定位：即便此前又插入/删除了其它镜导致索引漂移，也能找对这一镜
      const idx = sbProject.framePaths.indexOf(framePath)
      if (idx < 0) {
        log('占位镜已不存在（可能被删除或重排），跳过识别')
        return
      }
      const old = sbProject.shots[idx]

      const cfg = getConfig()
      const prompt = buildAnalyzePrompt(cfg.storyboard.prompt, cfg.storyboard_master)

      // 仅 AI 识别出的内容（不含镜号/时间区间等位置元数据）
      let aiContent: Pick<
        StoryboardShot,
        'shotType' | 'angle' | 'cameraMove' | 'description' | 'dialogue' | 'sound'
      >
      try {
        const analyzer = createAnalyzer(resolveAnalyzerConfig(cfg))
        const shot = await analyzer.analyze(framePath, prompt, signal)
        aiContent = {
          shotType: shot.shotType,
          angle: shot.angle,
          cameraMove: shot.cameraMove,
          description: shot.description,
          dialogue: shot.dialogue,
          sound: shot.sound,
        }
        log(`✓ 镜${old.number} 识别完成: ${shot.shotType} · ${shot.angle}`)
      } catch (err: any) {
        if (signal.aborted) return // 取消时静默，不把占位镜落成失败态
        const msg = err?.message ?? String(err)
        log(`✗ 镜${old.number} 识别失败: ${msg}`)
        // 失败则把占位镜落成「分析失败」态，用户可点「重新识别」重试
        aiContent = {
          shotType: '未知',
          angle: '未知',
          cameraMove: '未知',
          description: `分析失败: ${msg}（可点「重新识别」重试）`,
          dialogue: old.dialogue,
          sound: old.sound,
        }
      }

      if (signal.aborted) return

      // 重新读取最新分镜再写：识别期间可能发生整表重生成等写入，复用旧快照会丢更新（lost update）。
      // 按截图路径在最新快照里重新定位，并采用其位置元数据。
      const fresh = await readStoryboard(projectId)
      if (!fresh) return
      const freshIdx = fresh.framePaths.indexOf(framePath)
      if (freshIdx < 0) {
        log('占位镜在识别期间被移除/重排，放弃写回')
        return
      }
      const cur = fresh.shots[freshIdx]
      const next: StoryboardShot = {
        ...aiContent,
        number: cur.number,
        startSec: cur.startSec,
        endSec: cur.endSec,
        timeRange: cur.timeRange,
        sceneScore: cur.sceneScore,
        userEdited: false,
      }
      fresh.shots[freshIdx] = next
      await writeStoryboardMd(projectId, fresh)
      if (!sender.isDestroyed()) {
        sender.send(IPC.EVENT_STORYBOARD_SHOT_UPDATED, { projectId, index: freshIdx, shot: next })
        sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
      }
    } finally {
      this.active.delete(jobId)
    }
  }

  private async runJob(
    jobId: string,
    projectId: string,
    videoPath: string,
    sender: ProgressTarget,
    signal: AbortSignal,
    cutParamsOverride?: CutParams,
    skipConfirm = false,
    masterOverride?: string
  ): Promise<void> {
    const startedAt = Date.now()

    const log = (msg: string) => {
      console.log(`[Storyboard][${jobId.slice(0, 8)}] ${msg}`)
    }

    const send = (status: StoryboardProgressEvent['status'], payload: Partial<StoryboardProgressEvent> = {}) => {
      if (sender.isDestroyed()) return
      const ev: StoryboardProgressEvent = {
        jobId,
        status,
        progress: payload.progress ?? 0,
        message: payload.message ?? '',
        currentShot: payload.currentShot,
        totalShots: payload.totalShots,
        threshold: payload.threshold,
        cutParams: payload.cutParams,
        resetFrames: payload.resetFrames,
        capturedFrame: payload.capturedFrame,
        sceneSeries: payload.sceneSeries,
        cutResult: payload.cutResult,
      }
      sender.send(IPC.EVENT_STORYBOARD_PROGRESS, ev)
    }

    try {
      // 整表重切前保留用户编辑内容快照；相同起始毫秒的镜头最终仍以用户内容为准。
      // 显式「重新识别」会把 userEdited 清为 false，因此不会被这里继续保留。
      const existingStoryboard = await readStoryboard(projectId)
      const preservedUserContent = new Map<number, StoryboardShot>()
      for (const shot of existingStoryboard?.shots ?? []) {
        const timeMs = storyboardBoundaryMs(shot.startSec)
        if (shot.userEdited === true && timeMs !== null) {
          preservedUserContent.set(timeMs, shot)
        }
      }

      const cfg = getConfig()
      const sbCfg = cfg.storyboard
      // 生成入口可临时改剧本大师（masterOverride 含 '' 表示明确选「默认」）；没传才回退全局配置
      const prompt = buildAnalyzePrompt(sbCfg.prompt, masterOverride ?? cfg.storyboard_master)
      const maxShots = sbCfg.max_shots ?? 200
      const concurrency = Math.max(1, Math.min(10, sbCfg.concurrency ?? 3))
      // 分析器配置提前解析：API Key 没配等问题在切割前就报错，不浪费一轮切割
      resolveAnalyzerConfig(cfg)

      // 优先用渲染端「切割前设置页」选好的参数；没传（如老调用方）才回退配置
      let cutParams: CutParams = sanitizeCutParams(
        cutParamsOverride ?? {
          method: sbCfg.cut_method ?? 'smart',
          scene_threshold: sbCfg.scene_threshold ?? 0.3,
          smart_hard_min: sbCfg.smart_hard_min ?? 5.5,
          smart_hard_ratio: sbCfg.smart_hard_ratio ?? 8,
          smart_min_gap: sbCfg.smart_min_gap ?? 0.3,
        }
      )

      const framesDir = getProjectFramesDir(projectId)
      await fs.mkdir(framesDir, { recursive: true })

      // ---------- 阶段 A：切割 + 截图（工作台：各方式切割结果按方式缓存，可反复切/换方式看） ----------
      const capturedByMethod = new Map<CutParams['method'], DetectAndCaptureResult>()
      const previewSession: CutPreviewSession = {
        projectId,
        videoPath,
        framesDir,
        capturedByMethod,
        signal,
        sender,
        acceptingEdits: false,
        mutationChain: Promise.resolve(),
      }
      this.cutPreviewSessions.set(jobId, previewSession)
      // direct=true：本轮切完直接进识别（「切割并识别」或直通启动）
      let direct = skipConfirm
      let captured: DetectAndCaptureResult
      let round = 0
      for (;;) {
        previewSession.acceptingEdits = false
        round++
        if (round > 1) {
          // 新一轮切割：让渲染端清空该方式上一轮积累的截图
          send('detecting', { progress: 0.05, message: '重新切割...', cutParams, resetFrames: true })
        }
        captured = await detectAndCaptureShots({
          videoPath,
          framesDir,
          cutParams,
          maxShots,
          signal,
          // 单视频项目额外算一条「每帧差异曲线」，供时间轴下方排查镜头切分
          computeSceneSeries: true,
          onProgress: (ev) => {
            if (ev.phase === 'detecting') {
              send('detecting', {
                progress: 0.05 + 0.10 * (ev.current ?? 0) / Math.max(1, ev.total ?? 1),
                message: ev.message,
                threshold: ev.seriesThreshold,
                cutParams,
                // 检测完成时顺带把整条差异曲线下发，截图核对阶段即可展示（与编辑器同款）
                sceneSeries: ev.series
                  ? {
                      threshold: ev.seriesThreshold ?? 0,
                      durationSec: ev.durationSec ?? (ev.series[ev.series.length - 1]?.t ?? 0),
                      points: ev.series,
                    }
                  : undefined,
              })
            } else if (ev.phase === 'capturing') {
              send('capturing', {
                progress: 0.15 + 0.30 * (ev.current ?? 0) / Math.max(1, ev.total ?? 1),
                message: ev.message,
                currentShot: ev.current,
                totalShots: ev.total,
                cutParams,
                capturedFrame: ev.frame,
              })
            }
          },
          log,
        })

        const merged = await applyStoryboardBoundaryOverrides(
          projectId,
          videoPath,
          framesDir,
          captured,
          signal
        )
        captured = merged.captured
        if (merged.changed) {
          // 自动截图事件已经发过；人工覆盖改变了集合，重放最终快照，避免确认页仍显示旧自动点。
          send('detecting', {
            progress: 0.43,
            message: '应用人工切点...',
            cutParams,
            resetFrames: true,
          })
          if (captured.sceneSeries) {
            send('detecting', {
              progress: 0.44,
              message: '已应用人工切点',
              cutParams,
              sceneSeries: {
                threshold: captured.seriesThreshold,
                durationSec:
                  captured.durationSec ??
                  captured.sceneSeries[captured.sceneSeries.length - 1]?.t ??
                  0,
                points: captured.sceneSeries,
              },
            })
          }
          captured.detected.forEach((shot, index) => {
            send('capturing', {
              progress: 0.44,
              message: `人工切点合并 ${index + 1}/${captured.detected.length}`,
              currentShot: index + 1,
              totalShots: captured.detected.length,
              cutParams,
              capturedFrame: {
                index,
                path: captured.framePaths[index],
                timestamp: shot.timestamp,
                score: shot.score,
                kind: shot.kind,
              },
            })
          })
          log('已应用人工切点覆盖')
        }

        capturedByMethod.set(cutParams.method, captured)
        if (direct) break

        previewSession.acceptingEdits = true
        send('awaiting_confirm', {
          progress: 0.45,
          message: `已切出 ${captured.detected.length} 个分镜，等待开始识别或重新切割`,
          totalShots: captured.detected.length,
          cutParams,
        })
        log(`切割完成，等待决定（${captured.detected.length} 镜，方式=${cutParams.method}）`)
        const decision = await this.waitCutDecision(jobId, signal)
        if (decision.action === 'confirm') {
          // 识别用户当前查看的方式的已切结果（可能不是最后一次切的那套）
          const chosenMethod = decision.params?.method ?? cutParams.method
          const chosen = capturedByMethod.get(chosenMethod)
          if (!chosen) {
            log(`确认的方式 ${chosenMethod} 尚未切割，回退使用最近一次切割结果`)
          }
          captured = chosen ?? captured
          // forced/suppressed 是项目级人工边界；确认前再合并一次，兜住跨方式缓存与并发确认。
          const merged = await applyStoryboardBoundaryOverrides(
            projectId,
            videoPath,
            framesDir,
            captured,
            signal
          )
          captured = merged.captured
          capturedByMethod.set(chosenMethod, captured)
          log(`用户开始识别（方式=${chosenMethod}，${captured.detected.length} 镜）`)
          break
        }
        if (decision.action === 'cancel') {
          log('用户在确认页取消')
          this.cancel(jobId)
          throw new DOMException('Cancelled', 'AbortError')
        }
        // recut / recut_analyze：用新参数再切一轮
        if (decision.params) cutParams = sanitizeCutParams(decision.params)
        if (decision.action === 'recut_analyze') direct = true
        log(`${direct ? '切割并识别' : '重新切割'}: method=${cutParams.method} threshold=${cutParams.scene_threshold} hardMin=${cutParams.smart_hard_min} hardRatio=${cutParams.smart_hard_ratio} minGap=${cutParams.smart_min_gap}`)
      }

      // ---------- 阶段 B：AI 识别 ----------
      const { shots } = await analyzeCapturedShots({
        detected: captured.detected,
        framePaths: captured.framePaths,
        durationSec: captured.durationSec,
        preservedUserContent,
        prompt,
        concurrency,
        signal,
        onProgress: (ev) => {
          if (ev.phase === 'analyzing') {
            send('analyzing', {
              progress: 0.45 + 0.45 * (ev.current ?? 0) / Math.max(1, ev.total ?? 1),
              message: ev.message,
              currentShot: ev.current,
              totalShots: ev.total,
            })
          } else if (ev.phase === 'saving') {
            send('generating', { progress: 0.92, message: ev.message })
          }
        },
        // 占位脚手架：分析开始前一次性把全部镜头的表格行下发，主编辑器先铺出分镜表
        onScaffold: (placeholders, paths) => {
          if (sender.isDestroyed()) return
          sender.send(IPC.EVENT_STORYBOARD_SCAFFOLD, {
            jobId,
            projectId,
            shots: placeholders,
            framePaths: paths,
          })
        },
        // 每分析完一个镜头就推送，主编辑器分镜表逐镜填充（做好一个出一个）
        onShotAnalyzed: (index, shot) => {
          if (sender.isDestroyed()) return
          sender.send(IPC.EVENT_STORYBOARD_SHOT_UPDATED, { projectId, index, shot })
        },
        log,
      })
      const framePaths = captured.framePaths
      const sceneSeries = captured.sceneSeries
      const durationSec = captured.durationSec

      // 4. 保存项目（md + 图片）
      const sbProject: StoryboardProject = {
        id: projectId,
        videoPath,
        createdAt: Date.now(),
        shots,
        framePaths,
      }
      await writeStoryboardMd(projectId, sbProject)
      // 持久化差异曲线（best-effort：失败不影响分镜本身）
      if (sceneSeries && sceneSeries.length > 0) {
        try {
          await writeSceneScores(projectId, {
            threshold: captured.seriesThreshold,
            durationSec: durationSec ?? (sceneSeries[sceneSeries.length - 1]?.t ?? 0),
            points: sceneSeries,
          })
        } catch (e: any) {
          log(`差异曲线写盘失败（忽略）: ${e?.message ?? e}`)
        }
      }
      // 清理未被本次分镜引用的旧截图（重切多轮/重新生成会留下孤儿 jpg；best-effort）
      try {
        const referenced = new Set(framePaths.map((p) => path.resolve(p)))
        const entries = await fs.readdir(framesDir)
        for (const name of entries) {
          const full = path.resolve(framesDir, name)
          if (/^frame_\d+\.jpg$/.test(name) && !referenced.has(full)) {
            await fs.unlink(full).catch(() => {})
          }
        }
      } catch {
        /* ignore */
      }
      log(`已保存: ${getProjectDir(projectId)}`)

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      log(`分镜表生成完成，耗时 ${elapsed}s`)
      send('completed', { progress: 1, message: '完成' })
      sender.send(IPC.EVENT_STORYBOARD_COMPLETED, {
        jobId,
        videoPath,
        xlsxPath: '',
        shots,
      })
      if (!sender.isDestroyed()) {
        sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      log(`错误: ${msg}`)
      if (signal.aborted) {
        send('cancelled', { message: '已取消' })
      } else {
        send('failed', { message: msg })
        sender.send(IPC.EVENT_STORYBOARD_FAILED, { jobId, message: msg })
      }
      // 取消/失败时让渲染端按磁盘真实状态重载，丢弃只存在于内存的占位脚手架
      if (!sender.isDestroyed()) {
        sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
      }
    } finally {
      this.cutWaiters.delete(jobId)
      this.cutPreviewSessions.delete(jobId)
      this.active.delete(jobId)
    }
  }
}

function captureFrames(captured: DetectAndCaptureResult): StoryboardCapturedFrame[] {
  return captured.detected.map((shot, index) => ({
    index,
    path: captured.framePaths[index],
    timestamp: shot.timestamp,
    score: shot.score,
    kind: shot.kind,
  }))
}

function captureSceneSeries(captured: DetectAndCaptureResult) {
  if (!captured.sceneSeries) return undefined
  return {
    threshold: captured.seriesThreshold,
    durationSec:
      captured.durationSec ??
      captured.sceneSeries[captured.sceneSeries.length - 1]?.t ??
      0,
    points: captured.sceneSeries,
  }
}

function formatHMS(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 钳制切割参数到合法范围（渲染端重切回传的参数不可信，与 config 合并钳制一致） */
function sanitizeCutParams(p: CutParams): CutParams {
  return {
    method: p.method === 'scene' ? 'scene' : 'smart',
    scene_threshold: Math.max(0.01, Math.min(1, Number(p.scene_threshold) || 0.3)),
    smart_hard_min: Math.max(1, Math.min(50, Number(p.smart_hard_min) || 5.5)),
    smart_hard_ratio: Math.max(2, Math.min(50, Number(p.smart_hard_ratio) || 8)),
    smart_min_gap: Math.max(0.1, Math.min(10, Number(p.smart_min_gap) || 0.3)),
  }
}

/** 按当前顺序重排镜号，并把每镜的结束时间/时长区间重算为「下一镜起点」 */
export function renumberShots(shots: StoryboardShot[]): void {
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    s.number = i + 1
    const end =
      i < shots.length - 1
        ? shots[i + 1].startSec
        : s.endSec > s.startSec
          ? s.endSec
          : s.startSec + 5
    s.endSec = end
    s.timeRange = `${formatHMS(s.startSec)} - ${formatHMS(end)}`
  }
}

/** splice(index, 1) 后调用：让左镜先继承被删右镜的末端，保证删除末镜不会截断视频。 */
export function extendLeftShotThroughDeletedBoundary(
  remainingShots: StoryboardShot[],
  removedIndex: number,
  removedEndSec: number
): void {
  const left = remainingShots[removedIndex - 1]
  if (left && Number.isFinite(removedEndSec)) {
    left.endSec = Math.max(left.endSec, removedEndSec)
  }
}

/**
 * 把持久化人工覆盖合并到一次自动检测结果：
 * suppressed 只移除同毫秒的自动点，forced 最后加入并覆盖同毫秒自动点，因此人工结果不会被 maxShots 丢弃。
 */
export async function applyStoryboardBoundaryOverrides(
  projectId: string,
  videoPath: string,
  framesDir: string,
  captured: DetectAndCaptureResult,
  signal?: AbortSignal
): Promise<{ captured: DetectAndCaptureResult; changed: boolean }> {
  const overrides = await readStoryboardBoundaryOverrides(projectId)
  if (overrides.forced.length === 0 && overrides.suppressed.length === 0) {
    return { captured, changed: false }
  }

  let durationSec = captured.durationSec
  if (!(durationSec && durationSec > 0)) {
    durationSec = (await getVideoInfo(videoPath)).durationSec
  }
  const automaticByMs = new Map<
    number,
    { shot: DetectedShot; framePath: string }
  >()
  captured.detected.forEach((shot, index) => {
    const timeMs = storyboardBoundaryMs(shot.timestamp)
    if (timeMs !== null) {
      automaticByMs.set(timeMs, { shot: { ...shot }, framePath: captured.framePaths[index] })
    }
  })
  const plan = mergeStoryboardBoundaryTimes(
    captured.detected.map((shot) => shot.timestamp),
    overrides,
    durationSec
  )
  const entries: Array<{ shot: DetectedShot; framePath: string }> = []
  for (const point of plan) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (point.manual) {
      const timestamp = storyboardBoundarySec(point.timeMs)
      entries.push({
        shot: { timestamp, score: 0, thumbT: timestamp, kind: 'manual' },
        framePath: await extractFrame(videoPath, timestamp, framesDir),
      })
    } else {
      const automatic = automaticByMs.get(point.timeMs)
      if (automatic) entries.push(automatic)
    }
  }

  const originalPlan = captured.detected.map((shot) => ({
    timeMs: storyboardBoundaryMs(shot.timestamp),
    manual: false,
  }))
  const changed =
    plan.length !== originalPlan.length ||
    plan.some(
      (point, index) =>
        point.timeMs !== originalPlan[index]?.timeMs || point.manual !== originalPlan[index]?.manual
    )
  return {
    changed,
    captured: {
      ...captured,
      detected: entries.map((entry) => entry.shot),
      framePaths: entries.map((entry) => entry.framePath),
      durationSec,
    },
  }
}

// ------------------------------------------------------------------
// 公共可复用入口 — 研究管理器直接调用这个
// ------------------------------------------------------------------

export interface RunStoryboardOptions {
  videoPath: string
  framesDir: string
  prompt?: string
  /** 分镜大师 id（''=默认）；缺省回退 config.storyboard_master */
  master?: string
  /** 切割方式；缺省读配置（storyboard.cut_method，默认 smart） */
  cutMethod?: CutParams['method']
  /** scene 方式的切点判定阈值；缺省读配置 */
  threshold?: number
  /** smart 方式的用户参数；缺省读配置 */
  smartParams?: { hardMin?: number; hardRatio?: number; minGap?: number }
  maxShots?: number
  /** 单个视频内的 analyze 并发 */
  concurrency?: number
  signal?: AbortSignal
  /** 额外计算每帧场景差异曲线（仅单视频项目需要；研究批量不算，省时间） */
  computeSceneSeries?: boolean
  onProgress?: (ev: {
    phase: 'detecting' | 'capturing' | 'analyzing' | 'saving'
    current?: number
    total?: number
    message: string
    /** capturing 阶段携带刚采样到的关键帧（边采样边推送） */
    frame?: StoryboardCapturedFrame
    /** detecting 结束时携带整条每帧差异值曲线（已降采样），供 UI 在截图核对阶段展示 */
    series?: SceneScorePoint[]
    /** 与 series 一起给出的视频时长兜底（秒，取曲线末点时间） */
    durationSec?: number
  }) => void
  /** 截图采样完成、分析开始前下发占位脚手架（仅单视频项目用，让主编辑器先把分镜表铺出来） */
  onScaffold?: (shots: StoryboardShot[], framePaths: string[]) => void
  /** 每个镜头分析完成时回调（含失败占位），供主编辑器逐镜填充 */
  onShotAnalyzed?: (index: number, shot: StoryboardShot) => void
  log?: (msg: string) => void
}

export interface RunStoryboardResult {
  shots: StoryboardShot[]
  framePaths: string[]
  /** 每帧差异曲线（仅当 computeSceneSeries=true 且计算成功时存在） */
  sceneSeries?: SceneScorePoint[]
  /** 视频时长（秒），随曲线一起算出，便于持久化 */
  durationSec?: number
}

/** 由当前配置推导分镜分析使用的「供应商 · 模型」标签，给任务卡显示 */
function providerLabelFor(cfg: ReturnType<typeof getConfig>): string {
  const provider = cfg.storyboard_provider ?? 'gemini'
  if (provider === 'gemini') return `Gemini · ${cfg.gemini.model?.trim() || 'gemini-3.5-flash'}`
  if (provider === 'kimi') return `Kimi · ${cfg.kimi.model?.trim() || 'kimi-k3'}`
  if (provider === 'minimax') return `MiniMax · ${cfg.minimax.model?.trim() || 'MiniMax-M3'}`
  if (provider === 'openai') return `OpenAI · ${cfg.openai?.model?.trim() || 'gpt-5.6'}`
  if (provider === 'anthropic') return `Claude · ${cfg.anthropic?.model?.trim() || 'claude-fable-5'}`
  const custom = cfg.custom_providers?.find((p) => p.id === provider)
  return custom ? `${custom.name} · ${custom.model}` : provider
}

/**
 * 解析分镜分析器配置 — 暴露给研究管理器复用
 */
export function resolveAnalyzerConfig(cfg: ReturnType<typeof getConfig>): AnalyzerConfig {
  const provider = cfg.storyboard_provider ?? 'gemini'
  if (provider === 'gemini') {
    if (!cfg.gemini.api_key) throw new Error('Gemini API Key 未配置')
    return {
      provider: 'gemini',
      apiKey: cfg.gemini.api_key,
      baseUrl: '',
      model: cfg.gemini.model?.trim() || 'gemini-3.5-flash',
    }
  }
  if (provider === 'kimi') {
    if (!cfg.kimi.api_key) throw new Error('Kimi API Key 未配置')
    return {
      provider: 'openai',
      apiKey: cfg.kimi.api_key,
      baseUrl: cfg.kimi.base_url || 'https://api.moonshot.cn/v1',
      model: cfg.kimi.model || 'kimi-k3',
    }
  }
  if (provider === 'minimax') {
    if (!cfg.minimax.api_key) throw new Error('MiniMax API Key 未配置')
    return {
      provider: 'openai',
      apiKey: cfg.minimax.api_key,
      baseUrl: cfg.minimax.base_url || 'https://api.minimaxi.com/v1',
      model: cfg.minimax.model || 'MiniMax-M3',
    }
  }
  if (provider === 'openai') {
    if (!cfg.openai?.api_key) throw new Error('OpenAI API Key 未配置')
    return {
      provider: 'openai',
      apiKey: cfg.openai.api_key,
      baseUrl: cfg.openai.base_url?.trim() || 'https://api.openai.com/v1',
      model: cfg.openai.model?.trim() || 'gpt-5.6',
    }
  }
  if (provider === 'anthropic') {
    if (!cfg.anthropic?.api_key) throw new Error('Anthropic API Key 未配置')
    return {
      provider: 'anthropic',
      apiKey: cfg.anthropic.api_key,
      baseUrl: cfg.anthropic.base_url?.trim() || '',
      model: cfg.anthropic.model?.trim() || 'claude-fable-5',
    }
  }
  const custom = cfg.custom_providers?.find((p) => p.id === provider)
  if (!custom) throw new Error(`未知供应商: ${provider}`)
  if (!custom.api_key) throw new Error(`${custom.name} API Key 未配置`)
  return {
    provider: 'openai',
    apiKey: custom.api_key,
    baseUrl: custom.base_url,
    model: custom.model,
  }
}

// ---------- 阶段 A：切割 + 截图 ----------

export interface DetectAndCaptureOptions {
  videoPath: string
  /** 关键帧输出目录；缺省（undefined）时跳过抽帧，仅返回镜头边界 */
  framesDir?: string
  cutParams: CutParams
  maxShots?: number
  signal?: AbortSignal
  /** 额外计算每帧场景差异曲线（scene 方式多一趟解码；smart 方式顺带免费产出） */
  computeSceneSeries?: boolean
  onProgress?: (ev: {
    phase: 'detecting' | 'capturing'
    current?: number
    total?: number
    message: string
    frame?: StoryboardCapturedFrame
    series?: SceneScorePoint[]
    durationSec?: number
    /** 曲线阈值线展示值（scene=阈值；smart=hardMin/255） */
    seriesThreshold?: number
  }) => void
  log?: (msg: string) => void
}

export interface DetectAndCaptureResult {
  /** 检测出的镜头（timestamp=分镜起点；smart 另带 thumbT/kind） */
  detected: DetectedShot[]
  /** 与 detected 对齐的关键帧路径 */
  framePaths: string[]
  sceneSeries?: SceneScorePoint[]
  durationSec?: number
  /** 曲线阈值线展示值（scene=阈值；smart=hardMin/255） */
  seriesThreshold: number
}

/** 数量截断：保留第一镜 + 其余按切点得分取最高的 maxShots-1 个（按时间排序） */
function capShots(shots: DetectedShot[], maxShots: number): DetectedShot[] {
  if (shots.length <= maxShots) return shots
  const first = shots[0]
  const rest = shots
    .slice(1)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxShots - 1)
    .sort((a, b) => a.timestamp - b.timestamp)
  return [first, ...rest]
}

/** 阶段 A：按指定方式切割镜头并逐镜截图。不写盘、不推 IPC。 */
export async function detectAndCaptureShots(opts: DetectAndCaptureOptions): Promise<DetectAndCaptureResult> {
  const {
    videoPath,
    framesDir,
    cutParams,
    maxShots = 200,
    signal,
    computeSceneSeries = false,
    onProgress,
    log = () => {},
  } = opts

  onProgress?.({ phase: 'detecting', message: '分析镜头切换点...' })

  let detected: DetectedShot[]
  let sceneSeries: SceneScorePoint[] | undefined
  let durationSec: number | undefined
  let seriesThreshold: number

  if (cutParams.method === 'smart') {
    seriesThreshold = cutParams.smart_hard_min / 255
    log(
      `镜头切分(smart): hardMin=${cutParams.smart_hard_min} hardRatio=${cutParams.smart_hard_ratio} minGap=${cutParams.smart_min_gap}`
    )
    const r = await smartDetect(
      videoPath,
      {
        hardMin: cutParams.smart_hard_min,
        hardRatio: cutParams.smart_hard_ratio,
        minGap: cutParams.smart_min_gap,
      },
      signal
    )
    detected = capShots(
      r.shots.map((s) => ({ timestamp: s.start, score: s.score, thumbT: s.thumbT, kind: s.kind })),
      maxShots
    )
    durationSec = r.duration
    if (computeSceneSeries) sceneSeries = downsampleSeries(r.series, SCENE_SERIES_MAX_POINTS)
    const kinds = r.cuts.reduce<Record<string, number>>((acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1
      return acc
    }, {})
    log(`smart 切出 ${detected.length} 镜（切点: ${Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(' ') || '无'}）`)
  } else {
    seriesThreshold = cutParams.scene_threshold
    const detectParams: DetectParams = { threshold: cutParams.scene_threshold, maxShots }
    log(`镜头切分(scene): 每帧差异值 threshold=${detectParams.threshold}`)
    if (computeSceneSeries) {
      try {
        const r = await detectShotsWithSeries(videoPath, detectParams, signal)
        detected = r.shots
        sceneSeries = r.series
      } catch (err: any) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
        // 差异曲线检测失败不影响分镜：detectShots 内部还有单帧阈值兜底
        log(`差异曲线检测失败，回退镜头检测: ${err?.message ?? err}`)
        detected = await detectShots(videoPath, detectParams, signal)
      }
    } else {
      detected = await detectShots(videoPath, detectParams, signal)
    }
    if (sceneSeries?.length) durationSec = sceneSeries[sceneSeries.length - 1].t
  }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  log(`检测到 ${detected.length} 个镜头`)
  onProgress?.({
    phase: 'detecting',
    message: `检测到 ${detected.length} 个镜头`,
    total: detected.length,
    series: sceneSeries,
    durationSec,
    seriesThreshold,
  })

  // 截图（顺序）；smart 方式用 thumbT 取帧，避开转场的白/黑帧
  // 原生视频模式（framesDir 缺省）跳过抽帧：只交付镜头边界时间轴
  const framePaths: string[] = []
  if (framesDir) {
    await fs.mkdir(framesDir, { recursive: true })
    const total = detected.length
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const t = detected[i].timestamp
      const grabT = detected[i].thumbT ?? t
      const framePath = await extractFrame(videoPath, grabT, framesDir)
      framePaths.push(framePath)
      // 截图完成后立即推送该帧，让 UI 在 AI 分析前就能核对镜头切分是否合理
      onProgress?.({
        phase: 'capturing',
        current: i + 1,
        total,
        message: `截图 ${i + 1}/${total}`,
        frame: { index: i, path: framePath, timestamp: t, score: detected[i].score, kind: detected[i].kind },
      })
      log(`[${i + 1}/${total}] 截图 t=${grabT.toFixed(2)}s -> ${path.basename(framePath)}`)
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  }

  return { detected, framePaths, sceneSeries, durationSec, seriesThreshold }
}

// ---------- 阶段 B：AI 识别 ----------

export interface AnalyzeCapturedOptions {
  detected: DetectedShot[]
  framePaths: string[]
  /** 视频总时长（秒），末镜 endSec 用；缺省用末镜起点 +5s 兜底 */
  durationSec?: number
  prompt?: string
  concurrency?: number
  /** 同起始毫秒的用户编辑镜头：整表重切时直接保留内容，不调用 AI 覆盖 */
  preservedUserContent?: ReadonlyMap<number, StoryboardShot>
  signal?: AbortSignal
  onProgress?: (ev: { phase: 'analyzing' | 'saving'; current?: number; total?: number; message: string }) => void
  onScaffold?: (shots: StoryboardShot[], framePaths: string[]) => void
  onShotAnalyzed?: (index: number, shot: StoryboardShot) => void
  log?: (msg: string) => void
}

/** 阶段 B：对已截好的关键帧逐镜调用 AI 识别。不写盘、不推 IPC。 */
export async function analyzeCapturedShots(opts: AnalyzeCapturedOptions): Promise<{ shots: StoryboardShot[] }> {
  const {
    detected: shots,
    framePaths,
    durationSec,
    prompt: promptIn,
    concurrency: concurrencyIn = 3,
    preservedUserContent,
    signal,
    onProgress,
    onScaffold,
    onShotAnalyzed,
    log = () => {},
  } = opts

  const prompt = promptIn?.trim() || buildAnalyzePrompt(undefined, undefined)
  const concurrency = Math.max(1, Math.min(10, concurrencyIn))
  const total = shots.length

  const cfg = getConfig()
  const analyzerCfg = resolveAnalyzerConfig(cfg)
  const analyzer = createAnalyzer(analyzerCfg)
  log(`analyzeCapturedShots: provider=${analyzerCfg.provider} model=${analyzerCfg.model} shots=${total} concurrency=${concurrency}`)

  const endOf = (idx: number): number => {
    if (idx < total - 1) return shots[idx + 1].timestamp
    const t = shots[idx].timestamp
    return durationSec && durationSec > t ? durationSec : t + 5
  }

  const preservedShotAt = (idx: number): StoryboardShot | undefined => {
    const timeMs = storyboardBoundaryMs(shots[idx].timestamp)
    return timeMs === null ? undefined : preservedUserContent?.get(timeMs)
  }

  const withPosition = (
    content: StoryboardShot,
    idx: number,
    userEdited: boolean
  ): StoryboardShot => {
    const startSec = shots[idx].timestamp
    const endSec = endOf(idx)
    return {
      ...content,
      number: idx + 1,
      startSec,
      endSec,
      timeRange: `${formatHMS(startSec)} - ${formatHMS(endSec)}`,
      sceneScore: shots[idx].score,
      userEdited,
    }
  }

  // 分析前先下发占位脚手架：让主编辑器把全部镜头的表格行铺出来（内容待逐镜填充）
  if (onScaffold) {
    const placeholders: StoryboardShot[] = shots.map((s, i) => {
      const preserved = preservedShotAt(i)
      if (preserved) return withPosition(preserved, i, true)
      const endSec = endOf(i)
      return {
        number: i + 1,
        shotType: '识别中…',
        angle: '',
        cameraMove: '',
        description: '',
        dialogue: '',
        sound: '',
        timeRange: `${formatHMS(s.timestamp)} - ${formatHMS(endSec)}`,
        startSec: s.timestamp,
        endSec,
        sceneScore: s.score,
        userEdited: false,
      }
    })
    onScaffold(placeholders, framePaths.slice())
  }

  // 分批并行分析
  const analyzedShots: StoryboardShot[] = new Array(total)
  let completedCount = 0

  for (let batchStart = 0; batchStart < total; batchStart += concurrency) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const batchEnd = Math.min(batchStart + concurrency, total)

    const batchPromises: Promise<void>[] = []
    for (let i = batchStart; i < batchEnd; i++) {
      const idx = i
      const shotInfo = shots[idx]
      const t = shotInfo.timestamp
      const framePath = framePaths[idx]
      const preserved = preservedShotAt(idx)

      if (preserved) {
        const kept = withPosition(preserved, idx, true)
        analyzedShots[idx] = kept
        completedCount++
        log(`[${completedCount}/${total}] ↺ 镜${idx + 1}: 保留用户编辑内容`)
        onProgress?.({
          phase: 'analyzing',
          current: completedCount,
          total,
          message: `已处理 ${completedCount}/${total}`,
        })
        onShotAnalyzed?.(idx, kept)
        continue
      }

      const p = analyzer
        .analyze(framePath, prompt, signal)
        .then((shot) => {
          shot.number = idx + 1
          shot.startSec = t
          shot.endSec = endOf(idx)
          shot.timeRange = `${formatHMS(t)} - ${formatHMS(shot.endSec)}`
          shot.sceneScore = shotInfo.score
          shot.userEdited = false
          analyzedShots[idx] = shot
          completedCount++
          log(`[${completedCount}/${total}] ✓ 镜${idx + 1}: ${shot.shotType} · ${shot.angle} (score=${shotInfo.score.toFixed(3)})`)
          onProgress?.({
            phase: 'analyzing',
            current: completedCount,
            total,
            message: `已分析 ${completedCount}/${total}`,
          })
          onShotAnalyzed?.(idx, shot)
        })
        .catch((err) => {
          if (signal?.aborted) return // 取消时静默
          log(`[${idx + 1}/${total}] ✗ 分析失败: ${err?.message ?? String(err)}`)
          analyzedShots[idx] = {
            number: idx + 1,
            shotType: '未知',
            angle: '未知',
            cameraMove: '未知',
            description: `分析失败: ${err?.message ?? '未知错误'}`,
            dialogue: '',
            sound: '',
            timeRange: `${formatHMS(t)} - ${formatHMS(endOf(idx))}`,
            startSec: t,
            endSec: endOf(idx),
            sceneScore: shotInfo.score,
            userEdited: false,
          }
          completedCount++
          onProgress?.({
            phase: 'analyzing',
            current: completedCount,
            total,
            message: `已分析 ${completedCount}/${total} (有失败)`,
          })
          onShotAnalyzed?.(idx, analyzedShots[idx])
        })

      batchPromises.push(p)
    }

    await Promise.all(batchPromises)
  }

  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  log(`全部 ${total} 个镜头分析完成`)
  onProgress?.({ phase: 'saving', message: '写入分镜...' })

  return { shots: analyzedShots }
}

/**
 * 单个视频的完整分镜管线：检测镜头 → 截帧 → 并发分析（阶段 A + B 直通，无确认环节）。
 * 不写盘；不推送 IPC。CLI 与研究管线用它；切割方式与参数缺省读全局配置。
 */
export async function runStoryboardOnce(opts: RunStoryboardOptions): Promise<RunStoryboardResult> {
  const cfg = getConfig()
  const sb = cfg.storyboard
  const cutParams: CutParams = sanitizeCutParams({
    method: opts.cutMethod ?? sb.cut_method ?? 'smart',
    scene_threshold: opts.threshold ?? sb.scene_threshold ?? 0.3,
    smart_hard_min: opts.smartParams?.hardMin ?? sb.smart_hard_min ?? 5.5,
    smart_hard_ratio: opts.smartParams?.hardRatio ?? sb.smart_hard_ratio ?? 8,
    smart_min_gap: opts.smartParams?.minGap ?? sb.smart_min_gap ?? 0.3,
  })
  // 分析器配置提前解析：API Key 未配置时在切割前就报错
  resolveAnalyzerConfig(cfg)

  const captured = await detectAndCaptureShots({
    videoPath: opts.videoPath,
    framesDir: opts.framesDir,
    cutParams,
    maxShots: opts.maxShots ?? sb.max_shots ?? 200,
    signal: opts.signal,
    computeSceneSeries: opts.computeSceneSeries ?? false,
    onProgress: (ev) => {
      opts.onProgress?.({
        phase: ev.phase,
        current: ev.current,
        total: ev.total,
        message: ev.message,
        frame: ev.frame,
        series: ev.series,
        durationSec: ev.durationSec,
      })
    },
    log: opts.log,
  })

  const { shots } = await analyzeCapturedShots({
    detected: captured.detected,
    framePaths: captured.framePaths,
    durationSec: captured.durationSec,
    prompt: buildAnalyzePrompt(opts.prompt, opts.master ?? cfg.storyboard_master),
    concurrency: opts.concurrency,
    signal: opts.signal,
    onProgress: (ev) => opts.onProgress?.(ev),
    onScaffold: opts.onScaffold,
    onShotAnalyzed: opts.onShotAnalyzed,
    log: opts.log,
  })

  return {
    shots,
    framePaths: captured.framePaths,
    sceneSeries: captured.sceneSeries,
    durationSec: captured.durationSec,
  }
}

export const storyboardManager = new StoryboardManager()
