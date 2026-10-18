/**
 * 剧本生成管线（framework-agnostic 纯入口）。
 *
 * 从原 job-manager 的 runJob 抽出：探测视频 → 按 config 选 provider → 流式生成 → 解析场景。
 * 不写盘、不推送 IPC、不认 projectId / jobId；进度通过 onProgress 回调上报，结果作为返回值。
 * GUI 的 JobManager 与 CLI 都包一层薄适配调用它；测试可注入 generate / probeVideo 跳过真实依赖。
 */
import type { AppConfig, JobStatus, ScriptScene } from '@shared/types'
import { parseScript } from '@shared/parse-script'
import { GeminiService } from '../services/gemini.js'
import { KimiService } from '../services/kimi.js'
import { MinimaxService } from '../services/minimax.js'
import { OpenAIScriptService } from '../services/openai-script.js'
import { ChatGPTService } from '../services/chatgpt.js'
import { ClaudeService } from '../services/claude.js'
import { getVideoInfo as defaultGetVideoInfo, type VideoInfo } from '../services/video.js'
import { SCRIPT_SYSTEM_PROMPT } from '../services/prompt.js'
import { getScriptMasterAddendum } from '../services/masters.js'

/** 进度事件（剔除了 GUI 专属的 jobId / elapsedMs，由调用方补齐） */
export interface ScriptProgress {
  status: JobStatus
  progress: number
  message: string
  partialScript?: string
  currentSegment?: number
  totalSegments?: number
  tokensUsed?: number
  videoSizeBytes?: number
}

/** 剧本管线结果（无 jobId / projectId / 持久化，由调用方包装成 ScriptResult） */
export interface ScriptRunResult {
  script: string
  scenes: ScriptScene[]
  durationSec: number
  videoSizeBytes: number
  tokensUsed?: number
  generatedInMs: number
}

/** 与各 provider 的 GenerationCallbacks 结构兼容的统一回调（gemini 的为超集） */
export interface ScriptGenerationCallbacks {
  onUploadProgress?: (percent: number) => void
  onToken?: (accumulated: string, delta: string, tokensUsed?: number) => void
  onSegmentChange?: (currentIndex: number, total: number, label: string) => void
  onStatus?: (status: string, message: string) => void
  signal?: AbortSignal
}

export type ScriptGenerate = (
  videoPath: string,
  videoInfo: VideoInfo,
  callbacks: ScriptGenerationCallbacks,
  /** 生效的系统 prompt（含剧本大师附录时才传；undefined = provider 用默认） */
  systemPrompt?: string
) => Promise<string>

export interface RunScriptOptions {
  videoPath: string
  config: AppConfig
  signal?: AbortSignal
  onProgress?: (ev: ScriptProgress) => void
  /** 本次生成使用的剧本大师 id；缺省用 config.script_master（'' = 默认） */
  masterId?: string
  /** 测试可注入：跳过真实 provider，直接用此函数生成剧本 */
  generate?: ScriptGenerate
  /** 测试可注入：跳过真实 ffprobe */
  probeVideo?: (videoPath: string) => Promise<VideoInfo>
}

export async function runScript(opts: RunScriptOptions): Promise<ScriptRunResult> {
  const { videoPath, config: cfg, signal, onProgress } = opts
  const probe = opts.probeVideo ?? defaultGetVideoInfo
  const startedAt = Date.now()

  let tokensUsed: number | undefined
  let videoSizeBytes = 0

  const emit = (status: JobStatus, payload: Partial<ScriptProgress> = {}) => {
    onProgress?.({
      status,
      progress: payload.progress ?? 0,
      message: payload.message ?? '',
      partialScript: payload.partialScript,
      currentSegment: payload.currentSegment,
      totalSegments: payload.totalSegments,
      tokensUsed: payload.tokensUsed ?? tokensUsed,
      videoSizeBytes: payload.videoSizeBytes ?? videoSizeBytes,
    })
  }

  emit('preparing', { progress: 0.02, message: '探测视频信息...' })
  const videoInfo = await probe(videoPath)
  videoSizeBytes = videoInfo.sizeBytes

  // 剧本大师：选中时把方法论附录拼进系统 prompt；默认（''/未知 id）不注入
  const masterAddendum = getScriptMasterAddendum(opts.masterId ?? cfg.script_master)
  const systemPrompt = masterAddendum ? SCRIPT_SYSTEM_PROMPT + masterAddendum : undefined

  let currentSegment = 1
  let totalSegments = 1
  let accumulated = ''
  let script = ''

  if (opts.generate) {
    // 测试 / 自定义注入路径：通用进度回调（不依赖具体 provider）
    script = await opts.generate(videoPath, videoInfo, {
      signal,
      onStatus: (status, message) => emit(status as JobStatus, { progress: 0.42, message, partialScript: accumulated }),
      onToken: (acc, _delta, tokens) => {
        accumulated = acc
        if (typeof tokens === 'number') tokensUsed = tokens
        emit('generating', {
          progress: Math.min(0.95, 0.42 + 0.5 * Math.min(1, acc.length / 4000)),
          message: '流式生成中...',
          partialScript: accumulated,
          tokensUsed,
        })
      },
    }, systemPrompt)
  } else if (cfg.script_provider === 'kimi') {
    const svc = new KimiService(cfg.kimi)
    script = await svc.generateScript(videoPath, videoInfo, {
      signal,
      onStatus: (status, message) => {
        let progress = 0.05
        switch (status as JobStatus) {
          case 'preparing': progress = 0.05; break
          case 'compressing': progress = 0.1; break
          case 'uploading': progress = 0.18; break
          case 'waiting_process': progress = 0.32; break
          case 'generating': progress = 0.42; break
        }
        emit(status as JobStatus, { progress, message, partialScript: accumulated })
      },
      onToken: (acc, _delta, tokens) => {
        accumulated = acc
        if (typeof tokens === 'number') tokensUsed = tokens
        const progress = Math.min(0.95, 0.42 + 0.5 * Math.min(1, acc.length / 4000))
        emit('generating', { progress, message: '流式生成中...', partialScript: accumulated, tokensUsed })
      },
    }, systemPrompt)
  } else if (cfg.script_provider === 'minimax') {
    const svc = new MinimaxService(cfg.minimax)
    script = await svc.generateScript(videoPath, videoInfo, {
      signal,
      onStatus: (status, message) => {
        let progress = 0.05
        switch (status as JobStatus) {
          case 'preparing': progress = 0.05; break
          case 'compressing': progress = 0.1; break
          case 'uploading': progress = 0.18; break
          case 'waiting_process': progress = 0.32; break
          case 'generating': progress = 0.42; break
        }
        emit(status as JobStatus, { progress, message, partialScript: accumulated })
      },
      onUploadProgress: (p) => {
        const pct = Math.round(p * 100)
        emit('uploading', { progress: 0.15 + 0.15 * p, message: pct >= 95 ? `上传中 ${pct}%，请稍候...` : `上传中 ${pct}%` })
      },
      onToken: (acc, _delta, tokens) => {
        accumulated = acc
        if (typeof tokens === 'number') tokensUsed = tokens
        const progress = Math.min(0.95, 0.42 + 0.5 * Math.min(1, acc.length / 4000))
        emit('generating', {
          progress,
          message: '流式生成中（M3 推理较慢，请耐心等待）...',
          partialScript: accumulated,
          tokensUsed,
        })
      },
    }, systemPrompt)
  } else if (cfg.script_provider === 'openai') {
    const svc = new ChatGPTService(cfg.openai)
    script = await svc.generateScript(videoPath, videoInfo, {
      signal,
      onStatus: (status, message) => {
        let progress = 0.05
        switch (status as JobStatus) {
          case 'preparing': progress = 0.08; break
          case 'uploading': progress = 0.18; break
          case 'generating': progress = 0.42; break
        }
        emit(status as JobStatus, { progress, message, partialScript: accumulated })
      },
      onUploadProgress: (p) => {
        // 与 onStatus('uploading') 的 0.18 起点衔接，避免进度条回跳
        emit('uploading', { progress: 0.18 + 0.22 * p, message: `抽帧编码 ${Math.round(p * 100)}%` })
      },
      onToken: (acc, _delta, tokens) => {
        accumulated = acc
        if (typeof tokens === 'number') tokensUsed = tokens
        const progress = Math.min(0.95, 0.42 + 0.5 * Math.min(1, acc.length / 4000))
        emit('generating', { progress, message: '流式生成中...', partialScript: accumulated, tokensUsed })
      },
    }, systemPrompt)
  } else if (cfg.script_provider === 'anthropic') {
    const svc = new ClaudeService(cfg.anthropic)
    script = await svc.generateScript(videoPath, videoInfo, {
      signal,
      onStatus: (status, message) => {
        let progress = 0.05
        switch (status as JobStatus) {
          case 'preparing': progress = 0.08; break
          case 'uploading': progress = 0.18; break
          case 'generating': progress = 0.42; break
        }
        emit(status as JobStatus, { progress, message, partialScript: accumulated })
      },
      onUploadProgress: (p) => {
        // 与 onStatus('uploading') 的 0.18 起点衔接，避免进度条回跳
        emit('uploading', { progress: 0.18 + 0.22 * p, message: `抽帧编码 ${Math.round(p * 100)}%` })
      },
      onToken: (acc, _delta, tokens) => {
        accumulated = acc
        if (typeof tokens === 'number') tokensUsed = tokens
        const progress = Math.min(0.95, 0.42 + 0.5 * Math.min(1, acc.length / 4000))
        emit('generating', { progress, message: '流式生成中...', partialScript: accumulated, tokensUsed })
      },
    }, systemPrompt)
  } else if (cfg.custom_providers?.some((p) => p.id === cfg.script_provider)) {
    const custom = cfg.custom_providers.find((p) => p.id === cfg.script_provider)!
    const svc = new OpenAIScriptService(custom)
    script = await svc.generateScript(videoPath, videoInfo, {
      signal,
      onStatus: (status, message) => {
        let progress = 0.05
        switch (status as JobStatus) {
          case 'preparing': progress = 0.05; break
          case 'compressing': progress = 0.1; break
          case 'uploading': progress = 0.18; break
          case 'generating': progress = 0.42; break
        }
        emit(status as JobStatus, { progress, message, partialScript: accumulated })
      },
      onUploadProgress: (p) => {
        emit('uploading', { progress: 0.15 + 0.15 * p, message: `编码视频 ${Math.round(p * 100)}%` })
      },
      onToken: (acc, _delta, tokens) => {
        accumulated = acc
        if (typeof tokens === 'number') tokensUsed = tokens
        const progress = Math.min(0.95, 0.42 + 0.5 * Math.min(1, acc.length / 4000))
        emit('generating', {
          progress,
          message: '流式生成中（推理模型可能较慢）...',
          partialScript: accumulated,
          tokensUsed,
        })
      },
    }, systemPrompt)
  } else {
    const svc = new GeminiService(cfg.gemini)
    script = await svc.generateScript(videoPath, videoInfo, {
      signal,
      onStatus: (status, message) => {
        let progress = 0.05
        switch (status as JobStatus) {
          case 'preparing': progress = 0.05; break
          case 'compressing': progress = 0.1; break
          case 'uploading': progress = 0.18; break
          case 'waiting_process': progress = 0.32; break
          case 'generating': progress = 0.42; break
          case 'merging': progress = 0.92; break
        }
        emit(status as JobStatus, { progress, message, partialScript: accumulated, currentSegment, totalSegments })
      },
      onSegmentChange: (idx, total, label) => {
        currentSegment = idx
        totalSegments = total
        accumulated = '' // 每段开始时重置展示文本
        emit('generating', {
          progress: 0.4 + (0.5 * (idx - 1)) / total,
          message: `处理 ${label}`,
          partialScript: accumulated,
          currentSegment: idx,
          totalSegments: total,
        })
      },
      onUploadProgress: (p) => {
        const pct = Math.round(p * 100)
        emit('uploading', {
          progress: 0.15 + 0.15 * p,
          message: pct >= 95 ? `上传中 ${pct}%，请稍候...` : `上传中 ${pct}%`,
          currentSegment,
          totalSegments,
        })
      },
      onToken: (acc, _delta, tokens) => {
        accumulated = acc
        if (typeof tokens === 'number') tokensUsed = tokens
        const baseProgress = totalSegments > 1 ? 0.4 + (0.5 * (currentSegment - 1)) / totalSegments : 0.42
        const segGrowth = totalSegments > 1 ? 0.5 / totalSegments : 0.5
        const tokenProgress = Math.min(0.95, acc.length / 4000)
        const progress = Math.min(0.95, baseProgress + segGrowth * tokenProgress)
        emit('generating', {
          progress,
          message: totalSegments > 1 ? `生成第 ${currentSegment}/${totalSegments} 段` : '流式生成中...',
          partialScript: accumulated,
          currentSegment,
          totalSegments,
          tokensUsed,
        })
      },
    }, systemPrompt)
  }

  const scenes: ScriptScene[] = parseScript(script)
  assertCompleteScript(scenes, videoInfo.durationSec)
  return {
    script,
    scenes,
    durationSec: videoInfo.durationSec,
    videoSizeBytes,
    tokensUsed,
    generatedInMs: Date.now() - startedAt,
  }
}

/** 所有供应商共用的最终机器契约：不得把无时间戳、倒序或越界剧本当作成功结果。 */
export function assertCompleteScript(scenes: ScriptScene[], durationSec: number): void {
  if (scenes.length === 0) {
    throw new Error('AI 返回的剧本缺少 [HH:MM:SS] 场景时间戳，未保存无效结果，请重试')
  }

  let previous = -1
  for (const scene of scenes) {
    if (scene.startSec < previous) {
      throw new Error('AI 返回的场景时间戳顺序错误，未保存无效结果，请重试')
    }
    if (Number.isFinite(durationSec) && durationSec > 0 && scene.startSec > durationSec + 2) {
      throw new Error('AI 返回的场景时间戳超出视频时长，未保存无效结果，请重试')
    }
    previous = scene.startSec
  }
}
