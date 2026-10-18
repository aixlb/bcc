import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  StoreProvider,
  useSelectedProject,
  useSelectedResearch,
  useStore,
} from './lib/store'
import { TitleBar } from './components/TitleBar'
import { PreloadGuard } from './components/PreloadGuard'
import { Sidebar } from './components/Sidebar'
import { JobDrawer } from './components/JobDrawer'
import { SettingsModal } from './components/SettingsModal'
import { ResizableSplit } from './components/ResizableSplit'
import { ProjectView } from './pages/ProjectView'
import { ResearchView } from './pages/ResearchView'
import { BootScreen } from './components/BootScreen'
import { LogoIcon } from './components/LogoIcon'
import { Loader2 } from 'lucide-react'

function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)

  const effectiveSidebarWidth = sidebarCollapsed ? 48 : sidebarWidth

  const handleSidebarResize = (size: number) => {
    const newSize = Math.max(150, Math.min(400, size))
    setSidebarWidth(newSize)
  }

  return (
    <div className="scanlines flex h-full flex-col">
      <TitleBar />
      <div className="relative flex flex-1 overflow-hidden">
        <div style={{ width: effectiveSidebarWidth, minWidth: effectiveSidebarWidth }} className="shrink-0">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>
        <div
          onMouseDown={(e) => {
            if (sidebarCollapsed) {
              setSidebarCollapsed(false)
              return
            }
            const startX = e.clientX
            const startW = sidebarWidth
            const onMove = (ev: MouseEvent) => {
              handleSidebarResize(startW + ev.clientX - startX)
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
          className="shrink-0 w-1 cursor-col-resize bg-white/[0.05] hover:bg-accent/40 transition-colors"
        />
        <MainArea />
        <SettingsModal />
      </div>
    </div>
  )
}

function MainArea() {
  const project = useSelectedProject()
  const research = useSelectedResearch()
  const { projectsLoaded, researchLoaded } = useStore()

  // 研究优先：选中研究项目时显示研究页面
  if (research) {
    return (
      <ResizableSplit
        direction="vertical"
        className="min-w-0 flex-1"
        first={
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <ResearchView />
          </main>
        }
        second={<JobDrawer />}
        defaultSize={600}
        minSize={80}
      />
    )
  }

  // 没有选中项目：欢迎页 / 加载
  if (!project) {
    const loaded = projectsLoaded && researchLoaded
    if (!loaded) {
      return (
        <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载项目...
          </div>
        </main>
      )
    }
    return (
      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
        <div className="text-center">
          <motion.div
            className="mx-auto mb-6 flex h-24 w-24 items-center justify-center"
            initial={{ scale: 0, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 0.9 }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 12,
              mass: 0.8,
              delay: 0.1,
            }}
          >
            <LogoIcon className="h-24 w-24" />
          </motion.div>
          <motion.h1
            className="text-3xl font-light tracking-tight text-zinc-200"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            包拆拆
          </motion.h1>
          <motion.p
            className="mt-3 text-sm text-zinc-600"
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.6 }}
          >
            从左侧 <span className="font-medium text-zinc-400">+</span> 新建项目或研究开始
          </motion.p>
        </div>
      </main>
    )
  }

  return (
    <ResizableSplit
      direction="vertical"
      className="min-w-0 flex-1"
      first={
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <ProjectView />
        </main>
      }
      second={<JobDrawer />}
      defaultSize={600}
      minSize={80}
    />
  )
}

export function App() {
  const [booted, setBooted] = useState(false)

  return (
    <>
      <AnimatePresence>
        {!booted && <BootScreen onComplete={() => setBooted(true)} />}
      </AnimatePresence>
      <PreloadGuard>
        <StoreProvider>
          <AppShell />
        </StoreProvider>
      </PreloadGuard>
    </>
  )
}
