/**
 * 往已存在的研究项目追加源视频
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Video, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import type { ResearchMeta, ResearchSubVideo } from '@shared/types'

interface Props {
  open: boolean
  onClose: () => void
  researchId: string | null
  onAdded: (meta: ResearchMeta, newSubVideos: ResearchSubVideo[]) => void
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p
}

export function AddResearchVideosDialog({ open, onClose, researchId, onAdded }: Props) {
  const [videoPaths, setVideoPaths] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setVideoPaths([])
      setSubmitting(false)
      setErr(null)
    }
  }, [open])

  const handlePick = async () => {
    try {
      const result = await api().research.pickVideos()
      if (result && result.length > 0) {
        setVideoPaths((prev) => {
          const set = new Set([...prev, ...result])
          return Array.from(set)
        })
      }
    } catch (e: any) {
      setErr(e?.message ?? '选视频失败')
    }
  }

  const handleRemove = (p: string) => {
    setVideoPaths((prev) => prev.filter((x) => x !== p))
  }

  const handleSubmit = async () => {
    if (!researchId || videoPaths.length === 0 || submitting) return
    setSubmitting(true)
    setErr(null)
    try {
      const result = await api().research.addVideosToResearch(researchId, videoPaths)
      onAdded(result.meta, result.newSubVideos)
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? '添加失败')
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-panel w-[480px] max-w-[92vw] overflow-hidden rounded-xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-200">
                <Plus className="h-4 w-4 text-accent" />
                追加源视频
              </div>
              <button
                onClick={onClose}
                className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <button
                onClick={handlePick}
                className="btn-ghost flex w-full items-center justify-center gap-1.5 py-2 text-xs"
              >
                <Video className="h-3.5 w-3.5" />
                {videoPaths.length === 0 ? '选择视频（可多选）' : '追加更多视频'}
              </button>
              {videoPaths.length > 0 && (
                <ul className="max-h-[200px] space-y-1 overflow-auto rounded-lg border border-white/[0.05] bg-black/20 p-1.5">
                  {videoPaths.map((p) => (
                    <li
                      key={p}
                      className="group flex items-center gap-2 rounded px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/[0.04]"
                    >
                      <Video className="h-3 w-3 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate font-mono" title={p}>
                        {basename(p)}
                      </span>
                      <button
                        onClick={() => handleRemove(p)}
                        className="rounded p-0.5 text-zinc-500 opacity-0 hover:bg-white/[0.06] hover:text-red-300 group-hover:opacity-100"
                        title="移除"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-[10px] text-zinc-600">共 {videoPaths.length} 个</div>
              <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-2.5 py-1.5 text-[11px] text-amber-200/80">
                注意：追加视频后，已有的风格指南将作废，需要重新研究。
              </div>
              {err && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
                  {err}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/[0.05] px-4 py-3">
              <button onClick={onClose} className="btn-ghost text-xs">
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={videoPaths.length === 0 || submitting}
                className={cn('btn-primary flex items-center gap-1.5 text-xs')}
              >
                {submitting ? '添加中...' : '添加'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
