import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  RotateCcw,
  FileText,
  Clapperboard,
  Sparkles,
  Loader2,
  FolderOpen,
  Globe,
} from 'lucide-react'
import { useStore, useSelectedProject, type CurrentJob } from '../lib/store'
import { api } from '../lib/api'
import {
  basename,
  cn,
  formatHMS,
  formatProviderLabel,
  providerKeyConfigured,
  resolveProviderLabel,
  type ProviderLabel,
} from '../lib/utils'
import { ResizableSplit } from '../components/ResizableSplit'
import { SceneScoreCurve } from '../components/SceneScoreCurve'
import { StoryboardCutConfirm } from '../components/StoryboardCutConfirm'
import { MasterSelect } from '../components/DropdownSelect'
import { ScriptEditorTab } from './ScriptEditorTab'
import { StoryboardEditorTab } from './StoryboardEditorTab'
import type { CutParams, SceneScoreData, ScriptScene, StoryboardShot } from '@shared/types'

type EditorTab = 'script' | 'storyboard'

export function ProjectView() {
  const project = useSelectedProject()
  const { config, projectsLoaded } = useStore()

  // 空状态：无项目选中
  if (!project) {
    return <EmptyHero loaded={projectsLoaded} />
  }

  // 项目有 videoPath 但 meta 没有 — 异常状态(创建项目时一定有 videoPath)
  if (!project.meta.videoPath) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        当前项目未关联视频。请删除后重新创建。
      </div>
    )
  }

  // 分别按「剧本」「分镜」实际选用的 provider 判断是否缺 key，而不是一律看 gemini
  const scriptKeyMissing = !providerKeyConfigured(config, config?.script_provider)
  const storyboardKeyMissing = !providerKeyConfigured(config, config?.storyboard_provider)
  return (
    <ProjectWorkspace
      key={project.meta.id}
      scriptKeyMissing={scriptKeyMissing}
      storyboardKeyMissing={storyboardKeyMissing}
    />
  )
}

function EmptyHero({ loaded }: { loaded: boolean }) {
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载项目...
      </div>
    )
  }
  return (
    <div className="grain-overlay flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-4xl font-light tracking-tight text-zinc-100">
          把视频变成 <span className="font-medium text-accent">剧本 / 分镜</span>
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          从左侧 <span className="font-medium text-zinc-300">+</span> 新建项目开始
        </p>
      </motion.div>
    </div>
  )
}

function ProjectWorkspace({
  scriptKeyMissing,
  storyboardKeyMissing,
}: {
  scriptKeyMissing: boolean
  storyboardKeyMissing: boolean
}) {
  const project = useSelectedProject()!
  const { dispatch, config } = useStore()

  // 执行前就解析出「剧本 / 分镜」各自会调用哪个 API，用于按钮旁提示，避免用错供应商
  const scriptProvider = resolveProviderLabel(config, config?.script_provider)
  const storyboardProvider = resolveProviderLabel(config, config?.storyboard_provider)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [exportingScript, setExportingScript] = useState(false)
  const [exportingStoryboard, setExportingStoryboard] = useState(false)
  const [exportingHtml, setExportingHtml] = useState(false)
  const [sceneScores, setSceneScores] = useState<SceneScoreData | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const projectId = project.meta.id
  const videoPath = project.meta.videoPath

  // 加载视频 URL
  useEffect(() => {
    if (!videoPath) return
    api().getVideoMediaUrl(videoPath).then(setVideoUrl)
  }, [videoPath])

  // 加载每帧差异曲线（生成分镜后写盘；updatedAt 变化时重新拉取）
  useEffect(() => {
    if (!projectId) {
      setSceneScores(null)
      return
    }
    let cancelled = false
    api()
      .loadProjectSceneScores(projectId)
      .then((d) => {
        if (!cancelled) setSceneScores(d)
      })
      .catch(() => {
        if (!cancelled) setSceneScores(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, project.meta.updatedAt])

  // 选中项目后拉取剧本/分镜表内容（如果有）
  useEffect(() => {
    if (!projectId) return
    if (project.meta.hasScript && !project.scriptResult) {
      api()
        .loadProjectScript(projectId)
        .then((result) => dispatch({ type: 'PROJECT_SCRIPT_LOADED', id: projectId, result }))
        .catch((e) => console.error('loadProjectScript failed', e))
    }
    if (project.meta.hasStoryboard && !project.storyboardProject) {
      api()
        .loadProjectStoryboard(projectId)
        .then((sbProject) => dispatch({ type: 'PROJECT_STORYBOARD_LOADED', id: projectId, sbProject }))
        .catch((e) => console.error('loadProjectStoryboard failed', e))
    }
  }, [projectId, project.meta.hasScript, project.meta.hasStoryboard])

  const hasScript = !!project.scriptResult
  const hasStoryboard = !!project.storyboardProject
  const scriptRunning = project.scriptJob && !isFinished(project.scriptJob.status)
  const storyboardRunning =
    project.storyboardJob &&
    project.storyboardJob.status !== 'completed' &&
    project.storyboardJob.status !== 'failed' &&
    project.storyboardJob.status !== 'cancelled'
  // 切点 CRUD 只在完整分镜已落盘、且没有任何分镜生成/重新识别作业运行时开放。
  const canEditStoryboardCuts = hasStoryboard && !storyboardRunning
  // 生成作业进行中：此时分镜表是内存里的占位脚手架（storyboard.md 尚未落盘），
  // 必须禁用「重新识别 / 切点编辑」，否则会读不到 md 报错、并可能冲掉生成任务卡。
  const storyboardGenerating = !!storyboardRunning && project.storyboardJob?.kind === 'generate'
  // 生成作业处于「切割/截图/等待确认」阶段：分镜表标签页显示切割确认面板
  const storyboardCutting =
    storyboardGenerating &&
    (project.storyboardJob!.status === 'detecting' ||
      project.storyboardJob!.status === 'capturing' ||
      project.storyboardJob!.status === 'awaiting_confirm')

  const [activeTab, setActiveTab] = useState<EditorTab>('script')
  useEffect(() => {
    if (!hasScript && hasStoryboard && activeTab === 'script') {
      setActiveTab('storyboard')
    }
    if (hasScript && !hasStoryboard && activeTab === 'storyboard') {
      setActiveTab('script')
    }
  }, [hasScript, hasStoryboard])

  // 切割完成等待确认时，自动切到分镜表标签页，避免用户停在剧本页错过确认
  const storyboardJobStatus = project.storyboardJob?.status
  useEffect(() => {
    if (storyboardJobStatus === 'awaiting_confirm') setActiveTab('storyboard')
  }, [storyboardJobStatus])

  // 本次生成使用的大师，剧本 / 分镜各自独立：null = 跟随全局配置；
  // 各标签页内的下拉可临时改（只影响本项目页发起的生成，不写回配置）
  const [scriptMasterOverride, setScriptMasterOverride] = useState<string | null>(null)
  const scriptMaster = scriptMasterOverride ?? config?.script_master ?? ''
  const [storyboardMasterOverride, setStoryboardMasterOverride] = useState<string | null>(null)
  const storyboardMaster = storyboardMasterOverride ?? config?.storyboard_master ?? ''

  // 「切割前设置页」：生成分镜/重新切割入口先进这里选方式和参数，点「开始切割」才启动作业
  const [cutSetup, setCutSetup] = useState(false)
  const cutDefaults: CutParams = {
    method: config?.storyboard.cut_method ?? 'smart',
    scene_threshold: config?.storyboard.scene_threshold ?? 0.3,
    smart_hard_min: config?.storyboard.smart_hard_min ?? 5.5,
    smart_hard_ratio: config?.storyboard.smart_hard_ratio ?? 8,
    smart_min_gap: config?.storyboard.smart_min_gap ?? 0.3,
  }

  const activeSceneIdx = useMemo(() => {
    if (!project.scriptResult) return -1
    return findActiveSceneIndex(project.scriptResult.scenes, currentTime)
  }, [project.scriptResult, currentTime])

  const seekTo = (sec: number) => {
    setCurrentTime(sec)
    if (videoRef.current) {
      videoRef.current.currentTime = sec
      videoRef.current.play().catch(() => {})
    }
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) videoRef.current.play()
    else videoRef.current.pause()
  }

  const handleStartScript = async () => {
    if (scriptKeyMissing) return
    try {
      const { jobId } = await api().startGenerate(projectId, videoPath, scriptMaster)
      const job: CurrentJob = {
        jobId,
        videoPath,
        videoName: basename(videoPath),
        durationSec: duration,
        videoSizeBytes: 0,
        startedAt: Date.now(),
        status: 'pending',
        progress: 0,
        message: '准备中...',
        partialScript: '',
        providerLabel: formatProviderLabel(scriptProvider),
        log: [],
      }
      dispatch({ type: 'SCRIPT_JOB_START', projectId, job })
    } catch (e) {
      console.error('startGenerate failed', e)
    }
  }

  // 从「切割前设置页」带着选好的参数启动生成作业；direct=true 为「切割并识别」直通
  const handleStartStoryboard = async (cutParams: CutParams, direct = false) => {
    if (storyboardKeyMissing) return
    try {
      const { jobId } = await api().startStoryboard(projectId, videoPath, cutParams, direct, storyboardMaster)
      dispatch({
        type: 'STORYBOARD_JOB_START',
        projectId,
        job: {
          jobId,
          videoPath,
          status: 'detecting',
          kind: 'generate',
          progress: 0,
          message: '分析镜头切换点...',
          providerLabel: formatProviderLabel(storyboardProvider),
          threshold: cutParams.method === 'scene' ? cutParams.scene_threshold : undefined,
          cutParams,
          capturedFrames: [],
          log: [],
        },
      })
      setCutSetup(false)
    } catch (e) {
      console.error('startStoryboard failed', e)
    }
  }

  const handleOpenFolder = () => {
    api().openProjectDir(projectId)
  }

  // 差异曲线上的切点 CRUD。成功后不做前端乐观改写，统一等待 PROJECT_UPDATED
  // 重新加载 storyboard，避免镜号/区间与后台落盘结果短暂不一致。
  const handleAddShot = async (timeSec: number): Promise<{ ok: boolean; reason?: string }> => {
    try {
      return await api().addStoryboardShot(projectId, timeSec)
    } catch (e) {
      console.error('addStoryboardShot failed', e)
      return { ok: false, reason: '新增失败，请重试' }
    }
  }

  const handleMoveShot = async (
    index: number,
    timeSec: number
  ): Promise<{ ok: boolean; reason?: string }> => {
    try {
      return await api().moveStoryboardShot(projectId, index, timeSec)
    } catch (e) {
      console.error('moveStoryboardShot failed', e)
      return { ok: false, reason: '调整切点失败，请重试' }
    }
  }

  const handleDeleteShot = async (index: number): Promise<{ ok: boolean; reason?: string }> => {
    try {
      return await api().deleteStoryboardShot(projectId, index)
    } catch (e) {
      console.error('deleteStoryboardShot failed', e)
      return { ok: false, reason: '删除切点失败，请重试' }
    }
  }

  const handleExportScript = async () => {
    if (!project.scriptResult) return
    setExportingScript(true)
    try {
      await api().exportScriptDocx(projectId)
    } catch (e: any) {
      console.error('export script failed', e)
    } finally {
      setExportingScript(false)
    }
  }

  const handleExportStoryboard = async () => {
    if (!project.storyboardProject) return
    setExportingStoryboard(true)
    try {
      await api().exportStoryboardXlsx(projectId)
    } catch (e: any) {
      console.error('export storyboard failed', e)
    } finally {
      setExportingStoryboard(false)
    }
  }

  const handleExportHtml = async () => {
    if (!hasScript && !hasStoryboard) return
    setExportingHtml(true)
    try {
      await api().exportProjectHtml(projectId)
    } catch (e: any) {
      console.error('export html failed', e)
    } finally {
      setExportingHtml(false)
    }
  }

  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      {/* 顶部：项目名 + 操作 */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] bg-ink-950/60 px-4 py-2 backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {project.meta.hasScript && <FileText className="h-3.5 w-3.5 text-zinc-500" />}
          {project.meta.hasStoryboard && <Clapperboard className="h-3.5 w-3.5 text-zinc-500" />}
          <span className="font-mono max-w-[260px] truncate" title={videoPath}>
            {basename(videoPath)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasScript && (
            <button
              onClick={handleExportScript}
              disabled={exportingScript}
              className="btn-ghost flex items-center gap-1 text-xs !p-1.5"
              title="导出剧本为 Word"
            >
              <FileText className="h-3.5 w-3.5" />
              {exportingScript ? '导出中...' : '导出剧本'}
            </button>
          )}
          {hasStoryboard && (
            <button
              onClick={handleExportStoryboard}
              disabled={exportingStoryboard}
              className="btn-ghost flex items-center gap-1 text-xs !p-1.5"
              title="导出分镜表为 Excel"
            >
              <Clapperboard className="h-3.5 w-3.5" />
              {exportingStoryboard ? '导出中...' : '导出分镜表'}
            </button>
          )}
          {(hasScript || hasStoryboard) && (
            <button
              onClick={handleExportHtml}
              disabled={exportingHtml}
              className="btn-ghost flex items-center gap-1 text-xs !p-1.5"
              title="导出剧本 + 分镜为可交互网页（单个 HTML 文件）"
            >
              <Globe className="h-3.5 w-3.5" />
              {exportingHtml ? '导出中...' : '导出网页'}
            </button>
          )}
          <div className="h-4 w-px bg-white/[0.08]" />

          <button
            onClick={handleOpenFolder}
            className="btn-ghost flex items-center gap-1 !p-1.5 text-xs"
            title="打开项目文件夹（含 script.md / storyboard.md / frames/）"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 主体：左视频 + 右 tab */}
      <ResizableSplit
        direction="horizontal"
        className="min-h-0"
        first={
          <div className="grid h-full grid-rows-[1fr_auto] overflow-hidden">
            <div className="relative flex items-center justify-center overflow-hidden bg-black min-h-[200px]">
              {videoUrl && (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="h-full w-full object-contain"
                  onClick={togglePlay}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onVolumeChange={(e) => {
                    setVolume(e.currentTarget.volume)
                    setMuted(e.currentTarget.muted)
                  }}
                />
              )}
              <div className="pointer-events-none absolute inset-0 bg-vignette" />
            </div>

            <VideoControls
              videoRef={videoRef}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              volume={volume}
              muted={muted}
              scenes={project.scriptResult?.scenes}
              activeSceneIdx={activeSceneIdx}
              sceneScores={sceneScores}
              shots={project.storyboardProject?.shots}
              canEditShots={!!canEditStoryboardCuts}
              onAddShot={handleAddShot}
              onMoveShot={handleMoveShot}
              onDeleteShot={handleDeleteShot}
              onSeek={seekTo}
              onTogglePlay={togglePlay}
            />
          </div>
        }
        second={
          <div className="flex h-full flex-col bg-ink-900/30">
          <div className="flex shrink-0 border-b border-white/[0.05]">
            <TabButton
              active={activeTab === 'script'}
              onClick={() => setActiveTab('script')}
              icon={<FileText className="h-3.5 w-3.5" />}
              label="剧本"
              hasContent={hasScript}
              running={!!scriptRunning}
            />
            <TabButton
              active={activeTab === 'storyboard'}
              onClick={() => setActiveTab('storyboard')}
              icon={<Clapperboard className="h-3.5 w-3.5" />}
              label="分镜表"
              hasContent={hasStoryboard}
              running={!!storyboardRunning}
            />
          </div>

          {activeTab === 'script' &&
            (hasScript ? (
              <ScriptEditorTab
                projectId={project.meta.id}
                result={project.scriptResult!}
                currentTime={currentTime}
                activeSceneIdx={activeSceneIdx}
                onSceneClick={seekTo}
                onRegenerate={scriptKeyMissing || scriptRunning ? undefined : handleStartScript}
                regenerateProviderLabel={formatProviderLabel(scriptProvider) || undefined}
                masterSelect={
                  <MasterSelect kind="script" value={scriptMaster} onChange={setScriptMasterOverride} />
                }
              />
            ) : (
              <TabEmpty
                icon={<FileText className="h-7 w-7" />}
                title="还没有剧本"
                desc="把这段视频生成带时间戳的标准剧本格式"
                running={!!scriptRunning}
                onClick={handleStartScript}
                disabled={scriptKeyMissing}
                label="生成剧本"
                provider={scriptProvider}
                extra={
                  <MasterSelect kind="script" value={scriptMaster} onChange={setScriptMasterOverride} />
                }
              />
            ))}

          {activeTab === 'storyboard' &&
            (storyboardCutting ? (
              <StoryboardCutConfirm
                job={project.storyboardJob!}
                currentTime={currentTime}
                durationSec={duration}
                onSeek={seekTo}
              />
            ) : cutSetup ? (
              <StoryboardCutConfirm
                defaults={cutDefaults}
                currentTime={currentTime}
                durationSec={duration}
                onStart={handleStartStoryboard}
                onCancelSetup={() => setCutSetup(false)}
                onSeek={seekTo}
                masterSelect={
                  <MasterSelect
                    kind="storyboard"
                    value={storyboardMaster}
                    onChange={setStoryboardMasterOverride}
                  />
                }
              />
            ) : hasStoryboard ? (
              <StoryboardEditorTab
                projectId={project.meta.id}
                project={project.storyboardProject!}
                currentTime={currentTime}
                generating={!!storyboardGenerating}
                onShotClick={seekTo}
                onRecut={storyboardKeyMissing || storyboardRunning ? undefined : () => setCutSetup(true)}
              />
            ) : (
              <TabEmpty
                icon={<Clapperboard className="h-7 w-7" />}
                title="还没有分镜表"
                desc="自动检测镜头切换点，逐镜分析画面、台词、运镜"
                running={!!storyboardRunning}
                onClick={() => setCutSetup(true)}
                disabled={storyboardKeyMissing}
                label="生成分镜表"
                provider={storyboardProvider}
              />
            ))}
        </div>
        }
        defaultSize={520}
        minSize={280}
      />
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  hasContent,
  running,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  hasContent: boolean
  running: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs transition-colors',
        active
          ? 'border-b border-accent/80 bg-accent/[0.03] text-accent'
          : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300'
      )}
    >
      {icon}
      {label}
      {running ? (
        <Loader2 className="h-3 w-3 animate-spin text-accent" />
      ) : hasContent ? (
        <span className="h-1 w-1 rounded-full bg-emerald-400" />
      ) : (
        <span className="h-1 w-1 rounded-full bg-zinc-700" />
      )}
    </button>
  )
}

function TabEmpty({
  icon,
  title,
  desc,
  running,
  onClick,
  disabled,
  label,
  provider,
  extra,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  running: boolean
  onClick: () => void
  disabled: boolean
  label: string
  provider?: ProviderLabel | null
  /** 提供者徽标下方的附加控件（如大师选择下拉） */
  extra?: React.ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xs text-center"
      >
        {/* 固定尺寸 + flex 居中，保证两个空状态的图标位置/大小完全一致 */}
        <div className="mx-auto mb-4 flex h-8 w-8 items-center justify-center text-zinc-600">
          {icon}
        </div>
        <div className="text-sm text-zinc-200">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-zinc-500">{desc}</div>
        <button
          onClick={onClick}
          disabled={disabled || running}
          className="btn-primary mt-4 inline-flex items-center gap-1.5 text-xs"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {running ? '正在生成…见底部抽屉' : label}
        </button>
        {disabled ? (
          <div className="mt-2 text-[11px] text-amber-300">先在设置中填 API Key</div>
        ) : provider ? (
          <div
            className="mx-auto mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.07] bg-black/30 px-2.5 py-1"
            title={`将调用 ${provider.name} 模型 ${provider.model}`}
          >
            <Sparkles className="h-3 w-3 shrink-0 text-accent" />
            <span className="text-[11px] text-zinc-400">将使用</span>
            <span className="text-[11px] font-medium text-zinc-200">{provider.name}</span>
            {provider.model && (
              <span className="truncate font-mono text-[10px] text-zinc-500">· {provider.model}</span>
            )}
          </div>
        ) : null}
        {!disabled && extra && <div className="mt-2 flex justify-center">{extra}</div>}
      </motion.div>
    </div>
  )
}

function VideoControls({
  videoRef,
  currentTime,
  duration,
  isPlaying,
  volume,
  muted,
  scenes,
  activeSceneIdx,
  sceneScores,
  shots,
  canEditShots,
  onAddShot,
  onMoveShot,
  onDeleteShot,
  onSeek,
  onTogglePlay,
}: {
  videoRef: React.RefObject<HTMLVideoElement>
  currentTime: number
  duration: number
  isPlaying: boolean
  volume: number
  muted: boolean
  scenes?: ScriptScene[]
  activeSceneIdx: number
  sceneScores?: SceneScoreData | null
  shots?: StoryboardShot[]
  canEditShots: boolean
  onAddShot: (sec: number) => Promise<{ ok: boolean; reason?: string } | void>
  onMoveShot: (index: number, sec: number) => Promise<{ ok: boolean; reason?: string } | void>
  onDeleteShot: (index: number) => Promise<{ ok: boolean; reason?: string } | void>
  onSeek: (sec: number) => void
  onTogglePlay: () => void
}) {
  return (
    <div className="shrink-0 border-t border-white/[0.05] bg-ink-950/80 px-4 py-3">
      <div className="relative">
        <div
          className="relative h-1.5 cursor-pointer overflow-hidden rounded-full bg-white/[0.06]"
          onClick={(e) => {
            // 用 currentTarget（轨道本身）而非 target：已播放的填充层覆盖在轨道左段上，
            // 点它会拿到更短的填充宽度，导致 x/width 放大、跳到错误时间。
            const rect = e.currentTarget.getBoundingClientRect()
            const x = e.clientX - rect.left
            onSeek((x / rect.width) * duration)
          }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
          {duration > 0 &&
            scenes?.map((s, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  onSeek(s.startSec)
                }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform"
                style={{ left: `${(s.startSec / duration) * 100}%` }}
                title={s.heading}
              >
                <div
                  className={cn(
                    'h-2 w-2 rounded-full border transition-all',
                    i === activeSceneIdx
                      ? 'border-white bg-accent shadow-[0_0_8px_rgba(212,163,115,0.8)]'
                      : 'border-zinc-700 bg-zinc-500'
                  )}
                />
              </button>
            ))}
        </div>

        {/* 判定信号曲线（与时间轴同步对齐，便于排查镜头切分；右键可手动加分镜） */}
        {sceneScores && sceneScores.points.length > 1 && duration > 0 && (
          <SceneScoreCurve
            data={sceneScores}
            duration={duration}
            currentTime={currentTime}
            shots={shots}
            canEditShots={canEditShots}
            onAddShot={onAddShot}
            onMoveShot={onMoveShot}
            onDeleteShot={onDeleteShot}
            onSeek={onSeek}
          />
        )}

        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-zinc-500">
          <span>{formatHMS(currentTime)}</span>
          <span>{formatHMS(duration)}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button onClick={onTogglePlay} className="btn-ghost !p-1.5">
          {isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
        </button>
        <button
          onClick={() => onSeek(Math.max(0, currentTime - 5))}
          className="btn-ghost !p-1.5"
          title="后退 5 秒"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (videoRef.current) videoRef.current.muted = !videoRef.current.muted
            }}
            className="btn-ghost !p-1.5"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (videoRef.current) {
                videoRef.current.volume = v
                videoRef.current.muted = v === 0
              }
            }}
            className="w-20 accent-amber-500"
          />
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          {activeSceneIdx >= 0 && scenes?.[activeSceneIdx] && (
            <span className="font-mono text-accent">
              {scenes[activeSceneIdx].number || `Scene ${activeSceneIdx + 1}`}
            </span>
          )}
          <button
            onClick={() => videoRef.current?.requestFullscreen()}
            className="btn-ghost !p-1.5"
            title="全屏"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function findActiveSceneIndex(scenes: ScriptScene[], currentTime: number): number {
  if (scenes.length === 0) return -1
  let lo = 0
  let hi = scenes.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (scenes[mid].startSec <= currentTime) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

function isFinished(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}
