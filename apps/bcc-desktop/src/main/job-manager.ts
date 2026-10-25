/**
 * Job Manager: 管理一个剧本生成作业，向渲染进程推送进度事件。
 * 编排逻辑已抽到 core/pipelines/script 的纯入口 runScript；本类只负责
 * WebContents 进度桥接、持久化 script.md、以及完成/失败事件。
 */
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { AppConfig, JobStatus, ProgressEvent, ScriptResult } from '@shared/types'
import { DEFAULT_MODELS } from '@shared/model-presets'
import { IPC } from '@shared/ipc-channels'
import { getConfig } from '@core/services/config.js'
import { masterLabelSuffix } from '@core/services/masters.js'
import { getProjectScriptPath, saveScriptVersion } from '@core/services/project-storage.js'
import { runScript } from '@core/pipelines/script.js'

/** 由当前配置推导剧本生成使用的「供应商 · 模型」标签（记进版本元数据） */
function scriptProviderLabel(cfg: AppConfig): string {
  const provider = cfg.script_provider ?? 'gemini'
  if (provider === 'gemini') return `Gemini · ${cfg.gemini.model?.trim() || DEFAULT_MODELS.gemini}`
  if (provider === 'kimi') return `Kimi · ${cfg.kimi.model?.trim() || DEFAULT_MODELS.kimi}`
  if (provider === 'minimax') return `MiniMax · ${cfg.minimax.model?.trim() || DEFAULT_MODELS.minimax}`
  if (provider === 'openai') return `OpenAI · ${cfg.openai?.model?.trim() || DEFAULT_MODELS.openai}`
  if (provider === 'anthropic') return `Claude · ${cfg.anthropic?.model?.trim() || DEFAULT_MODELS.anthropic}`
  const custom = cfg.custom_providers?.find((p) => p.id === provider)
  return custom ? `${custom.name} · ${custom.model}` : provider
}

interface ActiveJob {
  id: string
  controller: AbortController
}

class JobManager {
  private active = new Map<string, ActiveJob>()

  async start(
    args: { projectId: string; videoPath: string; master?: string },
    sender: WebContents
  ): Promise<string> {
    const jobId = randomUUID()
    const controller = new AbortController()
    this.active.set(jobId, { id: jobId, controller })

    // 异步执行，不阻塞 IPC 返回
    this.runJob(jobId, args.projectId, args.videoPath, sender, controller.signal, args.master).catch((err) => {
      console.error('[Job] failed:', err)
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

  private async runJob(
    jobId: string,
    projectId: string,
    videoPath: string,
    sender: WebContents,
    signal: AbortSignal,
    master?: string
  ): Promise<void> {
    const startedAt = Date.now()
    let tokensUsed: number | undefined
    let videoSizeBytes = 0
    const send = (status: JobStatus, payload: Partial<ProgressEvent> = {}) => {
      if (sender.isDestroyed()) return
      const ev: ProgressEvent = {
        jobId,
        status,
        progress: payload.progress ?? 0,
        message: payload.message ?? '',
        partialScript: payload.partialScript,
        currentSegment: payload.currentSegment,
        totalSegments: payload.totalSegments,
        elapsedMs: Date.now() - startedAt,
        etaMs: payload.etaMs,
        tokensUsed: payload.tokensUsed ?? tokensUsed,
        videoSizeBytes: payload.videoSizeBytes ?? videoSizeBytes,
      }
      sender.send(IPC.EVENT_PROGRESS, ev)
    }

    try {
      const pipeline = await runScript({
        videoPath,
        config: getConfig(),
        masterId: master,
        signal,
        onProgress: (ev) => {
          if (typeof ev.videoSizeBytes === 'number') videoSizeBytes = ev.videoSizeBytes
          if (typeof ev.tokensUsed === 'number') tokensUsed = ev.tokensUsed
          send(ev.status, ev)
        },
      })

      let scriptPath: string | undefined
      try {
        // 存为新版本并激活（script.md 保持为激活版本镜像）；旧版本保留，可在剧本页切换
        // 版本标签带上剧本大师名（如 "Gemini · gemini-3.5-flash · 山之音"），便于对比不同大师的版本
        const cfg = getConfig()
        await saveScriptVersion(
          projectId,
          pipeline.script,
          scriptProviderLabel(cfg) + masterLabelSuffix(master ?? cfg.script_master)
        )
        scriptPath = getProjectScriptPath(projectId)
      } catch (e) {
        console.error('[Job] saveScriptVersion failed:', e)
      }
      const result: ScriptResult = {
        jobId,
        videoPath,
        durationSec: pipeline.durationSec,
        script: pipeline.script,
        scenes: pipeline.scenes,
        generatedInMs: pipeline.generatedInMs,
        generatedAt: Date.now(),
        scriptPath,
      }

      send('completed', { progress: 1, message: '完成', partialScript: pipeline.script })
      // 窗口可能在作业完成的瞬间被关闭：向已销毁的 WebContents send 会抛错，需先判活
      if (!sender.isDestroyed()) {
        sender.send(IPC.EVENT_COMPLETED, result)
        sender.send(IPC.EVENT_PROJECT_UPDATED, { id: projectId })
      }
    } catch (err: any) {
      if (signal.aborted) {
        send('cancelled', { message: '已取消' })
      } else {
        const msg = err?.message ?? String(err)
        send('failed', { message: msg })
        if (!sender.isDestroyed()) sender.send(IPC.EVENT_FAILED, { jobId, message: msg })
      }
    } finally {
      this.active.delete(jobId)
    }
  }

  /** 取消所有作业（关闭窗口时调用） */
  cancelAll(): void {
    for (const job of this.active.values()) {
      job.controller.abort()
    }
    this.active.clear()
  }
}

export const jobManager = new JobManager()
