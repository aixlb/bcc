import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Clapperboard,
  Film,
  MoreHorizontal,
  Trash2,
  Edit3,
  FolderOpen,
  Loader2,
  FilePlus2,
  FolderInput,
  Sparkles,
  FlaskConical,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { useStore, type ProjectState, type ResearchState } from '../lib/store'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { CreateResearchDialog } from './CreateResearchDialog'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const { projects, selectedProjectId, dispatch } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [researchDialogOpen, setResearchDialogOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const handleNewEmpty = async () => {
    setMenuOpen(false)
    const videoPath = await api().pickVideo()
    if (!videoPath) return
    const name = basename(videoPath).replace(/\.[^.]+$/, '')
    try {
      const project = await api().createProject({ name, videoPath })
      dispatch({ type: 'PROJECT_CREATED', project, select: true })
    } catch (e: any) {
      console.error('createProject failed', e)
    }
  }

  const handleImportScript = async () => {
    setMenuOpen(false)
    try {
      const project = await api().importScriptAsProject()
      if (project) dispatch({ type: 'PROJECT_CREATED', project, select: true })
    } catch (e: any) {
      console.error('importScriptAsProject failed', e)
    }
  }

  const handleImportStoryboard = async () => {
    setMenuOpen(false)
    try {
      const project = await api().importStoryboardAsProject()
      if (project) dispatch({ type: 'PROJECT_CREATED', project, select: true })
    } catch (e: any) {
      console.error('importStoryboardAsProject failed', e)
    }
  }

  return (
    <aside className="no-drag flex h-full flex-col border-r border-white/[0.05] bg-ink-950/60 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/[0.05] px-2 py-2">
        {!collapsed ? (
          <>
            <div className="flex items-center gap-1 pl-1 text-[11px] tracking-[0.06em] text-zinc-500">
              <Sparkles className="h-3 w-3 text-accent" /> 项目
            </div>
            <div className="relative flex items-center gap-0.5" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                title="新建项目"
              >
                <Plus className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                onClick={onToggleCollapse}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                title="折叠"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/95 shadow-xl backdrop-blur-md"
                  >
                    <MenuItem icon={<FilePlus2 className="h-3.5 w-3.5" />} label="新建空项目（选视频）" onClick={handleNewEmpty} />
                    <MenuItem icon={<FileText className="h-3.5 w-3.5" />} label="导入剧本 + 视频" onClick={handleImportScript} />
                    <MenuItem icon={<FolderInput className="h-3.5 w-3.5" />} label="导入分镜表目录" onClick={handleImportStoryboard} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <button
            onClick={onToggleCollapse}
            className="mx-auto rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
            title="展开"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {/* 项目 section */}
        {projects.length === 0 ? (
          !collapsed && (
            <div className="px-3 py-6 text-center text-[11px] leading-relaxed text-zinc-600">
              还没有项目。<br />点上面 <Plus className="inline h-3 w-3" /> 开始。
            </div>
          )
        ) : (
          <div className="space-y-0.5">
            {projects.map((p) => (
              <ProjectItem
                key={p.meta.id}
                project={p}
                collapsed={collapsed}
                selected={p.meta.id === selectedProjectId}
                onSelect={() => dispatch({ type: 'SELECT_PROJECT', id: p.meta.id })}
              />
            ))}
          </div>
        )}

        {/* 风格研究 section */}
        {!collapsed && (
          <ResearchSection onCreate={() => setResearchDialogOpen(true)} />
        )}
      </div>

      <CreateResearchDialog
        open={researchDialogOpen}
        onClose={() => setResearchDialogOpen(false)}
      />
    </aside>
  )
}

function ResearchSection({ onCreate }: { onCreate: () => void }) {
  const { research, selectedResearchId, dispatch } = useStore()
  return (
    <div className="mt-3 border-t border-white/[0.05] pt-3">
      <div className="mb-1.5 flex items-center justify-between px-2">
        <div className="flex items-center gap-1 text-[11px] tracking-[0.06em] text-zinc-500">
          <FlaskConical className="h-3 w-3 text-accent" /> 风格研究
        </div>
        <button
          onClick={onCreate}
          className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          title="新建风格研究"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
      {research.length === 0 ? (
        <div className="px-3 py-4 text-center text-[11px] leading-relaxed text-zinc-600">
          还没有研究项目。<br />点 + 新建一个。
        </div>
      ) : (
        <div className="space-y-0.5">
          {research.map((d) => (
            <ResearchItem
              key={d.meta.id}
              research={d}
              selected={d.meta.id === selectedResearchId}
              onSelect={() => dispatch({ type: 'SELECT_RESEARCH', id: d.meta.id })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
    >
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  )
}

function ProjectItem({
  project,
  collapsed,
  selected,
  onSelect,
}: {
  project: ProjectState
  collapsed: boolean
  selected: boolean
  onSelect: () => void
}) {
  const { dispatch } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.meta.name)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const running =
    (project.scriptJob && !isFinishedScript(project.scriptJob.status)) ||
    (project.storyboardJob && !isFinishedStoryboard(project.storyboardJob.status))

  const handleRename = async () => {
    setMenuOpen(false)
    setDraftName(project.meta.name)
    setRenaming(true)
  }

  const commitRename = async () => {
    setRenaming(false)
    const newName = draftName.trim()
    if (!newName || newName === project.meta.name) return
    try {
      const updated = await api().renameProject(project.meta.id, newName)
      dispatch({ type: 'PROJECT_RENAMED', project: updated })
    } catch (e: any) {
      console.error('renameProject failed', e)
    }
  }

  const handleDelete = async () => {
    setMenuOpen(false)
    const ok = window.confirm(`确定要删除项目 "${project.meta.name}"？\n所有生成的剧本和分镜表都会被删除（视频源文件不动）。`)
    if (!ok) return
    try {
      await api().deleteProject(project.meta.id)
      dispatch({ type: 'PROJECT_DELETED', id: project.meta.id })
    } catch (e: any) {
      console.error('deleteProject failed', e)
    }
  }

  const handleOpenFolder = async () => {
    setMenuOpen(false)
    try {
      await api().openProjectDir(project.meta.id)
    } catch (e: any) {
      console.error('openProjectDir failed', e)
    }
  }

  return (
    <div
      ref={itemRef}
      onClick={onSelect}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        selected
          ? 'bg-accent/[0.08] text-zinc-100'
          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
      )}
      title={collapsed ? project.meta.name : undefined}
    >
      <Film
        className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-accent' : 'text-zinc-500')}
        strokeWidth={1.5}
      />
      {!collapsed && (
        <>
          {renaming ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setDraftName(project.meta.name)
                  setRenaming(false)
                }
              }}
              className="min-w-0 flex-1 rounded border border-accent/40 bg-black/40 px-1.5 py-0.5 text-xs outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{project.meta.name}</span>
          )}

          {/* 状态徽标 */}
          <div className="flex shrink-0 items-center gap-1">
            {running && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
            {!running && project.meta.hasScript && (
              <FileText className="h-3 w-3 text-zinc-600" strokeWidth={1.5} />
            )}
            {!running && project.meta.hasStoryboard && (
              <Clapperboard className="h-3 w-3 text-zinc-600" strokeWidth={1.5} />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
              className="rounded p-0.5 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.12 }}
                onClick={(e) => e.stopPropagation()}
                className="absolute right-1 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/95 shadow-xl backdrop-blur-md"
              >
                <MenuItem icon={<Edit3 className="h-3.5 w-3.5" />} label="重命名" onClick={handleRename} />
                <MenuItem icon={<FolderOpen className="h-3.5 w-3.5" />} label="在文件夹中打开" onClick={handleOpenFolder} />
                <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除项目" onClick={handleDelete} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

function isFinishedScript(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}

function isFinishedStoryboard(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}

function ResearchItem({
  research,
  selected,
  onSelect,
}: {
  research: ResearchState
  selected: boolean
  onSelect: () => void
}) {
  const { dispatch } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(research.meta.name)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const job = research.job
  const running = !!job && !isFinishedResearch(job.status)
  const status = job?.status

  const handleRename = () => {
    setMenuOpen(false)
    setDraftName(research.meta.name)
    setRenaming(true)
  }

  const commitRename = async () => {
    setRenaming(false)
    const newName = draftName.trim()
    if (!newName || newName === research.meta.name) return
    try {
      const updated = await api().research.renameResearch(research.meta.id, newName)
      dispatch({ type: 'RESEARCH_RENAMED', meta: updated })
    } catch (e: any) {
      console.error('renameResearch failed', e)
    }
  }

  const handleDelete = async () => {
    setMenuOpen(false)
    const ok = window.confirm(
      `确定要删除研究项目 "${research.meta.name}"？\n所有源视频分镜、拼图和风格指南都会被删除。`
    )
    if (!ok) return
    try {
      await api().research.deleteResearch(research.meta.id)
      dispatch({ type: 'RESEARCH_DELETED', id: research.meta.id })
    } catch (e: any) {
      console.error('deleteResearch failed', e)
    }
  }

  const handleOpenFolder = async () => {
    setMenuOpen(false)
    try {
      await api().research.openResearchDir(research.meta.id)
    } catch (e: any) {
      console.error('openResearchDir failed', e)
    }
  }

  return (
    <div
      ref={itemRef}
      onClick={onSelect}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        selected
          ? 'bg-accent/[0.08] text-zinc-100'
          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
      )}
      title={research.meta.name}
    >
      <FlaskConical
        className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-accent' : 'text-zinc-500')}
        strokeWidth={1.5}
      />
      {renaming ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') {
              setDraftName(research.meta.name)
              setRenaming(false)
            }
          }}
          className="min-w-0 flex-1 rounded border border-accent/40 bg-black/40 px-1.5 py-0.5 text-xs outline-none"
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{research.meta.name}</span>
          <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
            {research.meta.videoPaths.length} 源
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {running && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
            {!running && status === 'completed' && (
              <CheckCircle2 className="h-3 w-3 text-emerald-400" strokeWidth={1.5} />
            )}
            {!running && status === 'failed' && (
              <AlertCircle className="h-3 w-3 text-red-400" strokeWidth={1.5} />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
              className="rounded p-0.5 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.12 }}
                onClick={(e) => e.stopPropagation()}
                className="absolute right-1 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/95 shadow-xl backdrop-blur-md"
              >
                <MenuItem icon={<Edit3 className="h-3.5 w-3.5" />} label="重命名" onClick={handleRename} />
                <MenuItem icon={<FolderOpen className="h-3.5 w-3.5" />} label="在文件夹中打开" onClick={handleOpenFolder} />
                <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除研究" onClick={handleDelete} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

function isFinishedResearch(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}

function basename(p: string): string {
  const m = p.match(/[^\\/]+$/)
  return m ? m[0] : p
}
