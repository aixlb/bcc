/**
 * 只读子分镜查看器 — 打开研究子视频的 storyboard
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clapperboard, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { StoryboardEditorTab } from '../pages/StoryboardEditorTab'
import type { StoryboardProject } from '@shared/types'

interface Props {
  open: boolean
  onClose: () => void
  researchId: string | null
  subIndex: number | null
  videoName?: string
}

export function SubStoryboardModal({ open, onClose, researchId, subIndex, videoName }: Props) {
  const [loading, setLoading] = useState(false)
  const [sb, setSb] = useState<StoryboardProject | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !researchId || subIndex == null) {
      setSb(null)
      setErr(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    api()
      .research.loadResearchSubStoryboard(researchId, subIndex)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setErr('子分镜尚未生成')
        } else {
          setSb(result)
        }
      })
      .catch((e: any) => {
        if (cancelled) return
        setErr(e?.message ?? '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, researchId, subIndex])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-panel flex h-[85vh] w-[min(900px,92vw)] flex-col overflow-hidden rounded-xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-200">
                <Clapperboard className="h-4 w-4 text-accent" />
                子分镜 · {videoName ?? `#${subIndex}`}
              </div>
              <button
                onClick={onClose}
                className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中...
                </div>
              ) : err ? (
                <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                  {err}
                </div>
              ) : sb ? (
                <StoryboardEditorTab project={sb} currentTime={0} onShotClick={() => {}} />
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
