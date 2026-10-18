import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, FileText, Clapperboard, X, FlaskConical } from 'lucide-react'
import { useStore, useSelectedProject, useSelectedResearch } from '../lib/store'
import { ScriptJobPanel } from './ScriptJobPanel'
import { StoryboardJobPanel } from './StoryboardJobPanel'
import { ResearchJobPanel } from './ResearchJobPanel'
import { cn } from '../lib/utils'

export function JobDrawer() {
  const { drawerOpen, drawerTab, dispatch } = useStore()
  const project = useSelectedProject()
  const research = useSelectedResearch()

  const scriptJob = project?.scriptJob ?? null
  const storyboardJob = project?.storyboardJob ?? null
  const researchJob = research?.job ?? null

  const hasAnyJob = !!scriptJob || !!storyboardJob || !!researchJob

  if (!hasAnyJob) {
    return (
      <div className="flex h-full flex-col items-center justify-center border-t border-white/[0.05] bg-ink-950/85 backdrop-blur-md">
        <span className="text-[11px] text-zinc-600">暂无进行中的任务</span>
      </div>
    )
  }

  // 默认选已存在的 tab
  const activeTab =
    drawerTab === 'research' && researchJob
      ? 'research'
      : drawerTab === 'storyboard' && storyboardJob
        ? 'storyboard'
        : drawerTab === 'script' && scriptJob
          ? 'script'
          : scriptJob
            ? 'script'
            : storyboardJob
              ? 'storyboard'
              : 'research'

  const clearActive = () => {
    if (activeTab === 'script' && scriptJob && isFinishedScript(scriptJob.status) && project) {
      dispatch({ type: 'SCRIPT_JOB_CLEAR', projectId: project.meta.id })
    } else if (
      activeTab === 'storyboard' &&
      storyboardJob &&
      isFinishedStoryboard(storyboardJob.status) &&
      project
    ) {
      dispatch({ type: 'STORYBOARD_JOB_CLEAR', projectId: project.meta.id })
    } else if (
      activeTab === 'research' &&
      researchJob &&
      isFinishedResearch(researchJob.status) &&
      research
    ) {
      dispatch({ type: 'RESEARCH_JOB_CLEAR', id: research.meta.id })
    }
  }

  const showClearBtn =
    drawerOpen &&
    ((activeTab === 'script' && scriptJob && isFinishedScript(scriptJob.status)) ||
      (activeTab === 'storyboard' && storyboardJob && isFinishedStoryboard(storyboardJob.status)) ||
      (activeTab === 'research' && researchJob && isFinishedResearch(researchJob.status)))

  return (
    <div className="flex h-full flex-col border-t border-white/[0.05] bg-ink-950/85 backdrop-blur-md">
      {/* 抽屉头：tabs + 折叠 */}
      <div className="flex shrink-0 items-center justify-between px-2 py-1">
        <div className="flex items-center gap-0.5">
          {scriptJob && (
            <TabButton
              active={activeTab === 'script'}
              onClick={() => dispatch({ type: 'SET_DRAWER_TAB', tab: 'script' })}
              icon={<FileText className="h-3.5 w-3.5" />}
              label="剧本"
              progress={scriptJob.progress}
              status={scriptJob.status}
            />
          )}
          {storyboardJob && (
            <TabButton
              active={activeTab === 'storyboard'}
              onClick={() => dispatch({ type: 'SET_DRAWER_TAB', tab: 'storyboard' })}
              icon={<Clapperboard className="h-3.5 w-3.5" />}
              label="分镜表"
              progress={storyboardJob.progress}
              status={storyboardJob.status}
            />
          )}
          {researchJob && (
            <TabButton
              active={activeTab === 'research'}
              onClick={() => dispatch({ type: 'SET_DRAWER_TAB', tab: 'research' })}
              icon={<FlaskConical className="h-3.5 w-3.5" />}
              label="研究"
              progress={researchJob.progress}
              status={researchJob.status}
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          {showClearBtn && (
            <button
              onClick={clearActive}
              className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              title="清空已完成日志"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => dispatch({ type: 'SET_DRAWER_OPEN', open: !drawerOpen })}
            className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
            title={drawerOpen ? '折叠' : '展开'}
          >
            {drawerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {drawerOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: '100%', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 overflow-hidden min-h-0"
          >
            <div className="h-full">
              {activeTab === 'script' && scriptJob && <ScriptJobPanel job={scriptJob} />}
              {activeTab === 'storyboard' && storyboardJob && (
                <StoryboardJobPanel job={storyboardJob} preview={project?.storyboardProject ?? null} />
              )}
              {activeTab === 'research' && researchJob && research && (
                <ResearchJobPanel job={researchJob} subVideos={research.subVideos} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  progress,
  status,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  progress: number
  status: string
}) {
  const stateColor =
    status === 'completed'
      ? 'text-emerald-400'
      : status === 'failed'
        ? 'text-red-400'
        : status === 'cancelled'
          ? 'text-zinc-500'
          : 'text-accent'

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2.5 py-1 text-xs transition-colors',
        active ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
      )}
    >
      <span className={stateColor}>{icon}</span>
      <span>{label}</span>
      <span className="font-mono text-[10px] text-zinc-500">{(progress * 100).toFixed(0)}%</span>
    </button>
  )
}

function isFinishedScript(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}

function isFinishedStoryboard(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}

function isFinishedResearch(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}
