/**
 * OpenAI (ChatGPT) 官方 GPT API —— 视频生成剧本服务
 *
 * OpenAI 的 chat/completions 不接受视频输入（无 video_url / 视频文件上传），
 * 因此走「关键帧采样 + 多图 + 时间戳」：按固定间隔均匀抽帧，每帧前标注 [HH:MM:SS]，
 * 交给 GPT 多模态模型产出带时间戳的剧本。局限：没有音频理解，台词依赖画面字幕/口型推断。
 *
 * 与自定义供应商（openai-script 的 base64 内联视频）互补：官方 OpenAI 端点只能走本服务。
 * 参数注意：不传 temperature，也不设置应用级输出 token 上限，由模型按服务端能力生成。
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ConnectionTestResult, OpenAIConfig } from '@shared/types'
import { buildScriptPrompt, SCRIPT_SYSTEM_PROMPT } from './prompt.js'
import { extractFrame } from './storyboard.js'
import { formatHMS, type VideoInfo } from './video.js'
import { createLogger, NOOP_LOGGER, type DebugLogger } from './logger.js'
import { scaleTimestamps, stripCodeFences, stripThinkComplete } from './script-postprocess.js'
import { testAnalyzerConnection } from './storyboard-analyzer.js'
import {
  streamOpenAIChatCompletion,
  type GenerationCallbacks,
} from './openai-script.js'

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const OPENAI_DEFAULT_MODEL = 'gpt-5.6'

/** 关键帧采样上限 / 最小间隔：多图 token 成本与时间覆盖率的折中 */
const MAX_FRAMES = 24
const MIN_INTERVAL_SEC = 2

export class ChatGPTService {
  private baseUrl: string
  private log: DebugLogger = NOOP_LOGGER

  constructor(private cfg: OpenAIConfig) {
    if (!cfg.api_key) {
      throw new Error('OpenAI API Key 未配置，请到设置页填写')
    }
    this.baseUrl = (cfg.base_url?.trim() || OPENAI_DEFAULT_BASE_URL).replace(/\/$/, '')
  }

  /** 生成剧本：均匀抽帧 → 多图+时间戳流式生成 → 去围栏 + 等比缩放时间戳 */
  async generateScript(
    videoPath: string,
    videoInfo: VideoInfo,
    callbacks: GenerationCallbacks = {},
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = callbacks
    const model = this.cfg.model?.trim() || OPENAI_DEFAULT_MODEL

    this.log = createLogger('chatgpt-script', String(Date.now()))
    this.log.info(
      `=== OpenAI 生成剧本 === model=${model} baseUrl=${this.baseUrl} ` +
        `video=${path.basename(videoPath)} dur=${videoInfo.durationSec.toFixed(0)}s`
    )
    if (this.log.filePath) callbacks.onStatus?.('preparing', `诊断日志: ${this.log.filePath}`)

    // 1. 均匀采样时间点（取每段中点，覆盖全片）
    const duration = Math.max(1, videoInfo.durationSec)
    const interval = Math.max(MIN_INTERVAL_SEC, duration / MAX_FRAMES)
    const times: number[] = []
    for (let t = interval / 2; t < duration; t += interval) {
      times.push(Math.min(t, Math.max(0, duration - 0.1)))
    }
    if (times.length === 0) times.push(0)
    callbacks.onStatus?.('preparing', `按 ${interval.toFixed(1)}s 间隔抽取 ${times.length} 帧关键帧...`)
    this.log.info(`抽帧计划: ${times.length} 帧, 间隔 ${interval.toFixed(2)}s`)

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-gpt-frames-'))
    try {
      // 2. 抽帧 + base64 编码，与时间戳标注交错组装
      const userPrompt = buildScriptPrompt({ durationSec: videoInfo.durationSec })
      const parts: unknown[] = [
        {
          type: 'text',
          text:
            `${userPrompt}\n\n` +
            `【输入说明】以下是从视频按时间顺序均匀抽取的 ${times.length} 张关键帧，` +
            `每张图片前标注了它在视频中的时间戳。请结合相邻帧的差异推断场景切换与叙事节奏；` +
            `剧本中的时间戳必须落在 00:00:00 ~ ${formatHMS(videoInfo.durationSec)} 范围内。` +
            `画面中出现的字幕文字是台词的直接依据。`,
        },
      ]
      callbacks.onStatus?.('uploading', `抽取并编码 ${times.length} 帧...`)
      for (let i = 0; i < times.length; i++) {
        this.throwIfAborted(signal)
        const framePath = await extractFrame(videoPath, times[i], tmpDir)
        const b64 = (await fs.readFile(framePath)).toString('base64')
        parts.push({ type: 'text', text: `帧 ${i + 1}/${times.length} · [${formatHMS(times[i])}]` })
        parts.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' },
        })
        callbacks.onUploadProgress?.((i + 1) / times.length)
      }
      this.throwIfAborted(signal)
      this.log.info(`帧编码完成: ${times.length} 帧`)

      // 3. 流式生成（不传 temperature / token 上限）
      callbacks.onStatus?.('generating', '开始生成剧本...')
      const raw = await streamOpenAIChatCompletion(
        { name: 'OpenAI', apiKey: this.cfg.api_key, baseUrl: this.baseUrl, model },
        [
          { role: 'system', content: systemPrompt || SCRIPT_SYSTEM_PROMPT },
          { role: 'user', content: parts },
        ],
        {
          // 剧本提取是明确的结构化任务，low 足够并能把更多输出空间留给正文。
          extraBody: /^gpt-5(?:\.|$)/.test(model) ? { reasoning_effort: 'low' } : undefined,
          log: this.log,
        },
        callbacks
      )

      // 4. 清洗 + 时间戳等比缩放（GPT 无 <think>，stripThinkComplete 幂等无害）
      let script = stripCodeFences(stripThinkComplete(raw))
      if (!script.trim()) {
        throw new Error('生成被中断：模型未产出有效剧本，请重试')
      }
      const scaled = scaleTimestamps(script, videoInfo.durationSec)
      if (scaled.changed) {
        this.log.info(
          `时间戳等比缩放: 最大 ${scaled.maxBeforeSec.toFixed(0)}s -> 时长 ${videoInfo.durationSec.toFixed(0)}s ` +
            `(factor=${scaled.factor.toFixed(3)}, 共 ${scaled.count} 个)`
        )
      }
      script = scaled.text

      this.log.info(`完成: 原始 ${raw.length} 字 -> 清洗后 ${script.length} 字`)
      this.log.info(`=== 生成结果全文 ===\n${script}\n=== 全文结束 ===`)
      return script
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (!signal?.aborted) {
        this.log.error(`失败: ${msg}`)
        if (this.log.filePath) err.message = `${msg}\n（诊断日志: ${this.log.filePath}）`
      }
      throw err
    } finally {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** 测试连通性（GET /models） */
  async testConnection(): Promise<ConnectionTestResult> {
    return await testAnalyzerConnection({ apiKey: this.cfg.api_key, baseUrl: this.baseUrl })
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }
  }
}
