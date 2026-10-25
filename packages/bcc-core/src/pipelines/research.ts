/**
 * 风格研究管线（framework-agnostic 纯入口）。
 *
 * 从原 research-manager 的 runJob 抽出。两阶段：
 *   Phase A: 对每个子视频并行 runStoryboardOnce（检测→截帧→分析），逐 sub 持久化分镜
 *   Phase B: 成功 sub 的分镜 md + 关键帧拼图丢给 synthesizer 流式合成《风格指南》
 *
 * 与剧本/分镜管线不同：研究是状态化的（边跑边写 sub meta / storyboard.md / 拼图，
 * 再读回参与合成），故 researchId 指向的项目须已存在于 storage。
 * 不推送 IPC、不认 jobId；进度走 onProgress，成功返回 { styleGuide, meta }，失败/取消抛错。
 */
import path from 'node:path'
import { DEFAULT_MODELS } from '@shared/model-presets'
import fs from 'node:fs/promises'
import type {
  AppConfig,
  ResearchMeta,
  ResearchProgressEvent,
  ResearchSubVideo,
  StoryboardProject,
} from '@shared/types'
import { getConfig } from '../services/config.js'
import { runStoryboardOnce } from '../services/storyboard-manager.js'
import type { AnalyzerConfig } from '../services/storyboard-analyzer.js'
import { serializeStoryboardMd, loadStoryboardProject } from '../services/storyboard-storage.js'
import { createSynthesizer, type Synthesizer } from '../services/synthesizer.js'
import { RESEARCH_DEFAULT_PROMPT } from '../services/research-prompt.js'
import { buildFrameMosaic } from '../services/research-mosaic.js'
import {
  getSubDir,
  getSubFramesDir,
  getSubThumbnailPath,
  loadResearch,
  markHasStyleGuide,
  writeStyleGuide,
  writeSubMeta,
  writeSubVideoStoryboard,
} from '../services/research-storage.js'

/** 进度事件（剔除 GUI 专属 jobId，由调用方补齐） */
export type ResearchProgress = Omit<ResearchProgressEvent, 'jobId'>

export interface RunResearchOptions {
  researchId: string
  config?: AppConfig
  signal?: AbortSignal
  onProgress?: (ev: ResearchProgress) => void
  log?: (msg: string) => void
}

export interface ResearchRunResult {
  styleGuide: string
  meta: ResearchMeta
}

export async function runResearch(opts: RunResearchOptions): Promise<ResearchRunResult> {
  const { researchId, signal, onProgress } = opts
  const cfg = opts.config ?? getConfig()
  const log = opts.log ?? ((msg: string) => console.log(`[Research] ${msg}`))

  const emit = (payload: Partial<ResearchProgress>) => {
    onProgress?.({
      status: payload.status ?? 'preparing',
      progress: payload.progress ?? 0,
      message: payload.message ?? '',
      currentSub: payload.currentSub,
      totalSubs: payload.totalSubs ?? 0,
      partialStyleGuide: payload.partialStyleGuide,
      subVideoPath: payload.subVideoPath,
      subStatus: payload.subStatus,
      subProgress: payload.subProgress,
    })
  }

  const distCfg = cfg.research
  const sbCfg = cfg.storyboard

  // 读取 meta：需要知道有哪些视频
  const loaded = await loadResearch(researchId)
  if (!loaded) throw new Error('研究项目不存在')
  const totalSubs = loaded.meta.videoPaths.length
  if (totalSubs === 0) throw new Error('没有任何源视频')

  // 视频级并发
  const videoConcurrency = Math.max(1, Math.min(4, distCfg.video_concurrency ?? 2))
  const prompt = sbCfg.prompt?.trim() || ''
  const threshold = sbCfg.scene_threshold ?? 0.3
  const maxShots = sbCfg.max_shots ?? 200
  const subConcurrency = Math.max(1, Math.min(10, sbCfg.concurrency ?? 3))
  const mosaicFrames = Math.max(1, Math.min(12, distCfg.mosaic_frames_per_video ?? 6))

  log(
    `配置: videoConcurrency=${videoConcurrency} subConcurrency=${subConcurrency} ` +
      `threshold=${threshold} maxShots=${maxShots} mosaicFrames=${mosaicFrames}`
  )

  emit({ status: 'preparing', progress: 0.02, message: '准备中...', totalSubs })

  // ============ Phase A：并行跑分镜 ============
  const subs: ResearchSubVideo[] = loaded.meta.videoPaths.map((vp) => ({
    videoPath: vp,
    videoName: path.basename(vp),
    status: 'pending' as const,
    progress: 0,
    message: '等待开始',
    shots: 0,
  }))

  let completed = 0
  let failed = 0
  let successCount = 0
  const subProgressArr = new Array<number>(totalSubs).fill(0)
  const totalPhaseAWeight = 0.7 // phase A 占总进度 0..0.7

  for (let batchStart = 0; batchStart < totalSubs; batchStart += videoConcurrency) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const batch = subs.slice(batchStart, batchStart + videoConcurrency)

    await Promise.all(
      batch.map(async (sub) => {
        const subIndex = subs.indexOf(sub) + 1
        const logPrefix = `sub${subIndex}[${sub.videoName}]`
        log(`${logPrefix} 开始`)

        sub.status = 'detecting'
        sub.message = '检查文件...'
        sub.progress = 0
        await writeSubMeta(researchId, subIndex, sub.videoPath, sub)
        emit({
          status: 'analyzing_subs',
          currentSub: subIndex,
          subVideoPath: sub.videoPath,
          subStatus: 'detecting',
          subProgress: 0,
          message: `${sub.videoName}: 准备中`,
        })

        try {
          try {
            await fs.access(sub.videoPath)
          } catch {
            throw new Error('视频文件不存在')
          }

          const framesDir = getSubFramesDir(researchId, subIndex, sub.videoPath)
          const startedAt = Date.now()

          const { shots, framePaths } = await runStoryboardOnce({
            videoPath: sub.videoPath,
            framesDir,
            prompt: prompt || undefined,
            threshold,
            maxShots,
            concurrency: subConcurrency,
            signal,
            log: (m) => log(`${logPrefix} ${m}`),
            onProgress: (ev) => {
              let subP = 0
              if (ev.phase === 'detecting') subP = 0.05
              else if (ev.phase === 'capturing') subP = 0.05 + (0.30 * (ev.current ?? 0)) / Math.max(1, ev.total ?? 1)
              else if (ev.phase === 'analyzing') subP = 0.35 + (0.55 * (ev.current ?? 0)) / Math.max(1, ev.total ?? 1)
              else if (ev.phase === 'saving') subP = 0.95

              sub.progress = subP
              sub.message = ev.message
              if (ev.phase === 'detecting') sub.status = 'detecting'
              else if (ev.phase === 'analyzing' || ev.phase === 'capturing') sub.status = 'analyzing'

              subProgressArr[subIndex - 1] = subP
              const overall = totalPhaseAWeight * (subProgressArr.reduce((s, p) => s + p, 0) / totalSubs)

              emit({
                status: 'analyzing_subs',
                progress: overall,
                message: `${sub.videoName}: ${ev.message}`,
                currentSub: subIndex,
                subVideoPath: sub.videoPath,
                subStatus: sub.status,
                subProgress: subP,
              })
            },
          })

          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

          // 写入 storyboard.md
          const sbProject: StoryboardProject = {
            id: `${researchId}#${subIndex}`,
            videoPath: sub.videoPath,
            createdAt: Date.now(),
            shots,
            framePaths,
          }
          const { storyboardPath } = await writeSubVideoStoryboard(researchId, subIndex, sub.videoPath, sbProject)
          sub.storyboardPath = storyboardPath
          sub.shots = shots.length
          sub.status = 'completed'
          sub.progress = 1
          sub.message = `完成 · ${shots.length} 镜 · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
          delete sub.errorMessage
          await writeSubMeta(researchId, subIndex, sub.videoPath, sub)
          completed++
          successCount++
          subProgressArr[subIndex - 1] = 1

          const overall = totalPhaseAWeight * (subProgressArr.reduce((s, p) => s + p, 0) / totalSubs)
          emit({
            status: 'analyzing_subs',
            progress: overall,
            message: `${sub.videoName}: 完成 (${shots.length} 镜)`,
            currentSub: subIndex,
            subVideoPath: sub.videoPath,
            subStatus: 'completed',
            subProgress: 1,
          })

          log(`${logPrefix} 完成 · ${shots.length} 镜`)
        } catch (err: any) {
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
          const msg = err?.message ?? String(err)
          log(`${logPrefix} 失败: ${msg}`)
          sub.status = 'failed'
          sub.errorMessage = msg
          sub.message = msg
          sub.progress = 0
          await writeSubMeta(researchId, subIndex, sub.videoPath, sub)
          failed++
          subProgressArr[subIndex - 1] = 0

          const overall = totalPhaseAWeight * (subProgressArr.reduce((s, p) => s + p, 0) / totalSubs)
          emit({
            status: 'analyzing_subs',
            progress: overall,
            message: `${sub.videoName}: 失败 — ${msg}`,
            currentSub: subIndex,
            subVideoPath: sub.videoPath,
            subStatus: 'failed',
            subProgress: 0,
          })
        }
      })
    )
  }

  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  if (successCount === 0) {
    throw new Error('所有源视频都处理失败，无法生成风格指南')
  }

  // ============ Phase A 收尾：拼图 ============
  log(`phase A 完成：${successCount} 成功 / ${failed} 失败`)
  emit({ status: 'building_mosaics', progress: 0.72, message: '构建关键帧拼图...', totalSubs })

  const thumbnails: string[] = []
  const successfulSubs = subs
    .map((s, idx) => ({ sub: s, subIndex: idx + 1 }))
    .filter(({ sub }) => sub.status === 'completed')

  for (let i = 0; i < successfulSubs.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const { sub, subIndex } = successfulSubs[i]

    if (!sub.storyboardPath) {
      log(`sub${subIndex} 缺 storyboardPath，跳过拼图`)
      continue
    }

    const subDir = getSubDir(researchId, subIndex, sub.videoPath)
    const sb = await loadStoryboardProject(subDir)
    if (!sb || sb.framePaths.length === 0) {
      log(`sub${subIndex} 无帧，跳过拼图`)
      continue
    }

    const sorted = sb.shots
      .map((s, idx) => ({ idx, score: s.sceneScore }))
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .slice(0, mosaicFrames)
      .map((x) => sb.framePaths[x.idx])
      .filter((p): p is string => !!p)

    if (sorted.length === 0) {
      log(`sub${subIndex} 帧路径为空，跳过`)
      continue
    }

    const outPath = getSubThumbnailPath(researchId, subIndex, sub.videoPath)
    try {
      await buildFrameMosaic(sorted, outPath, 4)
      sub.thumbnailPath = outPath
      await writeSubMeta(researchId, subIndex, sub.videoPath, sub)
      thumbnails.push(outPath)
      log(`sub${subIndex} 拼图完成 (${sorted.length} 帧)`)
      emit({
        status: 'building_mosaics',
        progress: 0.72 + 0.13 * ((i + 1) / successfulSubs.length),
        message: `拼图 ${i + 1}/${successfulSubs.length}: ${sub.videoName}`,
        currentSub: subIndex,
        subVideoPath: sub.videoPath,
        subStatus: 'completed',
      })
    } catch (err: any) {
      log(`sub${subIndex} 拼图失败: ${err?.message ?? err}（不影响合成）`)
    }
  }

  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  // ============ Phase B：合成 ============
  log(`开始合成：${thumbnails.length} 张拼图`)
  emit({ status: 'synthesizing', progress: 0.85, message: 'AI 提炼风格...', totalSubs })

  const synthCfg = resolveSynthesizerConfig(cfg)
  const synth: Synthesizer = createSynthesizer(synthCfg)

  const userText = await buildSynthesisUserText(researchId, subs, failed)
  const systemPrompt = distCfg.synthesis_prompt?.trim() || RESEARCH_DEFAULT_PROMPT

  let partial = ''
  partial = await synth.synthesize({
    systemPrompt,
    userText,
    images: thumbnails,
    signal,
    onChunk: (_delta, acc) => {
      partial = acc
      emit({
        status: 'synthesizing',
        progress: 0.85 + 0.13 * Math.min(1, acc.length / 4000),
        message: 'AI 提炼中...',
        partialStyleGuide: acc,
      })
    },
  })

  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  if (!partial.trim()) {
    throw new Error('AI 返回了空的风格指南内容，请检查 API 配置或稍后重试')
  }

  // ============ 完成：原子写 style-guide.md ============
  const finalContent =
    partial +
    (failed > 0
      ? `\n\n---\n\n> 注：本次研究共 ${totalSubs} 条源视频，其中 ${successCount} 段分镜参与分析，另有 ${failed} 段处理失败已跳过。\n`
      : '')

  await writeStyleGuide(researchId, finalContent)
  const updatedMeta = await markHasStyleGuide(researchId)
  log(`风格指南已写入 (${finalContent.length} 字符)`)

  emit({ status: 'completed', progress: 1, message: '完成', partialStyleGuide: finalContent })

  return { styleGuide: finalContent, meta: updatedMeta }
}

export function resolveSynthesizerConfig(cfg: AppConfig): AnalyzerConfig {
  const p = cfg.research.synthesis_provider ?? cfg.storyboard_provider ?? 'gemini'
  if (p === 'gemini') {
    if (!cfg.gemini.api_key) throw new Error('Gemini API Key 未配置')
    return { provider: 'gemini', apiKey: cfg.gemini.api_key, baseUrl: '', model: cfg.gemini.model || DEFAULT_MODELS.gemini }
  }
  if (p === 'kimi') {
    if (!cfg.kimi.api_key) throw new Error('Kimi API Key 未配置')
    return { provider: 'openai', apiKey: cfg.kimi.api_key, baseUrl: cfg.kimi.base_url || 'https://api.moonshot.cn/v1', model: cfg.kimi.model || DEFAULT_MODELS.kimi }
  }
  if (p === 'minimax') {
    if (!cfg.minimax.api_key) throw new Error('MiniMax API Key 未配置')
    return { provider: 'openai', apiKey: cfg.minimax.api_key, baseUrl: cfg.minimax.base_url || 'https://api.minimaxi.com/v1', model: cfg.minimax.model || DEFAULT_MODELS.minimax }
  }
  if (p === 'openai') {
    if (!cfg.openai?.api_key) throw new Error('OpenAI API Key 未配置')
    return { provider: 'openai', apiKey: cfg.openai.api_key, baseUrl: cfg.openai.base_url?.trim() || 'https://api.openai.com/v1', model: cfg.openai.model?.trim() || DEFAULT_MODELS.openai }
  }
  if (p === 'anthropic') {
    if (!cfg.anthropic?.api_key) throw new Error('Anthropic API Key 未配置')
    return { provider: 'anthropic', apiKey: cfg.anthropic.api_key, baseUrl: cfg.anthropic.base_url?.trim() || '', model: cfg.anthropic.model?.trim() || DEFAULT_MODELS.anthropic }
  }
  const custom = cfg.custom_providers?.find((x) => x.id === p)
  if (!custom) throw new Error(`未知供应商: ${p}`)
  if (!custom.api_key) throw new Error(`${custom.name} API Key 未配置`)
  return { provider: 'openai', apiKey: custom.api_key, baseUrl: custom.base_url, model: custom.model }
}

async function buildSynthesisUserText(
  researchId: string,
  subs: ResearchSubVideo[],
  failedCount: number
): Promise<string> {
  const parts: string[] = []
  parts.push(
    `下面提供 ${subs.length} 条源视频的分镜表（其中 ${failedCount} 条处理失败已跳过），请基于这些素材提炼风格指南。\n`
  )

  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i]
    const subIndex = i + 1
    if (sub.status !== 'completed' || !sub.storyboardPath) continue
    const subDir = getSubDir(researchId, subIndex, sub.videoPath)
    const sb = await loadStoryboardProject(subDir)
    if (!sb) continue

    parts.push(`\n---\n\n## 源视频 ${subIndex} — ${sub.videoName}\n\n`)
    parts.push(serializeStoryboardMd(sb))
  }

  return parts.join('')
}
