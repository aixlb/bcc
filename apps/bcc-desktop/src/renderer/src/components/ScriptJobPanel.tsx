import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'
import type { JobStatus } from '@shared/types'
import type { CurrentJob } from '../lib/store'
import { api } from '../lib/api'
import { cn, formatBytes, formatMs, formatTokens } from '../lib/utils'

const STATUS_LABELS: Record<JobStatus, string> = {
  pending: '排队中',
  preparing: '准备视频',
  compressing: '压缩视频',
  uploading: '上传视频',
  waiting_process: 'AI 解析视频中',
  generating: '流式生成剧本',
  merging: '合并分段',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
}

const STATUS_ORDER: JobStatus[] = [
  'preparing',
  'compressing',
  'uploading',
  'waiting_process',
  'generating',
  'merging',
  'completed',
]

interface Props {
  job: CurrentJob
}

export function ScriptJobPanel({ job }: Props) {
  const scriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scriptRef.current) {
      scriptRef.current.scrollTop = scriptRef.current.scrollHeight
    }
  }, [job.partialScript])

  const isFinished = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'

  return (
    <div className="grid h-full min-h-0 grid-cols-12 gap-3 px-4 py-3">
      {/* 左：状态 + 时间线 + 日志 */}
      <div className="col-span-5 flex min-h-0 flex-col gap-3">
        <Hero job={job} />
        <Timeline job={job} />
        <Log job={job} />
        {!isFinished && (
          <div className="mt-auto flex shrink-0 justify-end">
            <button
              onClick={() => api().cancelGenerate(job.jobId)}
              className="btn-danger flex items-center gap-1.5 text-xs"
            >
              <X className="h-3.5 w-3.5" />
              取消
            </button>
          </div>
        )}
      </div>

      {/* 右：流式剧本 */}
      <div className="col-span-7 flex min-h-0 flex-col overflow-hidden">
        <div className="glass-panel flex flex-1 flex-col overflow-hidden rounded-lg">
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-3 py-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-400">
              <span className={cn('pulse-dot', job.status === 'generating' ? 'text-accent' : 'text-zinc-600')} />
              实时剧本流
            </div>
            <div className="font-mono text-[10px] text-zinc-500">
              {job.partialScript.length.toLocaleString()} 字
            </div>
          </div>
          <div ref={scriptRef} className="min-h-0 flex-1 overflow-auto p-3">
            {job.partialScript ? (
              <pre className="whitespace-pre-wrap break-words font-script text-[12px] leading-relaxed text-zinc-300">
                {job.partialScript}
                {job.status === 'generating' && (
                  <span className="ml-0.5 inline-block h-3 w-1.5 -translate-y-0.5 animate-pulse bg-accent" />
                )}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
                等待 AI 输出...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Hero({ job }: { job: CurrentJob }) {
  const pct = Math.max(0, Math.min(1, job.progress))
  const elapsed = Date.now() - job.startedAt
  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon status={job.status} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-zinc-100">{STATUS_LABELS[job.status] ?? job.status}</span>
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
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
            已用 {formatMs(elapsed)}
            {job.totalSegments && job.totalSegments > 1 && (
              <span className="ml-1">· 段 {job.currentSegment}/{job.totalSegments}</span>
            )}
            {job.status === 'uploading' && job.videoSizeBytes > 0 && (
              <span className="ml-1">· {formatBytes(job.videoSizeBytes)}</span>
            )}
            {typeof job.tokensUsed === 'number' ? (
              <span className="ml-1">· {formatTokens(job.tokensUsed)} tokens</span>
            ) : job.partialScript.length > 0 ? (
              <span className="ml-1">· {job.partialScript.length.toLocaleString()} 字</span>
            ) : null}
          </div>
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

function StatusIcon({ status }: { status: JobStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 text-emerald-400" strokeWidth={1.5} />
  if (status === 'failed') return <AlertCircle className="h-5 w-5 text-red-400" strokeWidth={1.5} />
  if (status === 'cancelled') return <X className="h-5 w-5 text-zinc-500" strokeWidth={1.5} />
  return <Loader2 className="h-5 w-5 animate-spin text-accent" strokeWidth={1.5} />
}

function Timeline({ job }: { job: CurrentJob }) {
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Log({ job }: { job: CurrentJob }) {
  if (job.log.length === 0) return null
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
