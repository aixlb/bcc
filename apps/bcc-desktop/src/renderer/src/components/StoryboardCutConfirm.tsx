/**
 * 分镜切割工作台，三种形态：
 * 1. 切割前设置（不传 job）：选方式/参数，点「开始切割」或「切割并识别」启动作业；
 * 2. 切割进行中：参数锁定，实时看截图落位，可取消；
 * 3. 切割完成（awaiting_confirm）：展示当前所选方式的切割结果——各方式的结果按方式缓存
 *    （仅本次会话），切换方式直接展示对应结果；没切过则为空 + 「开始切割」。
 *    满意后手动点「开始识别」，或用「切割并识别」直通。
 *
 * 工具栏固定布局：左 [开始切割/重新切割][切割并识别] ←→ 右 [取消][开始识别]。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Scissors, Sparkles, X } from 'lucide-react'
import type { CutParams, SceneScoreData, StoryboardCapturedFrame } from '@shared/types'
import type { StoryboardJob } from '../lib/store'
import { api } from '../lib/api'
import { findActiveTimestampIndex } from '../lib/storyboard-timeline'
import { cn } from '../lib/utils'
import { FrameThumb } from './StoryboardJobPanel'
import { SceneScoreCurve } from './SceneScoreCurve'

const DEFAULT_PARAMS: CutParams = {
  method: 'smart',
  scene_threshold: 0.3,
  smart_hard_min: 5.5,
  smart_hard_ratio: 8,
  smart_min_gap: 0.3,
}

const METHOD_LABELS: Record<CutParams['method'], string> = {
  smart: '混合检测',
  scene: '帧差值检测',
}

interface Props {
  /** 运行中的生成作业；不传 = 「切割前设置」模式 */
  job?: StoryboardJob | null
  /** 设置模式的初始参数（来自全局配置） */
  defaults?: CutParams
  /** 设置模式：启动作业（direct=true 为「切割并识别」直通） */
  onStart?: (params: CutParams, direct: boolean) => void
  /** 设置模式：返回（不开始切割） */
  onCancelSetup?: () => void
  /** 点击切点截图时跳转视频到该时间播放 */
  onSeek?: (sec: number) => void
  /** 播放器当前时间；切割完成后驱动曲线播放头和当前分镜图 */
  currentTime?: number
  /** 视频真实时长；帧差曲线降级失败时仍用于提供可编辑切割时间轴 */
  durationSec?: number
  /** 设置模式：「分镜大师」选择下拉（父级持有状态）；大师在作业启动时生效 */
  masterSelect?: React.ReactNode
}

export function StoryboardCutConfirm({
  job,
  defaults,
  onStart,
  onCancelSetup,
  onSeek,
  currentTime,
  durationSec,
  masterSelect,
}: Props) {
  const setup = !job
  const awaiting = job?.status === 'awaiting_confirm'
  const cutting = !!job && !awaiting
  const editable = setup || awaiting
  const [params, setParams] = useState<CutParams>(job?.cutParams ?? defaults ?? DEFAULT_PARAMS)
  const [submitting, setSubmitting] = useState(false)

  // 一轮切割完成时，把参数回填为这轮实际使用的（含服务端钳制后的值）
  useEffect(() => {
    if (awaiting && job?.cutParams) setParams(job.cutParams)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting])

  // 状态切换（重切开始/确认生效）后解除按钮 loading
  useEffect(() => {
    setSubmitting(false)
  }, [job?.status])

  const decide = async (action: 'confirm' | 'recut' | 'recut_analyze') => {
    if (!job || !awaiting || submitting) return
    setSubmitting(true)
    try {
      const result = await api().confirmStoryboardCut(job.jobId, { action, params })
      if (!result.ok) throw new Error('切割确认已失效，请重试')
    } catch (e) {
      console.error('confirmStoryboardCut failed', e)
      setSubmitting(false)
    }
  }

  // 取消走作业级 cancel（中止 AbortController）：切割中、切割完成时都能随时取消
  const [cancelling, setCancelling] = useState(false)
  const handleCancel = async () => {
    if (cancelling) return
    if (setup) {
      onCancelSetup?.()
      return
    }
    setCancelling(true)
    try {
      await api().cancelStoryboard(job!.jobId)
    } catch (e) {
      console.error('cancelStoryboard failed', e)
    } finally {
      setCancelling(false)
    }
  }

  // 当前所选方式的已切结果（仅本次会话缓存）；切割中展示实时流
  const selectedResult = awaiting ? job?.cutResults?.[params.method] : undefined
  const hasResult = !!selectedResult && selectedResult.frames.length > 0
  const liveFrames = job ? [...job.capturedFrames].sort((a, b) => a.timestamp - b.timestamp) : []
  const frames: StoryboardCapturedFrame[] = cutting
    ? liveFrames
    : hasResult
      ? [...selectedResult!.frames].sort((a, b) => a.timestamp - b.timestamp)
      : []
  const series: SceneScoreData | undefined = cutting ? job?.sceneSeries : selectedResult?.sceneSeries
  const fallbackSeries =
    awaiting && hasResult && durationSec && durationSec > 0
      ? {
          threshold:
            params.method === 'scene'
              ? params.scene_threshold
              : params.smart_hard_min / 255,
          durationSec,
          points: [
            { t: 0, score: 0 },
            { t: durationSec, score: 0 },
          ],
        }
      : undefined
  const timelineSeries =
    series && series.points.length > 1 ? series : fallbackSeries
  const sceneSeriesUnavailable = !!timelineSeries && timelineSeries === fallbackSeries
  const activeFrameIndex = useMemo(
    () =>
      currentTime == null
        ? -1
        : findActiveTimestampIndex(
            frames.map((frame) => frame.timestamp),
            currentTime
          ),
    [frames, currentTime]
  )
  const activeFramePath = frames[activeFrameIndex]?.path
  const frameRefs = useRef(new Map<string, HTMLDivElement>())

  // timeupdate 每秒触发多次；只在真正跨进另一镜时滚动一次。
  useEffect(() => {
    if (!awaiting || !activeFramePath) return
    const id = requestAnimationFrame(() => {
      frameRefs.current.get(activeFramePath)?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      })
    })
    return () => cancelAnimationFrame(id)
  }, [awaiting, activeFramePath, params.method])

  const addPreviewCut = async (sec: number) => {
    if (!job || !awaiting || !hasResult) {
      return { ok: false, reason: '切割尚未完成' }
    }
    return api().addStoryboardPreviewCut(job.jobId, params.method, sec)
  }

  const busy = cutting || submitting
  const cutLabel = cutting || hasResult ? '重新切割' : '开始切割'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 状态条 */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-white/[0.05] px-4 py-2 text-xs',
          setup || awaiting ? 'bg-amber-500/[0.06] text-amber-200' : 'bg-white/[0.02] text-zinc-400'
        )}
      >
        {setup || awaiting ? (
          <Scissors className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {setup
            ? '选择切割方式与参数，点「开始切割」；「切割并识别」则一步到位'
            : awaiting
              ? hasResult
                ? `「${METHOD_LABELS[params.method]}」已切出 ${frames.length} 个分镜 — 曲线空白处右键可新增；满意后点「开始识别」`
                : `「${METHOD_LABELS[params.method]}」还没切割 — 点「开始切割」用该方式切一版`
              : job!.message || '切割中...'}
        </span>
        {cutting && liveFrames.length > 0 && (
          <span className="font-mono text-[10px] text-zinc-500">
            {liveFrames.length}
            {job!.totalShots ? ` / ${job!.totalShots}` : ''} 帧
          </span>
        )}
      </div>

      {/* 参数区 + 工具栏 */}
      <div className="shrink-0 space-y-2 border-b border-white/[0.05] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-zinc-500">切割方式</span>
          <div className="flex overflow-hidden rounded-md border border-white/[0.08]">
            {(['smart', 'scene'] as const).map((m) => (
              <button
                key={m}
                disabled={!editable || submitting}
                onClick={() => setParams((p) => ({ ...p, method: m }))}
                title={awaiting ? '切换查看该方式的切割结果（没切过则为空）' : undefined}
                className={cn(
                  'px-2.5 py-1 text-[11px] transition-colors',
                  params.method === m
                    ? 'bg-accent/20 text-accent'
                    : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300',
                  (!editable || submitting) && 'cursor-not-allowed opacity-60'
                )}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>

          {params.method === 'scene' ? (
            <ParamInput
              label="阈值"
              hint="每帧差异值 > 阈值即切点（0.01~1）"
              value={params.scene_threshold}
              min={0.01}
              max={1}
              step={0.01}
              disabled={!editable || submitting}
              onChange={(v) => setParams((p) => ({ ...p, scene_threshold: v }))}
            />
          ) : (
            <>
              <ParamInput
                label="硬切帧差"
                hint="硬切最低帧差，调低更敏感（默认 5.5）"
                value={params.smart_hard_min}
                min={1}
                max={50}
                step={0.5}
                disabled={!editable || submitting}
                onChange={(v) => setParams((p) => ({ ...p, smart_hard_min: v }))}
              />
              <ParamInput
                label="相对倍率"
                hint="× 局部中位数，排除运镜误报（默认 8）"
                value={params.smart_hard_ratio}
                min={2}
                max={50}
                step={0.5}
                disabled={!editable || submitting}
                onChange={(v) => setParams((p) => ({ ...p, smart_hard_ratio: v }))}
              />
              <ParamInput
                label="最小间隔"
                hint="切点最小间隔秒（默认 0.3；0.1~0.15 可拆动画连环快切）"
                value={params.smart_min_gap}
                min={0.1}
                max={10}
                step={0.1}
                disabled={!editable || submitting}
                onChange={(v) => setParams((p) => ({ ...p, smart_min_gap: v }))}
              />
            </>
          )}
        </div>

        {/* 工具栏：左 [开始/重新切割][切割并识别] ←→ 右 [取消][开始识别] */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => (setup ? onStart?.(params, false) : void decide('recut'))}
            disabled={busy}
            className="btn-ghost flex items-center gap-1.5 !px-3 !py-1.5 text-xs disabled:opacity-50"
          >
            {cutting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
            {cutLabel}
          </button>
          <button
            onClick={() => (setup ? onStart?.(params, true) : void decide('recut_analyze'))}
            disabled={busy}
            title="用当前方式与参数切割，切完直接开始 AI 识别，不再停下确认"
            className="btn-ghost flex items-center gap-1.5 !px-3 !py-1.5 text-xs disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            切割并识别
          </button>

          <div className="ml-auto flex items-center gap-2">
            {setup && masterSelect}
            <button
              onClick={handleCancel}
              disabled={cancelling || submitting}
              title={setup ? '返回，不开始切割' : '取消本次分镜生成'}
              className="btn-danger flex items-center gap-1.5 !px-4 !py-1.5 text-sm font-medium text-red-100 disabled:opacity-50"
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              取消
            </button>
            <button
              onClick={() => void decide('confirm')}
              disabled={!awaiting || !hasResult || submitting}
              title={
                hasResult
                  ? `对「${METHOD_LABELS[params.method]}」的切割结果开始 AI 识别`
                  : '先切割，切完才能开始识别'
              }
              className="btn-primary flex items-center gap-1.5 !px-3 !py-1.5 text-xs disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              开始识别
            </button>
          </div>
        </div>
      </div>

      {/* 差异曲线（切点落位参考） */}
      {timelineSeries && (
        <div className="shrink-0 border-b border-white/[0.05] px-4 pb-2 pt-1">
          <SceneScoreCurve
            data={timelineSeries}
            duration={
              timelineSeries.durationSec ||
              timelineSeries.points[timelineSeries.points.length - 1].t
            }
            currentTime={currentTime}
            canEditShots={awaiting && hasResult && !submitting}
            onAddShot={addPreviewCut}
            onSeek={onSeek}
            cuts={frames.map((f) => f.timestamp)}
            label={
              sceneSeriesUnavailable
                ? '切割时间轴 · 帧差异值暂不可用'
                : undefined
            }
          />
        </div>
      )}

      {/* 截图网格 */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {setup ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            开始切割后，这里会实时展示每个切点的截图与差异曲线
          </div>
        ) : cutting && frames.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            {job!.status === 'detecting' ? '正在分析镜头切换点...' : '等待截图...'}
          </div>
        ) : !cutting && !hasResult ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            「{METHOD_LABELS[params.method]}」还没有切割结果 — 点左上「开始切割」
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 xl:grid-cols-4">
            {frames.map((frame, index) => {
              const active = index === activeFrameIndex
              return (
                <div
                  key={`${frame.timestamp}-${frame.path}`}
                  ref={(node) => {
                    if (node) frameRefs.current.set(frame.path, node)
                    else frameRefs.current.delete(frame.path)
                  }}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'rounded-md transition-shadow',
                    active && 'ring-2 ring-amber-300/80 ring-offset-1 ring-offset-ink-950'
                  )}
                >
                  <FrameThumb
                    frame={frame}
                    onClick={onSeek ? () => onSeek(frame.timestamp) : undefined}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ParamInput({
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500" title={hint}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)))
        }}
        className="w-16 rounded-md border border-white/[0.08] bg-black/30 px-1.5 py-0.5 text-center font-mono text-[11px] text-zinc-300 outline-none focus:border-accent/50 disabled:opacity-50"
      />
    </label>
  )
}
