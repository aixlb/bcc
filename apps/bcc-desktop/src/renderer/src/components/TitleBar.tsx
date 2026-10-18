import { Settings, ChevronRight, X, Minus } from 'lucide-react'
import { useStore, useSelectedProject } from '../lib/store'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { LogoIcon } from './LogoIcon'

export function TitleBar() {
  const { dispatch } = useStore()
  const project = useSelectedProject()

  return (
    <div className="drag-region relative flex h-12 items-center justify-between border-b border-white/[0.05] bg-ink-950/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          onClick={() => dispatch({ type: 'SELECT_PROJECT', id: null })}
          className={cn(
            'no-drag flex items-center gap-2 text-sm font-semibold tracking-wider',
            project && 'cursor-pointer hover:opacity-80'
          )}
        >
          <LogoIcon className="h-7 w-7" />
          <span className="font-medium tracking-tight text-zinc-200">
            XLB Storyboard
          </span>
        </button>

        {project && (
          <div className="no-drag flex items-center gap-2 text-xs text-zinc-500">
            <ChevronRight className="h-3 w-3" />
            <span className="max-w-[280px] truncate text-zinc-300">{project.meta.name}</span>
          </div>
        )}
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          onClick={() => dispatch({ type: 'OPEN_SETTINGS' })}
          className="btn-ghost flex items-center gap-2"
          title="设置"
        >
          <Settings className="h-4 w-4" strokeWidth={1.5} />
        </button>

        {navigator.platform.startsWith('Win') && (
          <div className="ml-1 flex items-center">
            <button
              onClick={() => api().windowMinimize()}
              className="flex h-8 w-10 items-center justify-center rounded text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
              title="最小化"
            >
              <Minus className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button
              onClick={() => api().windowClose()}
              className="flex h-8 w-10 items-center justify-center rounded text-zinc-400 hover:bg-red-500/20 hover:text-red-300"
              title="关闭"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
