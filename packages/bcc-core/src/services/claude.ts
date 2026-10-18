/**
 * Anthropic (Claude) 官方 API —— 视频生成剧本服务
 *
 * Claude API 不接受视频输入（媒体只收图片/PDF），因此与 OpenAI (ChatGPT) 供应商同方案：
 * 「关键帧采样 + 多图 + 时间戳」——按固定间隔均匀抽帧，每帧前标注 [HH:MM:SS]，
 * 交给 Claude 多模态模型产出带时间戳的剧本。局限：没有音频理解，台词依赖画面字幕/口型推断。
 *
 * Fable 5（默认模型）的 API 约束（与 Opus 4.x 不同，写错直接 400）：
 * - 不传 temperature / top_p / top_k；
 * - 不传 thinking 参数（Fable 5 始终开启，显式 disabled 会 400；Opus 省略即关闭，同样安全）；
 * - 安全分类器可能返回 stop_reason: "refusal"——按官方建议默认挂 claude-opus-4-8 服务端兜底，
 *   拒答时同一请求内自动换模型续答（仅 Fable/Mythos 系列启用该 beta）。
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { AnthropicConfig, ConnectionTestResult } from '@shared/types'
import { buildScriptPrompt, SCRIPT_SYSTEM_PROMPT } from './prompt.js'
import { extractFrame } from './storyboard.js'
import { formatHMS, type VideoInfo } from './video.js'
import { createLogger, NOOP_LOGGER, type DebugLogger } from './logger.js'
import { scaleTimestamps, stripCodeFences } from './script-postprocess.js'
import type { GenerationCallbacks } from './openai-script.js'

export const ANTHROPIC_DEFAULT_MODEL = 'claude-fable-5'
/** 拒答兜底模型（Fable 5 官方推荐的 fallback 目标） */
const REFUSAL_FALLBACK_MODEL = 'claude-opus-4-8'
const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-06-01'

/** 关键帧采样上限 / 最小间隔：与 ChatGPT 供应商一致（多图 token 成本与时间覆盖率的折中） */
const MAX_FRAMES = 24
const MIN_INTERVAL_SEC = 2

/** 是否 Fable/Mythos 系列（决定拒答兜底 beta 是否启用） */
function isFableFamily(model: string): boolean {
  return model.startsWith('claude-fable') || model.startsWith('claude-mythos')
}

/**
 * Anthropic Messages API 强制要求 max_tokens，不能像其他供应商一样省略。
 * 这里传模型公开支持的最大输出值，不再施加项目自己的较小预算。
 * 未知/旧模型保留兼容值，避免传入超过其能力的数值导致整个请求被拒绝。
 */
export function getClaudeMaxOutputTokens(model: string): number {
  if (isFableFamily(model)) return 128_000
  if (/^claude-(?:opus|sonnet)-4-[678](?:-|$)/.test(model)) return 128_000
  return 64_000
}

/** MessageStream / BetaMessageStream 的公共最小面（两者结构一致，仅泛型不同导致联合不可调用） */
interface TextStreamLike {
  on(event: 'text', listener: (textDelta: string, textSnapshot: string) => void): unknown
  finalMessage(): Promise<{
    model: string
    stop_reason: string | null
    usage?: { input_tokens?: number | null; output_tokens?: number | null } | null
  }>
}

export function createAnthropicClient(cfg: Pick<AnthropicConfig, 'api_key' | 'base_url'>): Anthropic {
  return new Anthropic({
    apiKey: cfg.api_key,
    baseURL: cfg.base_url?.trim() || undefined,
    // 主进程/CLI 环境无浏览器同源限制；SDK 默认重试 2 次已合适
  })
}

export class ClaudeService {
  private client: Anthropic
  private log: DebugLogger = NOOP_LOGGER

  constructor(private cfg: AnthropicConfig) {
    if (!cfg.api_key) {
      throw new Error('Anthropic API Key 未配置，请到设置页填写')
    }
    this.client = createAnthropicClient(cfg)
  }

  /** 生成剧本：均匀抽帧 → 多图+时间戳流式生成 → 去围栏 + 等比缩放时间戳 */
  async generateScript(
    videoPath: string,
    videoInfo: VideoInfo,
    callbacks: GenerationCallbacks = {},
    systemPrompt?: string
  ): Promise<string> {
    const { signal } = callbacks
    const model = this.cfg.model?.trim() || ANTHROPIC_DEFAULT_MODEL

    this.log = createLogger('claude-script', String(Date.now()))
    this.log.info(
      `=== Claude 生成剧本 === model=${model} ` +
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

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-claude-frames-'))
    try {
      // 2. 抽帧 + base64 编码，与时间戳标注交错组装
      const userPrompt = buildScriptPrompt({ durationSec: videoInfo.durationSec })
      const parts: Anthropic.ContentBlockParam[] = [
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
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
        })
        callbacks.onUploadProgress?.((i + 1) / times.length)
      }
      this.throwIfAborted(signal)
      this.log.info(`帧编码完成: ${times.length} 帧`)

      // 3. 流式生成（不传 temperature / thinking；Fable 系列挂 opus-4-8 拒答兜底）
      callbacks.onStatus?.('generating', '开始生成剧本...')
      const raw = await this.streamMessages(model, systemPrompt || SCRIPT_SYSTEM_PROMPT, parts, callbacks)

      // 4. 清洗 + 时间戳等比缩放（Claude 无 <think> 文本，围栏剥除幂等无害）
      let script = stripCodeFences(raw)
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

  /** 流式调用 Messages API，透传 onToken；返回全文 */
  private async streamMessages(
    model: string,
    systemPrompt: string,
    parts: Anthropic.ContentBlockParam[],
    cb: GenerationCallbacks
  ): Promise<string> {
    const { signal } = cb
    const maxTokens = getClaudeMaxOutputTokens(model)
    this.log.info(`对话请求: model=${model} 帧数=${(parts.length - 1) / 2} max_tokens=${maxTokens} (model maximum)`)

    // Fable/Mythos：安全分类器拒答时由服务端在同一请求内换 opus-4-8 续答（官方推荐默认开启）。
    // 非 beta / beta 两条路径的流对象是不同类型，收敛到最小结构接口统一消费。
    const stream: TextStreamLike = isFableFamily(model)
      ? this.client.beta.messages.stream(
          {
            model,
            max_tokens: maxTokens,
            output_config: { effort: 'medium' },
            system: systemPrompt,
            messages: [{ role: 'user', content: parts }],
            betas: [SERVER_SIDE_FALLBACK_BETA],
            fallbacks: [{ model: REFUSAL_FALLBACK_MODEL }],
          },
          { signal }
        )
      : this.client.messages.stream(
          {
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: parts }],
          },
          { signal }
        )

    let acc = ''
    stream.on('text', (delta: string) => {
      acc += delta
      cb.onToken?.(acc, delta)
    })

    const final = await stream.finalMessage()
    const tokensUsed = (final.usage?.input_tokens ?? 0) + (final.usage?.output_tokens ?? 0)
    if (tokensUsed > 0) cb.onToken?.(acc, '', tokensUsed)

    if (final.stop_reason === 'refusal') {
      // 兜底模型也拒答（或未启用兜底）：不返回残缺内容
      throw new Error('请求被 Claude 安全分类器拒绝（含兜底模型），请换用其他供应商或调整视频内容')
    }
    if (final.stop_reason === 'max_tokens') {
      throw new Error(`Claude 输出达到模型支持的 ${maxTokens} token 上限，剧本被截断，请重试或缩短视频`)
    }
    // 兜底切换审计：记录本次由哪个模型产出
    if (final.model && final.model !== model) {
      this.log.info(`拒答兜底生效: ${model} -> ${final.model}`)
      cb.onStatus?.('generating', `已由兜底模型 ${final.model} 续答`)
    }

    this.log.info(
      `流式完成: ${acc.length} 字 stop=${final.stop_reason} ` +
        `tokens=in:${final.usage?.input_tokens ?? '?'}/out:${final.usage?.output_tokens ?? '?'}`
    )
    return acc
  }

  /** 测试连通性（GET /v1/models） */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const models: string[] = []
      for await (const m of this.client.models.list()) {
        models.push(m.id)
        if (models.length >= 50) break
      }
      return { ok: true, message: `连接成功，发现 ${models.length} 个模型`, models }
    } catch (err: any) {
      return { ok: false, message: explainAnthropicError(err) }
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }
  }
}

/** 把 SDK 错误翻译成中文提示（认证/额度/网络分开说清楚） */
export function explainAnthropicError(err: any): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return '认证失败：API Key 无效或已吊销，请检查设置页的 Anthropic API Key'
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `权限不足：${err.message}（检查 Key 是否有该模型的访问权限）`
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `模型或端点不存在：${err.message}（检查模型名是否拼写正确，如 claude-fable-5）`
  }
  if (err instanceof Anthropic.RateLimitError) {
    return '触发限流（429），请稍后重试'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return `网络连接失败：${err.message}（检查网络或代理配置）`
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude API 错误 (${err.status}): ${err.message}`
  }
  return err?.message ?? String(err)
}
