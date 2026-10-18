/**
 * 新建风格研究项目对话框
 * 选视频（多选）+ 命名
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FilePlus2, Video } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { cn } from '../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p
}

export function CreateResearchDialog({ open, onClose }: Props) {
  const { dispatch } = useStore()
  const [videoPaths, setVideoPaths] = useState<string[]>([])
  const [name, setName] = useState('')
  // 用户是否手动改过名字：改过就不再自动建议，避免清空时被原 basename 反复回填、无法重输
  const [nameTouched, setNameTouched] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 自动建议名：第一个视频的 basename（仅在用户未手动编辑过时）
  useEffect(() => {
    if (videoPaths.length > 0 && !nameTouched) {
      setName(basename(videoPaths[0]).replace(/\.[^.]+$/, ''))
    }
  }, [videoPaths, nameTouched])

  useEffect(() => {
    if (!open) {
      setVideoPaths([])
      setName('')
      setNameTouched(false)
      setCreating(false)
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

  const handleCreate = async () => {
    if (videoPaths.length === 0 || creating) return
    setCreating(true)
    setErr(null)
    try {
      const meta = await api().research.createResearch({
        name: name.trim() || '未命名研究',
        videoPaths,
      })
      const subVideos = videoPaths.map((vp) => ({
        videoPath: vp,
        videoName: basename(vp),
        status: 'pending' as const,
        progress: 0,
        message: '',
        shots: 0,
      }))
      dispatch({ type: 'RESEARCH_CREATED', meta, subVideos })
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? '创建失败')
      setCreating(false)
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
            className="glass-panel w-[520px] max-w-[92vw] overflow-hidden rounded-xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-200">
                <FilePlus2 className="h-4 w-4 text-accent" />
                新建风格研究
              </div>
              <button
                onClick={onClose}
                className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              {/* 视频选择 */}
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                  源视频
                </label>
                <button
                  onClick={handlePick}
                  className="btn-ghost flex w-full items-center justify-center gap-1.5 py-2 text-xs"
                >
                  <Video className="h-3.5 w-3.5" />
                  {videoPaths.length === 0 ? '选择视频（可多选）' : '追加更多视频'}
                </button>
                {videoPaths.length > 0 && (
                  <ul className="mt-2 max-h-[180px] space-y-1 overflow-auto rounded-lg border border-white/[0.05] bg-black/20 p-1.5">
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
                <div className="mt-1 text-[10px] text-zinc-600">
                  共 {videoPaths.length} 个视频{videoPaths.length > 0 ? '（建议 2~8 个）' : ''}
                </div>
              </div>

              {/* 名字 */}
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                  名称
                </label>
                <input
                  value={name}
                  onChange={(e) => {
                    setNameTouched(true)
                    setName(e.target.value)
                  }}
                  placeholder="例如：诺兰作品集"
                  className="w-full rounded-md border border-white/[0.06] bg-black/40 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-accent/40"
                />
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
                onClick={handleCreate}
                disabled={videoPaths.length === 0 || creating}
                className={cn('btn-primary flex items-center gap-1.5 text-xs')}
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
