/**
 * 风格研究主页面
 *  - 左栏：源视频列表（状态 / 镜数 / 查看分镜）
 *  - 右栏：CTA / 风格指南（运行中显示流式预览；完成后显示完整）
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FlaskConical,
  FolderOpen,
  Video,
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Eye,
  Download,
  Copy,
  Plus,
} from 'lucide-react'
import { useStore, useSelectedResearch } from '../lib/store'
import type { ResearchJob, ResearchMeta, ResearchSubVideo } from '@shared/types'
import { api } from '../lib/api'
import { basename, cn, providerKeyConfigured } from '../lib/utils'
import { ResizableSplit } from '../components/ResizableSplit'
import { SubStoryboardModal } from '../components/SubStoryboardModal'
import { AddResearchVideosDialog } from '../components/AddResearchVideosDialog'

export function ResearchView() {
  const research = useSelectedResearch()
  const { config, dispatch } = useStore()
  const [styleGuide, setStyleGuide] = useState<string | null>(null)
  const [loadingGuide, setLoadingGuide] = useState(false)
  const [modalSub, setModalSub] = useState<{ index: number; name: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const id = research?.meta.id ?? null
  const job = research?.job ?? null

  // 拉取 style-guide.md
  useEffect(() => {
    if (!id) {
      setStyleGuide(null)
      return
    }
    // 优先用 store 缓存
    if (research?.styleGuide != null) {
      setStyleGuide(research.styleGuide)
      return
    }
    // 作业完成后才拉
    if (research?.meta.hasStyleGuide) {
      setLoadingGuide(true)
      api()
        .research
        .loadResearchStyleGuide(id)
        .then((text) => {
          setStyleGuide(text)
        })
        .catch((e) => console.error('load style guide failed', e))
        .finally(() => setLoadingGuide(false))
    } else {
      setStyleGuide(null)
    }
  }, [id, research?.styleGuide, research?.meta.hasStyleGuide])

  if (!research) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-600">
        未选中研究项目
      </div>
    )
  }

  // 风格研究的分镜分析走 storyboard_provider（合成阶段缺省也继承它），按该 provider 是否配 key 判断
  const apiKeyMissing = !providerKeyConfigured(config, config?.storyboard_provider)
  const running = job && !isFinished(job.status)
  const failed = job?.status === 'failed' || job?.status === 'cancelled'
  const hasResult = !!research.meta.hasStyleGuide && !!styleGuide

  const handleStart = async () => {
    if (!id || apiKeyMissing) return
    try {
      const { jobId } = await api().research.startResearch(id)
      const newJob: ResearchJob = {
        jobId,
        status: 'preparing',
        progress: 0,
        message: '准备中...',
        totalSubs: research.meta.videoPaths.length,
        partialStyleGuide: '',
        log: [],
      }
      dispatch({ type: 'RESEARCH_JOB_START', id, job: newJob })
    } catch (e) {
      console.error('startResearch failed', e)
    }
  }

  const handleOpenFolder = () => {
    if (id) api().research.openResearchDir(id)
  }

  const handleVideosAdded = (meta: ResearchMeta, newSubVideos: ResearchSubVideo[]) => {
    if (!id) return
    // 旧的 styleGuide 缓存已由 reducer 清空；本地 state 也清掉
    setStyleGuide(null)
    dispatch({ type: 'RESEARCH_VIDEOS_ADDED', id, meta, newSubVideos })
  }

  const handleCopy = async () => {
    if (!styleGuide) return
    try {
      await navigator.clipboard.writeText(styleGuide)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error('copy failed', e)
    }
  }

  const handleDownload = () => {
    if (!styleGuide || !id) return
    const blob = new Blob([styleGuide], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${research.meta.name || 'style-guide'}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      {/* 顶部 */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] bg-ink-950/60 px-4 py-2 backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <FlaskConical className="h-3.5 w-3.5 text-accent" />
          <span className="max-w-[260px] truncate font-mono" title={research.meta.name}>
            {research.meta.name}
          </span>
          <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-zinc-500">
            {research.meta.videoPaths.length} 源视频
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasResult && (
            <>
              <button
                onClick={handleCopy}
                className="btn-ghost flex items-center gap-1 !p-1.5 text-xs"
                title="复制 Markdown 到剪贴板"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? '已复制' : '复制'}
              </button>
              <button
                onClick={handleDownload}
                className="btn-ghost flex items-center gap-1 !p-1.5 text-xs"
                title="下载 style-guide.md"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </button>
            </>
          )}
          <div className="h-4 w-px bg-white/[0.08]" />
          <button
            onClick={handleOpenFolder}
            className="btn-ghost flex items-center gap-1 !p-1.5 text-xs"
            title="打开项目文件夹"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 主体：左源视频列表 + 右风格指南 */}
      <ResizableSplit
        direction="horizontal"
        className="min-h-0"
        first={
          <SubVideoPanel
            subs={research.subVideos}
            onOpenSub={(i, n) => setModalSub({ index: i, name: n })}
            onAddVideos={() => setAddDialogOpen(true)}
          />
        }
        second={
          <StyleGuidePanel
            running={!!running}
            failed={failed}
            hasResult={hasResult}
            loadingGuide={loadingGuide}
            text={running ? job?.partialStyleGuide ?? '' : styleGuide ?? ''}
            errorMessage={failed ? job?.message ?? '' : ''}
            apiKeyMissing={apiKeyMissing}
            onStart={handleStart}
          />
        }
        defaultSize={400}
        minSize={260}
      />

      <SubStoryboardModal
        open={modalSub != null}
        onClose={() => setModalSub(null)}
        researchId={id}
        subIndex={modalSub?.index ?? null}
        videoName={modalSub?.name}
      />

      <AddResearchVideosDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        researchId={id}
        onAdded={handleVideosAdded}
      />
    </div>
  )
}

function SubVideoPanel({
  subs,
  onOpenSub,
  onAddVideos,
}: {
  subs: ResearchSubVideo[]
  onOpenSub: (index: number, name: string) => void
  onAddVideos: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-900/30">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-3 py-2">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">
          源视频 <span className="ml-1 font-mono text-zinc-600">({subs.length})</span>
        </span>
        <button
          onClick={onAddVideos}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          title="追加源视频"
        >
          <Plus className="h-3 w-3" />
          追加
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="space-y-1.5">
          {subs.map((sv, i) => (
            <SubVideoRow key={i} index={i + 1} sub={sv} onOpen={onOpenSub} />
          ))}
          {subs.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-zinc-600">无源视频</div>
          )}
        </div>
      </div>
    </div>
  )
}

function SubVideoRow({
  index,
  sub,
  onOpen,
}: {
  index: number
  sub: ResearchSubVideo
  onOpen: (index: number, name: string) => void
}) {
  const canOpen = sub.status === 'completed'
  return (
    <div className="rounded-lg border border-white/[0.04] bg-black/20 p-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-accent">#{index}</span>
        <Video className="h-3 w-3 shrink-0 text-zinc-600" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300" title={sub.videoPath}>
          {sub.videoName}
        </span>
        <SubStatusBadge status={sub.status} />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-500">
        <span className="font-mono">
          {sub.status === 'completed'
            ? `${sub.shots} 镜`
            : sub.status === 'failed'
              ? '失败'
              : sub.status === 'pending'
                ? '等待'
                : `${Math.round(sub.progress * 100)}%`}
        </span>
        <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
          <div
            className={cn(
              'h-full transition-all',
              sub.status === 'completed'
                ? 'bg-emerald-400'
                : sub.status === 'failed'
                  ? 'bg-red-400'
                  : 'bg-accent'
            )}
            style={{ width: `${Math.round(sub.progress * 100)}%` }}
          />
        </div>
      </div>
      {sub.message && (
        <div className="mt-0.5 truncate text-[9.5px] text-zinc-600" title={sub.message}>
          {sub.message}
        </div>
      )}
      {canOpen && (
        <button
          onClick={() => onOpen(index, sub.videoName)}
          className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
        >
          <Eye className="h-3 w-3" />
          查看分镜
        </button>
      )}
    </div>
  )
}

function SubStatusBadge({ status }: { status: ResearchSubVideo['status'] }) {
  const map: Record<ResearchSubVideo['status'], { label: string; cls: string; icon?: React.ReactNode }> = {
    pending: { label: '等待', cls: 'text-zinc-500' },
    detecting: { label: '检测', cls: 'text-accent', icon: <Loader2 className="h-2.5 w-2.5 animate-spin" /> },
    analyzing: { label: '分析', cls: 'text-accent', icon: <Loader2 className="h-2.5 w-2.5 animate-spin" /> },
    completed: { label: '完成', cls: 'text-emerald-400', icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
    failed: { label: '失败', cls: 'text-red-400', icon: <AlertCircle className="h-2.5 w-2.5" /> },
  }
  const m = map[status]
  return (
    <span className={cn('flex shrink-0 items-center gap-0.5 font-mono text-[9px]', m.cls)}>
      {m.icon}
      {m.label}
    </span>
  )
}

function StyleGuidePanel({
  running,
  failed,
  hasResult,
  loadingGuide,
  text,
  errorMessage,
  apiKeyMissing,
  onStart,
}: {
  running: boolean
  failed: boolean
  hasResult: boolean
  loadingGuide: boolean
  text: string
  errorMessage: string
  apiKeyMissing: boolean
  onStart: () => void
}) {
  if (loadingGuide) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载风格指南...
      </div>
    )
  }

  if (running || hasResult) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-ink-900/30">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-3 py-2">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            风格指南
            {running && <span className="ml-2 text-accent">生成中...</span>}
          </span>
          {!running && hasResult && (
            <button
              onClick={onStart}
              disabled={apiKeyMissing}
              className="flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-zinc-100 disabled:opacity-50"
              title={apiKeyMissing ? '先在设置中填 API Key' : '基于当前源视频重新研究'}
            >
              <Sparkles className="h-3 w-3" />
              重新研究
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {text ? (
            <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-zinc-300">
              {text}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
              等待 AI 输出...
            </div>
          )}
        </div>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-xs text-center"
        >
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/[0.05] text-red-300">
            <AlertCircle className="h-7 w-7" />
          </div>
          <div className="text-sm text-zinc-200">研究失败</div>
          <div className="mt-2 line-clamp-4 break-all rounded-md border border-red-500/20 bg-red-500/[0.04] px-2.5 py-1.5 text-left text-[11px] text-red-200/80">
            {errorMessage || '未知错误'}
          </div>
          <button
            onClick={onStart}
            disabled={apiKeyMissing}
            className="btn-primary mt-4 inline-flex items-center gap-1.5 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            重试
          </button>
          {apiKeyMissing && (
            <div className="mt-2 text-[11px] text-amber-300">先在设置中填 API Key</div>
          )}
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-8">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xs text-center"
      >
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.02] text-zinc-500">
          <FlaskConical className="h-7 w-7" />
        </div>
        <div className="text-sm text-zinc-200">开始风格研究</div>
        <div className="mt-1 text-xs leading-relaxed text-zinc-500">
          并行对每个源视频做分镜拆解，然后把所有分镜喂给 AI 提炼出可复用的风格配方
        </div>
        <button
          onClick={onStart}
          disabled={apiKeyMissing}
          className="btn-primary mt-4 inline-flex items-center gap-1.5 text-xs"
        >
          <Sparkles className="h-3.5 w-3.5" />
          开始研究
        </button>
        {apiKeyMissing && (
          <div className="mt-2 text-[11px] text-amber-300">先在设置中填 API Key</div>
        )}
      </motion.div>
    </div>
  )
}

function isFinished(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}
