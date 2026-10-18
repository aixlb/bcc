/**
 * 风格研究作业管理器（GUI 适配层）。
 * 两阶段编排已抽到 core/pipelines/research 的纯入口 runResearch；本类只负责
 * ProgressTarget 进度桥接与 完成/失败 事件。
 */
import { randomUUID } from 'node:crypto'
import type { ProgressTarget } from '../runtime.js'
import type { ResearchCompletedEvent, ResearchFailedEvent, ResearchProgressEvent } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import { getConfig } from './config.js'
import { runResearch } from '../pipelines/research.js'

interface ActiveJob {
  id: string
  controller: AbortController
}

class ResearchManager {
  private active = new Map<string, ActiveJob>()

  async start(args: { researchId: string }, sender: ProgressTarget): Promise<string> {
    const jobId = randomUUID()
    const controller = new AbortController()
    this.active.set(jobId, { id: jobId, controller })

    this.runJob(jobId, args.researchId, sender, controller.signal).catch((err) => {
      console.error('[Research] failed:', err)
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

  // ----------------------------------------------------------------

  private async runJob(
    jobId: string,
    researchId: string,
    sender: ProgressTarget,
    signal: AbortSignal
  ): Promise<void> {
    const log = (msg: string) => console.log(`[Research][${jobId.slice(0, 8)}] ${msg}`)

    const send = (payload: Partial<ResearchProgressEvent>) => {
      if (sender.isDestroyed()) return
      const ev: ResearchProgressEvent = {
        jobId,
        status: payload.status ?? 'preparing',
        progress: payload.progress ?? 0,
        message: payload.message ?? '',
        currentSub: payload.currentSub,
        totalSubs: payload.totalSubs ?? 0,
        partialStyleGuide: payload.partialStyleGuide,
        subVideoPath: payload.subVideoPath,
        subStatus: payload.subStatus,
        subProgress: payload.subProgress,
      }
      sender.send(IPC.EVENT_RESEARCH_PROGRESS, ev)
    }

    try {
      const { styleGuide, meta } = await runResearch({
        researchId,
        config: getConfig(),
        signal,
        log,
        onProgress: (ev) => send(ev),
      })

      const completedEv: ResearchCompletedEvent = { jobId, meta, styleGuide }
      if (!sender.isDestroyed()) {
        sender.send(IPC.EVENT_RESEARCH_COMPLETED, completedEv)
        sender.send(IPC.EVENT_RESEARCH_UPDATED, { id: researchId })
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (signal.aborted) {
        log('已取消')
        send({ status: 'cancelled', progress: 0, message: '已取消' })
        if (!sender.isDestroyed()) {
          const ev: ResearchFailedEvent = { jobId, message: '已取消' }
          sender.send(IPC.EVENT_RESEARCH_FAILED, ev)
        }
      } else {
        log(`错误: ${msg}`)
        send({ status: 'failed', progress: 0, message: msg })
        if (!sender.isDestroyed()) {
          const ev: ResearchFailedEvent = { jobId, message: msg }
          sender.send(IPC.EVENT_RESEARCH_FAILED, ev)
        }
      }
    } finally {
      this.active.delete(jobId)
    }
  }
}

export const researchManager = new ResearchManager()
