import { useState, useEffect, type DragEvent } from 'react'
import { motion } from 'framer-motion'
import { Upload, Film, FolderOpen, Sparkles, Clock, Box, Cpu, Clapperboard } from 'lucide-react'
import { api } from '../lib/api'
import { basename, formatBytes, formatHMS, cn } from '../lib/utils'

interface VideoMeta {
  path: string
  durationSec: number
  sizeBytes: number
  width: number
  height: number
  format: string
  videoCodec: string
  audioCodec: string
}

interface Props {
  /** 已经有 videoPath 时直接渲染元信息 + 生成按钮，否则渲染拖拽区 */
  videoPath?: string
  apiKeyMissing: boolean
  onGenerateScript: (videoPath: string) => void
  onGenerateStoryboard: (videoPath: string) => void
  /** 拖拽/选定一个新视频后通知调用方（用于绑定到当前项目，或新建项目） */
  onVideoChosen?: (videoPath: string) => void
}

export function VideoPicker({
  videoPath,
  apiKeyMissing,
  onGenerateScript,
  onGenerateStoryboard,
  onVideoChosen,
}: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 父组件给定了 videoPath：自动 fetch 元信息
  useEffect(() => {
    if (!videoPath) {
      setVideoMeta(null)
      return
    }
    let cancelled = false
    setLoadingMeta(true)
    setError(null)
    api()
      .getVideoInfo(videoPath)
      .then((info) => {
        if (!cancelled) setVideoMeta(info)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? String(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false)
      })
    return () => {
      cancelled = true
    }
  }, [videoPath])

  const handleSelect = async () => {
    setError(null)
    const p = await api().pickVideo()
    if (p) loadVideo(p)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    let filePath = ''
    try {
      filePath = api().getPathForFile(f)
    } catch {
      filePath = (f as unknown as { path?: string }).path ?? ''
    }
    if (filePath) loadVideo(filePath)
    else setError('无法获取拖入文件的路径')
  }

  const loadVideo = async (path: string) => {
    setLoadingMeta(true)
    setError(null)
    try {
      const info = await api().getVideoInfo(path)
      setVideoMeta(info)
      onVideoChosen?.(path)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoadingMeta(false)
    }
  }

  if (videoMeta) {
    return (
      <VideoMetaCard
        meta={videoMeta}
        onReset={() => setVideoMeta(null)}
        onGenerate={() => onGenerateScript(videoMeta.path)}
        onStoryboard={() => onGenerateStoryboard(videoMeta.path)}
        apiKeyMissing={apiKeyMissing}
        canReset={!videoPath}
      />
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1, duration: 0.4 }}
      className="w-full"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={handleSelect}
        className={cn(
          'glass-panel group relative flex h-72 cursor-pointer flex-col items-center justify-center rounded-2xl transition-all',
          dragOver ? 'border-accent/40 bg-accent/[0.04]' : 'hover:border-white/[0.12]'
        )}
      >
        <div className="film-strip absolute inset-x-0 top-0 h-6 rounded-t-2xl bg-black/50" />
        <div className="film-strip absolute inset-x-0 bottom-0 h-6 rounded-b-2xl bg-black/50" />
        {dragOver && (
          <div className="absolute inset-x-6 top-6 bottom-6 overflow-hidden rounded-lg">
            <div className="absolute inset-x-0 h-px animate-scan bg-gradient-to-r from-transparent via-accent to-transparent" />
          </div>
        )}

        <div className="flex flex-col items-center gap-4 px-8 text-center">
          <motion.div
            animate={{ y: dragOver ? -4 : 0 }}
            className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.02]"
          >
            <Upload className="h-7 w-7 text-zinc-400" strokeWidth={1.5} />
            {dragOver && <div className="absolute -inset-1 animate-pulse-slow rounded-full bg-accent/20 blur-xl" />}
          </motion.div>
          <div>
            <div className="text-base text-zinc-200">
              {dragOver ? '松开导入视频' : '拖拽视频到这里 或 点击选择'}
            </div>
            <div className="mt-1 text-xs text-zinc-500">支持 MP4 · MKV · MOV · WebM · AVI · FLV · WMV</div>
          </div>
        </div>
      </div>

      {loadingMeta && (
        <div className="mt-4 text-center text-xs text-zinc-500">读取视频信息...</div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/[0.05] px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {apiKeyMissing && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-4 py-2 text-sm text-amber-200">
          ⚠ 你还没有配置 Gemini API Key。点击右上角 ⚙ 设置图标填写。
        </div>
      )}
    </motion.div>
  )
}

function VideoMetaCard({
  meta,
  onReset,
  onGenerate,
  onStoryboard,
  apiKeyMissing,
  canReset,
}: {
  meta: VideoMeta
  onReset: () => void
  onGenerate: () => void
  onStoryboard: () => void
  apiKeyMissing: boolean
  canReset: boolean
}) {
  const filename = basename(meta.path)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="w-full"
    >
      <div className="glass-panel rounded-2xl">
        <div className="film-strip h-6 rounded-t-2xl bg-black/50" />

        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-accent/[0.08]">
              <Film className="h-6 w-6 text-accent" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium text-zinc-100">{filename}</div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">{meta.path}</div>
            </div>
            {canReset && (
              <button onClick={onReset} className="btn-ghost shrink-0" title="重选">
                <FolderOpen className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </div>

          <div className="mt-5 grid grid-cols-4 gap-3">
            <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="时长" value={formatHMS(meta.durationSec)} />
            <MetaItem icon={<Box className="h-3.5 w-3.5" />} label="大小" value={formatBytes(meta.sizeBytes)} />
            <MetaItem
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="分辨率"
              value={meta.width && meta.height ? `${meta.width}×${meta.height}` : '—'}
            />
            <MetaItem
              icon={<Film className="h-3.5 w-3.5" />}
              label="编码"
              value={meta.videoCodec ? meta.videoCodec.toUpperCase() : '—'}
            />
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={onStoryboard}
              disabled={apiKeyMissing}
              className="btn-primary flex items-center gap-2 !bg-zinc-800 !text-zinc-200 hover:!bg-zinc-700"
            >
              <Clapperboard className="h-4 w-4" strokeWidth={2} />
              生成分镜表
            </button>
            <button onClick={onGenerate} disabled={apiKeyMissing} className="btn-primary flex items-center gap-2">
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              生成剧本
            </button>
          </div>
          {apiKeyMissing && (
            <div className="mt-3 text-right text-xs text-amber-300">先到设置页配置 API Key</div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-black/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-zinc-200">{value}</div>
    </div>
  )
}
