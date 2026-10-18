/**
 * 风格研究作业面板 — JobDrawer 第三个 tab
 */
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  FlaskConical,
  Film,
  Brain,
  Sparkles,
} from 'lucide-react'
import type { ResearchJob, ResearchSubVideo } from '@shared/types'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

const STATUS_LABELS: Record<ResearchJob['status'], string> = {
  preparing: '准备',
  analyzing_subs: '分镜拆解',
  building_mosaics: '构建拼图',
  synthesizing: 'AI 提炼',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
}

const STATUS_ORDER: ResearchJob['status'][] = [
  'preparing',
  'analyzing_subs',
  'building_mosaics',
  'synthesizing',
  'completed',
]

const STATUS_ICONS: Record<string, React.ReactNode> = {
  preparing: <FlaskConical className="h-3.5 w-3.5" />,
  analyzing_subs: <Film className="h-3.5 w-3.5" />,
  building_mosaics: <Sparkles className="h-3.5 w-3.5" />,
  synthesizing: <Brain className="h-3.5 w-3.5" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5" />,
}

interface Props {
  job: ResearchJob
  subVideos: ResearchSubVideo[]
}

export function ResearchJobPanel({ job, subVideos }: Props) {
  const isFinished =
    job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'

  return (
    <div className="grid h-full min-h-0 grid-cols-12 gap-3 px-4 py-3">
      {/* 左：Hero + Timeline + Log */}
      <div className="col-span-5 flex min-h-0 flex-col gap-3">
        <Hero job={job} />
        <Timeline job={job} />
        <Log job={job} />
        {!isFinished && (
          <div className="mt-auto flex shrink-0 justify-end">
            <button
              onClick={() => api().research.cancelResearch(job.jobId)}
              className="btn-danger flex items-center gap-1.5 text-xs"
            >
              <X className="h-3.5 w-3.5" />
              取消
            </button>
          </div>
        )}
      </div>

      {/* 右：阶段预览 */}
      <div className="col-span-7 flex min-h-0 flex-col overflow-hidden">
        <div className="glass-panel flex flex-1 flex-col overflow-hidden rounded-lg">
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-3 py-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-400">
              <span
                className={cn(
                  'pulse-dot',
                  ['preparing', 'analyzing_subs', 'building_mosaics', 'synthesizing'].includes(
                    job.status
                  )
                    ? 'text-accent'
                    : 'text-zinc-600'
                )}
              />
              {job.status === 'synthesizing' ? '风格指南流' : '子视频进度'}
            </div>
            <div className="font-mono text-[10px] text-zinc-500">
              {job.totalSubs > 0 ? `${job.totalSubs} 源视频` : ''}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2.5">
            {job.status === 'synthesizing' || job.status === 'completed' ? (
              <StyleGuideStream text={job.partialStyleGuide} />
            ) : (
              <SubVideoGrid subVideos={subVideos} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Hero({ job }: { job: ResearchJob }) {
  const pct = Math.max(0, Math.min(1, job.progress))
  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon status={job.status} />
          <div>
            <div className="text-[13px] font-medium text-zinc-100">
              {STATUS_LABELS[job.status] ?? job.status}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
              {job.message || ' '}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-light tracking-tight text-zinc-100">
            {(pct * 100).toFixed(0)}
            <span className="text-xs text-zinc-500">%</span>
          </div>
          {job.totalSubs > 0 && (
            <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
              {job.totalSubs} 源视频
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

function StatusIcon({ status }: { status: ResearchJob['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 text-emerald-400" strokeWidth={1.5} />
  if (status === 'failed') return <AlertCircle className="h-5 w-5 text-red-400" strokeWidth={1.5} />
  if (status === 'cancelled') return <X className="h-5 w-5 text-zinc-500" strokeWidth={1.5} />
  return <Loader2 className="h-5 w-5 animate-spin text-accent" strokeWidth={1.5} />
}

function Timeline({ job }: { job: ResearchJob }) {
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
                  isDone
                    ? 'text-zinc-400'
                    : isCurrent
                      ? 'font-medium text-zinc-100'
                      : 'text-zinc-600'
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

function Log({ job }: { job: ResearchJob }) {
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

function SubVideoGrid({ subVideos }: { subVideos: ResearchSubVideo[] }) {
  if (subVideos.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
        等待子视频开始...
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {subVideos.map((sv, i) => (
        <div
          key={i}
          className="rounded-lg border border-white/[0.04] bg-black/20 px-2.5 py-1.5"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[9px] text-accent">#{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-zinc-300">
              {sv.videoName}
            </span>
            <SubStatusBadge status={sv.status} />
          </div>
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className={cn(
                'h-full transition-all',
                sv.status === 'completed'
                  ? 'bg-emerald-400'
                  : sv.status === 'failed'
                    ? 'bg-red-400'
                    : 'bg-accent'
              )}
              style={{ width: `${Math.round(sv.progress * 100)}%` }}
            />
          </div>
          {sv.message && (
            <div className="mt-0.5 truncate text-[9.5px] text-zinc-600">
              {sv.message}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SubStatusBadge({ status }: { status: ResearchSubVideo['status'] }) {
  const map: Record<ResearchSubVideo['status'], { label: string; cls: string }> = {
    pending: { label: '等待', cls: 'text-zinc-500' },
    detecting: { label: '镜头检测', cls: 'text-accent' },
    analyzing: { label: '分析中', cls: 'text-accent' },
    completed: { label: '完成', cls: 'text-emerald-400' },
    failed: { label: '失败', cls: 'text-red-400' },
  }
  const m = map[status]
  return <span className={cn('font-mono text-[9px]', m.cls)}>{m.label}</span>
}

function StyleGuideStream({ text }: { text: string }) {
  if (!text) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
        AI 正在生成《风格指南》...
      </div>
    )
  }
  return (
    <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-zinc-300">
      {text}
    </pre>
  )
}
