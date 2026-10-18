import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Film,
  Camera,
  Brain,
  FileSpreadsheet,
  PauseCircle,
} from 'lucide-react'
import type { StoryboardCapturedFrame, StoryboardProgressEvent, StoryboardProject } from '@shared/types'
import type { StoryboardJob } from '../lib/store'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { SceneScoreCurve } from './SceneScoreCurve'

const STATUS_LABELS: Record<StoryboardProgressEvent['status'], string> = {
  detecting: '镜头检测',
  capturing: '截图采样',
  awaiting_confirm: '等待确认切割',
  analyzing: '画面分析',
  generating: '生成分镜表',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
}

const STATUS_ORDER: StoryboardProgressEvent['status'][] = [
  'detecting',
  'capturing',
  'awaiting_confirm',
  'analyzing',
  'generating',
  'completed',
]

const STATUS_ICONS: Record<string, React.ReactNode> = {
  detecting: <Film className="h-3.5 w-3.5" />,
  capturing: <Camera className="h-3.5 w-3.5" />,
  awaiting_confirm: <PauseCircle className="h-3.5 w-3.5" />,
  analyzing: <Brain className="h-3.5 w-3.5" />,
  generating: <FileSpreadsheet className="h-3.5 w-3.5" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5" />,
}

/** 自动/人工起始点类型 → 中文角标与配色 */
export const CUT_KIND_BADGES: Record<string, { label: string; className: string }> = {
  hard: { label: '硬切', className: 'bg-red-500/70 text-white' },
  blank: { label: '白/黑场', className: 'bg-zinc-200/80 text-zinc-900' },
  front: { label: '锋面', className: 'bg-sky-500/70 text-white' },
  dissolve: { label: '叠化', className: 'bg-purple-500/70 text-white' },
  sample: { label: '补帧', className: 'bg-emerald-500/70 text-white' },
  manual: { label: '手动', className: 'bg-amber-400/80 text-amber-950' },
}

interface Props {
  job: StoryboardJob
  /** 已完成时显示流式分镜（来自项目内已存的 storyboardProject） */
  preview: StoryboardProject | null
}

export function StoryboardJobPanel({ job, preview }: Props) {
  const isFinished = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
  // 运行中只要采样出截图就优先展示截图供核对镜头切分；运行结束且有分析结果时再切回分镜流
  const hasPreview = !!preview && preview.shots.length > 0
  const showFrames = job.capturedFrames.length > 0 && (!hasPreview || !isFinished)

  return (
    <div className="grid h-full min-h-0 grid-cols-12 gap-3 px-4 py-3">
      <div className="col-span-5 flex min-h-0 flex-col gap-3">
        <Hero job={job} />
        {/* 重新识别只走「分析」一步，不展示完整生成流水线 */}
        {job.kind !== 'reanalyze' && <Timeline job={job} />}
        <Log job={job} />
        {!isFinished && (
          <div className="mt-auto flex shrink-0 justify-end">
            <button
              onClick={() => api().cancelStoryboard(job.jobId)}
              className="btn-danger flex items-center gap-1.5 text-xs"
            >
              <X className="h-3.5 w-3.5" />
              取消
            </button>
          </div>
        )}
      </div>

      <div className="col-span-7 flex min-h-0 flex-col overflow-hidden">
        <div className="glass-panel flex flex-1 flex-col overflow-hidden rounded-lg">
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-3 py-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-400">
              <span className={cn('pulse-dot', job.status === 'analyzing' ? 'text-accent' : 'text-zinc-600')} />
              {showFrames ? '截图采样核对' : '实时分镜流'}
            </div>
            {showFrames ? (
              <div className="font-mono text-[10px] text-zinc-500">
                已采样 {job.capturedFrames.length}
                {job.totalShots ? ` / ${job.totalShots}` : ''} 帧
              </div>
            ) : (
              job.totalShots && (
                <div className="font-mono text-[10px] text-zinc-500">
                  {job.currentShot ?? 0} / {job.totalShots} 镜
                </div>
              )
            )}
          </div>
          {showFrames && (
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.05] bg-amber-500/[0.04] px-3 py-1.5 text-[10.5px] text-amber-300/90">
              <Camera className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1 leading-relaxed">
                {job.status === 'awaiting_confirm' ? (
                  <>切割已完成，等待确认：请到右侧「分镜表」页核对切点，可调参重切或确认后开始 AI 识别。</>
                ) : (
                  <>
                    先核对镜头切分是否合理
                    {job.cutParams?.method === 'smart' ? (
                      <span className="ml-1 font-mono text-amber-200/80">（混合检测）</span>
                    ) : typeof job.threshold === 'number' ? (
                      <span className="ml-1 font-mono text-amber-200/80">（阈值 {job.threshold.toFixed(2)}）</span>
                    ) : null}
                    ：切得过碎调高、漏切调低。
                  </>
                )}
              </span>
            </div>
          )}
          {showFrames && job.sceneSeries && job.sceneSeries.points.length > 1 && (
            <div className="shrink-0 border-b border-white/[0.05] px-3 pb-2 pt-1">
              <SceneScoreCurve
                data={job.sceneSeries}
                duration={
                  job.sceneSeries.durationSec ||
                  job.sceneSeries.points[job.sceneSeries.points.length - 1].t
                }
                cuts={job.capturedFrames.map((f) => f.timestamp)}
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-2.5">
            {showFrames ? <FramesGrid frames={job.capturedFrames} /> : <ShotStream job={job} preview={preview} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function heroLabel(job: StoryboardJob): string {
  if (job.kind === 'reanalyze') {
    return job.status === 'completed'
      ? '重新识别完成'
      : job.status === 'failed'
        ? '重新识别失败'
        : job.status === 'cancelled'
          ? '重新识别已取消'
          : '重新识别中'
  }
  return STATUS_LABELS[job.status] ?? job.status
}

function Hero({ job }: { job: StoryboardJob }) {
  const pct = Math.max(0, Math.min(1, job.progress))
  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon status={job.status} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-zinc-100">{heroLabel(job)}</span>
              {job.providerLabel && (
                <span
                  className="truncate rounded-full border border-white/[0.07] bg-black/30 px-1.5 py-px font-mono text-[9px] text-zinc-400"
                  title={`本次使用 ${job.providerLabel}`}
                >
                  {job.providerLabel}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">{job.message || ' '}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-light tracking-tight text-zinc-100">
            {(pct * 100).toFixed(0)}
            <span className="text-xs text-zinc-500">%</span>
          </div>
          {job.totalShots && job.totalShots > 0 && (
            <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
              镜 {job.currentShot ?? 0} / {job.totalShots}
            </div>
          )}
        </div>
      </div>
      <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-white/[0.04]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gold-shimmer"
          style={{ backgroundSize: '200% 100%' }}
          animate={{
            width: `${pct * 100}%`,
            backgroundPosition: ['0% 0%', '200% 0%'],
          }}
          transition={{
            width: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
            backgroundPosition: { duration: 3, repeat: Infinity, ease: 'linear' },
          }}
        />
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: StoryboardProgressEvent['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 text-emerald-400" strokeWidth={1.5} />
  if (status === 'failed') return <AlertCircle className="h-5 w-5 text-red-400" strokeWidth={1.5} />
  if (status === 'cancelled') return <X className="h-5 w-5 text-zinc-500" strokeWidth={1.5} />
  if (status === 'awaiting_confirm') return <PauseCircle className="h-5 w-5 text-amber-300" strokeWidth={1.5} />
  return <Loader2 className="h-5 w-5 animate-spin text-accent" strokeWidth={1.5} />
}

function Timeline({ job }: { job: StoryboardJob }) {
  const currentIdx = STATUS_ORDER.indexOf(job.status)
  return (
    <div className="glass-panel rounded-lg px-3 py-2">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">处理流水</div>
      <div className="space-y-0.5">
        {STATUS_ORDER.slice(0, -1).map((s, idx) => {
          const isDone = currentIdx > idx || job.status === 'completed'
          const isCurrent = job.status === s
          return (
            <div key={s} className="flex items-center gap-2 py-0.5">
              <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                {isDone ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" strokeWidth={2} />
                ) : isCurrent ? (
                  <>
                    <div className="absolute inset-0 animate-ping rounded-full bg-accent/40" />
                    <div className="relative h-1.5 w-1.5 rounded-full bg-accent" />
                  </>
                ) : (
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                )}
              </div>
              <span
                className={cn(
                  'text-[12px] transition-colors',
                  isDone ? 'text-zinc-400' : isCurrent ? 'font-medium text-zinc-100' : 'text-zinc-600'
                )}
              >
                {STATUS_LABELS[s]}
              </span>
              <span className="ml-auto text-zinc-700">{STATUS_ICONS[s]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Log({ job }: { job: StoryboardJob }) {
  if (!job.log.length) return null
  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col rounded-lg">
      <div className="border-b border-white/[0.05] px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        日志
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        <div className="space-y-0.5 font-mono text-[10.5px] text-zinc-500">
          <AnimatePresence>
            {job.log.slice(-12).map((entry, i) => (
              <motion.div
                key={entry.ts + '-' + i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="truncate"
              >
                <span className="text-zinc-700">
                  {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>{' '}
                {entry.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function FramesGrid({ frames }: { frames: StoryboardCapturedFrame[] }) {
  // 按镜头序号升序展示，保证采样乱序到达时顺序稳定
  const ordered = [...frames].sort((a, b) => a.index - b.index)
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
      {ordered.map((frame) => (
        <FrameThumb key={frame.index} frame={frame} />
      ))}
    </div>
  )
}

export function FrameThumb({
  frame,
  onClick,
}: {
  frame: StoryboardCapturedFrame
  /** 提供时缩略图可点击（如切割工作台里点击跳转视频到该切点播放） */
  onClick?: () => void
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!frame.path) {
      setImgError(true)
      return
    }
    let cancelled = false
    const mediaUrl = api().getMediaUrl(frame.path)

    fetch(mediaUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl
        setImgSrc(objectUrl)
      })
      .catch(() => {
        if (cancelled) return
        setImgError(true)
      })

    return () => {
      cancelled = true
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [frame.path])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      onClick={onClick}
      title={onClick ? `跳转到 ${formatSec(frame.timestamp)} 播放` : undefined}
      className={cn(
        'overflow-hidden rounded-md border border-white/[0.06] bg-black/30',
        onClick && 'cursor-pointer transition-colors hover:border-accent/60'
      )}
    >
      <div className="relative aspect-video">
        {imgSrc && !imgError ? (
          <img src={imgSrc} alt={`镜${frame.index + 1}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
            {imgError ? '无图片' : '…'}
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 font-mono text-[9px] text-accent">
          #{String(frame.index + 1).padStart(3, '0')}
        </span>
        {frame.kind && CUT_KIND_BADGES[frame.kind] && (
          <span
            className={cn(
              'absolute right-1 top-1 rounded px-1 text-[8.5px] font-medium',
              CUT_KIND_BADGES[frame.kind].className
            )}
            title={`起始点类型：${CUT_KIND_BADGES[frame.kind].label}`}
          >
            {CUT_KIND_BADGES[frame.kind].label}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between px-1 py-0.5 font-mono text-[9px] text-zinc-500">
        <span>{formatSec(frame.timestamp)}</span>
        <span className="text-amber-400/90">差异 {frame.score.toFixed(3)}</span>
      </div>
    </motion.div>
  )
}

function formatSec(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function ShotStream({ job, preview }: { job: StoryboardJob; preview: StoryboardProject | null }) {
  if (!preview || preview.shots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
        {job.status === 'detecting' && '正在分析镜头切换点...'}
        {job.status === 'capturing' && '正在截取关键帧...'}
        {job.status === 'analyzing' && '正在分析画面...'}
        {job.status === 'generating' && '正在写入分镜表...'}
        {job.status === 'completed' && '分镜表已生成'}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {preview.shots.map((shot, i) => (
        <div
          key={i}
          className="rounded-lg border border-white/[0.04] bg-black/20 px-2.5 py-1.5"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[9px] text-accent">#{String(shot.number).padStart(3, '0')}</span>
            <span className="text-[10px] text-zinc-400">
              {shot.shotType} · {shot.angle} · {shot.cameraMove}
            </span>
            <span className="ml-auto font-mono text-[9px] text-zinc-600">{shot.timeRange}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-zinc-300">{shot.description}</div>
        </div>
      ))}
    </div>
  )
}
