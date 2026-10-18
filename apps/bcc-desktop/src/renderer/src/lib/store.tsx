/**
 * 应用全局 store - 使用 React Context + useReducer
 */
import { createContext, useContext, useReducer, useEffect, useMemo, type ReactNode } from 'react'
import type {
  AppConfig,
  CutParams,
  ResearchCompletedEvent,
  ResearchFailedEvent,
  ResearchJob,
  ResearchMeta,
  ResearchProgressEvent,
  ResearchSubVideo,
  ProgressEvent,
  Project,
  SceneScoreData,
  ScriptResult,
  StoryboardCapturedFrame,
  StoryboardProgressEvent,
  StoryboardScaffoldEvent,
  StoryboardProject,
  StoryboardShot,
} from '@shared/types'

export interface CurrentJob {
  jobId: string
  videoPath: string
  videoName: string
  durationSec: number
  videoSizeBytes: number
  startedAt: number
  status: ProgressEvent['status']
  progress: number
  message: string
  partialScript: string
  currentSegment?: number
  totalSegments?: number
  /** 已消耗 token 数（Gemini usageMetadata.totalTokenCount） */
  tokensUsed?: number
  /** 本次作业使用的 API 标签，如 "Gemini · gemini-3-flash-preview"（执行前快照） */
  providerLabel?: string
  /** 实时日志条目，最多保留 30 条 */
  log: Array<{ ts: number; text: string }>
}

export interface StoryboardJob {
  jobId: string
  videoPath: string
  status: StoryboardProgressEvent['status']
  /** 作业类型：完整生成 / 复用截图重新识别（决定任务卡的展示样式） */
  kind: 'generate' | 'reanalyze'
  progress: number
  message: string
  currentShot?: number
  totalShots?: number
  /** 本次作业使用的 API 标签（执行前快照） */
  providerLabel?: string
  /** 本次拆分使用的镜头切换检测阈值 */
  threshold?: number
  /** 本次切割使用的方式与参数快照（确认面板展示/重切回填） */
  cutParams?: CutParams
  /** 截图采样阶段已采样到的关键帧（当前这一轮，边采样边累积） */
  capturedFrames: StoryboardCapturedFrame[]
  /** 各切割方式最近一次完成的切割结果（仅本次生成会话内有效；切换方式时直接展示，不重切） */
  cutResults?: Partial<
    Record<CutParams['method'], { frames: StoryboardCapturedFrame[]; sceneSeries?: SceneScoreData }>
  >
  /** 镜头检测完成后下发的帧差异曲线，供截图核对阶段展示（与编辑器同款曲线） */
  sceneSeries?: SceneScoreData
  log: Array<{ ts: number; text: string }>
}

export interface ProjectState {
  meta: Project
  scriptResult: ScriptResult | null
  storyboardProject: StoryboardProject | null
  scriptJob: CurrentJob | null
  storyboardJob: StoryboardJob | null
}

/** 风格研究 in-memory state */
export interface ResearchState {
  meta: ResearchMeta
  subVideos: ResearchSubVideo[]
  job: ResearchJob | null
  styleGuide: string | null
}

export type DrawerTab = 'script' | 'storyboard' | 'research'

export interface AppState {
  config: AppConfig | null
  projects: ProjectState[]
  selectedProjectId: string | null
  jobIdToProjectId: Record<string, string>
  projectsLoaded: boolean
  settingsOpen: boolean
  drawerOpen: boolean
  drawerTab: DrawerTab

  // 风格研究
  research: ResearchState[]
  selectedResearchId: string | null
  jobIdToResearchId: Record<string, string>
  researchLoaded: boolean
}

type Action =
  | { type: 'SET_CONFIG'; config: AppConfig }
  | { type: 'PROJECTS_LOADED'; projects: Project[] }
  | { type: 'PROJECT_CREATED'; project: Project; select?: boolean }
  | { type: 'PROJECT_RENAMED'; project: Project }
  | { type: 'PROJECT_DELETED'; id: string }
  | { type: 'PROJECT_META_RELOADED'; project: Project }
  | { type: 'SELECT_PROJECT'; id: string | null }
  | { type: 'PROJECT_SCRIPT_LOADED'; id: string; result: ScriptResult | null }
  | { type: 'PROJECT_STORYBOARD_LOADED'; id: string; sbProject: StoryboardProject | null }
  | { type: 'SCRIPT_JOB_START'; projectId: string; job: CurrentJob }
  | { type: 'SCRIPT_PROGRESS'; ev: ProgressEvent }
  | { type: 'SCRIPT_COMPLETED'; result: ScriptResult }
  | { type: 'SCRIPT_FAILED'; jobId: string; message: string }
  | { type: 'SCRIPT_JOB_CLEAR'; projectId: string }
  | { type: 'STORYBOARD_JOB_START'; projectId: string; job: StoryboardJob }
  | { type: 'STORYBOARD_PROGRESS'; ev: StoryboardProgressEvent }
  | { type: 'STORYBOARD_COMPLETED'; jobId: string }
  | { type: 'STORYBOARD_FAILED'; jobId: string; message: string }
  | { type: 'STORYBOARD_JOB_CLEAR'; projectId: string }
  | { type: 'STORYBOARD_SHOT_UPDATED'; projectId: string; index: number; shot: StoryboardShot }
  | { type: 'STORYBOARD_SCAFFOLD'; ev: StoryboardScaffoldEvent }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'SET_DRAWER_OPEN'; open: boolean }
  | { type: 'SET_DRAWER_TAB'; tab: DrawerTab }

  // 研究
  | { type: 'RESEARCHES_LOADED'; items: Array<{ meta: ResearchMeta; subVideos: ResearchSubVideo[] }> }
  | { type: 'RESEARCH_CREATED'; meta: ResearchMeta; subVideos: ResearchSubVideo[] }
  | { type: 'RESEARCH_RENAMED'; meta: ResearchMeta }
  | { type: 'RESEARCH_VIDEOS_ADDED'; id: string; meta: ResearchMeta; newSubVideos: ResearchSubVideo[] }
  | { type: 'RESEARCH_DELETED'; id: string }
  | { type: 'RESEARCH_META_RELOADED'; meta: ResearchMeta; subVideos: ResearchSubVideo[] }
  | { type: 'RESEARCH_STYLE_GUIDE_LOADED'; id: string; styleGuide: string | null }
  | { type: 'SELECT_RESEARCH'; id: string | null }
  | { type: 'RESEARCH_JOB_START'; id: string; job: ResearchJob }
  | { type: 'RESEARCH_PROGRESS'; ev: ResearchProgressEvent }
  | { type: 'RESEARCH_COMPLETED'; ev: ResearchCompletedEvent }
  | { type: 'RESEARCH_FAILED'; jobId: string; message: string }
  | { type: 'RESEARCH_JOB_CLEAR'; id: string }

const initialState: AppState = {
  config: null,
  projects: [],
  selectedProjectId: null,
  jobIdToProjectId: {},
  projectsLoaded: false,
  settingsOpen: false,
  drawerOpen: false,
  drawerTab: 'script',

  research: [],
  selectedResearchId: null,
  jobIdToResearchId: {},
  researchLoaded: false,
}

function makeProjectState(meta: Project): ProjectState {
  return {
    meta,
    scriptResult: null,
    storyboardProject: null,
    scriptJob: null,
    storyboardJob: null,
  }
}

function makeResearchState(
  meta: ResearchMeta,
  subVideos: ResearchSubVideo[]
): ResearchState {
  return {
    meta,
    subVideos,
    job: null,
    styleGuide: null,
  }
}

function updateProject(
  state: AppState,
  id: string,
  fn: (p: ProjectState) => ProjectState
): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.meta.id === id ? fn(p) : p)),
  }
}

function updateResearch(
  state: AppState,
  id: string,
  fn: (d: ResearchState) => ResearchState
): AppState {
  return {
    ...state,
    research: state.research.map((d) => (d.meta.id === id ? fn(d) : d)),
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: action.config }

    case 'PROJECTS_LOADED':
      return {
        ...state,
        projectsLoaded: true,
        projects: action.projects.map((meta) => {
          const existing = state.projects.find((p) => p.meta.id === meta.id)
          if (existing) return { ...existing, meta }
          return makeProjectState(meta)
        }),
      }

    case 'PROJECT_CREATED': {
      const exists = state.projects.some((p) => p.meta.id === action.project.id)
      const projects = exists
        ? state.projects.map((p) => (p.meta.id === action.project.id ? { ...p, meta: action.project } : p))
        : [makeProjectState(action.project), ...state.projects]
      return {
        ...state,
        projects,
        selectedProjectId: action.select ? action.project.id : state.selectedProjectId,
      }
    }

    case 'PROJECT_RENAMED':
      return updateProject(state, action.project.id, (p) => ({ ...p, meta: action.project }))

    case 'PROJECT_DELETED': {
      const projects = state.projects.filter((p) => p.meta.id !== action.id)
      const selectedProjectId =
        state.selectedProjectId === action.id ? null : state.selectedProjectId
      return { ...state, projects, selectedProjectId }
    }

    case 'PROJECT_META_RELOADED':
      return updateProject(state, action.project.id, (p) => ({ ...p, meta: action.project }))

    case 'SELECT_PROJECT':
      return { ...state, selectedProjectId: action.id, selectedResearchId: null }

    case 'PROJECT_SCRIPT_LOADED':
      return updateProject(state, action.id, (p) => ({ ...p, scriptResult: action.result }))

    case 'PROJECT_STORYBOARD_LOADED':
      return updateProject(state, action.id, (p) => ({ ...p, storyboardProject: action.sbProject }))

    case 'SCRIPT_JOB_START':
      return {
        ...updateProject(state, action.projectId, (p) => ({
          ...p,
          scriptJob: action.job,
          scriptResult: null,
        })),
        jobIdToProjectId: { ...state.jobIdToProjectId, [action.job.jobId]: action.projectId },
        drawerOpen: true,
        drawerTab: 'script',
      }

    case 'SCRIPT_PROGRESS': {
      const projectId = state.jobIdToProjectId[action.ev.jobId]
      if (!projectId) return state
      return updateProject(state, projectId, (p) => {
        if (!p.scriptJob || p.scriptJob.jobId !== action.ev.jobId) return p
        const ev = action.ev
        const newLog =
          ev.message && ev.message !== p.scriptJob.message
            ? [...p.scriptJob.log, { ts: Date.now(), text: ev.message }].slice(-30)
            : p.scriptJob.log
        return {
          ...p,
          scriptJob: {
            ...p.scriptJob,
            status: ev.status,
            progress: ev.progress,
            message: ev.message,
            partialScript: ev.partialScript ?? p.scriptJob.partialScript,
            currentSegment: ev.currentSegment,
            totalSegments: ev.totalSegments,
            tokensUsed: ev.tokensUsed ?? p.scriptJob.tokensUsed,
            videoSizeBytes: ev.videoSizeBytes ?? p.scriptJob.videoSizeBytes,
            log: newLog,
          },
        }
      })
    }

    case 'SCRIPT_COMPLETED': {
      const projectId = state.jobIdToProjectId[action.result.jobId]
      if (!projectId) return state
      return updateProject(state, projectId, (p) => ({
        ...p,
        scriptResult: action.result,
        scriptJob: p.scriptJob
          ? {
              ...p.scriptJob,
              status: 'completed',
              progress: 1,
              partialScript: action.result.script,
            }
          : null,
      }))
    }

    case 'SCRIPT_FAILED': {
      const projectId = state.jobIdToProjectId[action.jobId]
      if (!projectId) return state
      return updateProject(state, projectId, (p) =>
        p.scriptJob
          ? { ...p, scriptJob: { ...p.scriptJob, status: 'failed', message: action.message } }
          : p
      )
    }

    case 'SCRIPT_JOB_CLEAR':
      return updateProject(state, action.projectId, (p) => ({ ...p, scriptJob: null }))

    case 'STORYBOARD_JOB_START':
      return {
        ...updateProject(state, action.projectId, (p) => ({ ...p, storyboardJob: action.job })),
        jobIdToProjectId: { ...state.jobIdToProjectId, [action.job.jobId]: action.projectId },
        drawerOpen: true,
        drawerTab: 'storyboard',
      }

    case 'STORYBOARD_PROGRESS': {
      let projectId = state.jobIdToProjectId[action.ev.jobId]
      let baseState = state
      // 「重新识别」作业没有 JOB_START，凭首个进度事件即时建任务卡
      if (!projectId && action.ev.kind === 'reanalyze' && action.ev.projectId) {
        projectId = action.ev.projectId
        baseState = {
          ...updateProject(state, projectId, (p) => ({
            ...p,
            storyboardJob: {
              jobId: action.ev.jobId,
              videoPath: p.meta.videoPath,
              kind: 'reanalyze',
              status: action.ev.status,
              progress: action.ev.progress,
              message: action.ev.message,
              currentShot: action.ev.currentShot,
              totalShots: action.ev.totalShots,
              providerLabel: action.ev.providerLabel,
              capturedFrames: [],
              log: [],
            },
          })),
          jobIdToProjectId: { ...state.jobIdToProjectId, [action.ev.jobId]: projectId },
          drawerOpen: true,
          drawerTab: 'storyboard',
        }
      }
      if (!projectId) return state
      return updateProject(baseState, projectId, (p) => {
        if (!p.storyboardJob || p.storyboardJob.jobId !== action.ev.jobId) return p
        const ev = action.ev
        const newLog =
          ev.message && ev.message !== p.storyboardJob.message
            ? [...p.storyboardJob.log, { ts: Date.now(), text: ev.message }].slice(-50)
            : p.storyboardJob.log
        // 重切新一轮：先清空上一轮积累的截图/曲线
        const baseFrames = ev.resetFrames ? [] : p.storyboardJob.capturedFrames
        const cf = ev.capturedFrame
        const accumulatedFrames =
          cf && !baseFrames.some((f) => f.index === cf.index) ? [...baseFrames, cf] : baseFrames
        const roundMethod = (ev.cutParams ?? p.storyboardJob.cutParams)?.method
        const replacesCurrentPreview = !!ev.cutResult && ev.cutResult.method === roundMethod
        const capturedFrames = replacesCurrentPreview
          ? ev.cutResult!.frames
          : accumulatedFrames
        const sceneSeries = replacesCurrentPreview
          ? ev.cutResult!.sceneSeries ?? p.storyboardJob.sceneSeries
          : ev.resetFrames
            ? undefined
            : ev.sceneSeries ?? p.storyboardJob.sceneSeries
        // 一轮切割完成（进入等待确认）：把该方式的结果存进按方式缓存，切换方式时可直接展示
        const cutResults = ev.cutResult
          ? {
              ...p.storyboardJob.cutResults,
              [ev.cutResult.method]: {
                frames: ev.cutResult.frames,
                sceneSeries:
                  ev.cutResult.sceneSeries ??
                  p.storyboardJob.cutResults?.[ev.cutResult.method]?.sceneSeries,
              },
            }
          : ev.status === 'awaiting_confirm' && roundMethod
            ? {
                ...p.storyboardJob.cutResults,
                [roundMethod]: { frames: capturedFrames, sceneSeries },
              }
            : p.storyboardJob.cutResults
        return {
          ...p,
          storyboardJob: {
            ...p.storyboardJob,
            status: ev.status,
            progress: ev.progress,
            message: ev.message,
            currentShot: ev.cutResult ? p.storyboardJob.currentShot : ev.currentShot,
            totalShots: ev.cutResult ? p.storyboardJob.totalShots : ev.totalShots,
            threshold: ev.threshold ?? p.storyboardJob.threshold,
            cutParams: ev.cutParams ?? p.storyboardJob.cutParams,
            capturedFrames,
            cutResults,
            sceneSeries,
            log: newLog,
          },
        }
      })
    }

    case 'STORYBOARD_COMPLETED': {
      const projectId = state.jobIdToProjectId[action.jobId]
      if (!projectId) return state
      return updateProject(state, projectId, (p) => ({
        ...p,
        storyboardJob: p.storyboardJob
          ? { ...p.storyboardJob, status: 'completed', progress: 1, message: '完成' }
          : null,
      }))
    }

    case 'STORYBOARD_FAILED': {
      const projectId = state.jobIdToProjectId[action.jobId]
      if (!projectId) return state
      return updateProject(state, projectId, (p) =>
        p.storyboardJob
          ? {
              ...p,
              storyboardJob: { ...p.storyboardJob, status: 'failed', message: action.message },
            }
          : p
      )
    }

    case 'STORYBOARD_JOB_CLEAR':
      return updateProject(state, action.projectId, (p) => ({ ...p, storyboardJob: null }))

    case 'STORYBOARD_SHOT_UPDATED':
      return updateProject(state, action.projectId, (p) => {
        if (!p.storyboardProject) return p
        if (action.index < 0 || action.index >= p.storyboardProject.shots.length) return p
        const shots = p.storyboardProject.shots.slice()
        shots[action.index] = action.shot
        return { ...p, storyboardProject: { ...p.storyboardProject, shots } }
      })

    case 'STORYBOARD_SCAFFOLD':
      // 生成阶段下发的占位脚手架：把主编辑器的分镜表先铺出来（内容随后逐镜填充）。
      // 仅放进内存；磁盘真实状态由 PROJECT_UPDATED（完成/取消/失败）覆盖。
      return updateProject(state, action.ev.projectId, (p) => ({
        ...p,
        storyboardProject: {
          id: action.ev.projectId,
          videoPath: p.meta.videoPath,
          createdAt: Date.now(),
          shots: action.ev.shots,
          framePaths: action.ev.framePaths,
        },
      }))

    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true }

    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false }

    case 'SET_DRAWER_OPEN':
      return { ...state, drawerOpen: action.open }

    case 'SET_DRAWER_TAB':
      return { ...state, drawerTab: action.tab }

    // ============ 研究 ============

    case 'RESEARCHES_LOADED': {
      const byId = new Map(state.research.map((d) => [d.meta.id, d]))
      const next = action.items.map(({ meta, subVideos }) => {
        const existing = byId.get(meta.id)
        if (existing) {
          return {
            ...existing,
            meta,
            subVideos: subVideos.map((sv) => {
              const cur = existing.subVideos.find((s) => s.videoPath === sv.videoPath)
              // 保留运行中的 in-memory 状态
              if (existing.job && cur && !isFinishedResearch(existing.job.status)) {
                return cur
              }
              return sv
            }),
            styleGuide: existing.styleGuide, // 保留已加载的
          }
        }
        return makeResearchState(meta, subVideos)
      })
      return { ...state, researchLoaded: true, research: next }
    }

    case 'RESEARCH_CREATED': {
      const exists = state.research.some((d) => d.meta.id === action.meta.id)
      const newDs = makeResearchState(action.meta, action.subVideos)
      const research = exists
        ? state.research.map((d) => (d.meta.id === action.meta.id ? newDs : d))
        : [newDs, ...state.research]
      return {
        ...state,
        research,
        selectedResearchId: action.meta.id,
        selectedProjectId: null,
      }
    }

    case 'RESEARCH_RENAMED':
      return updateResearch(state, action.meta.id, (d) => ({ ...d, meta: action.meta }))

    case 'RESEARCH_VIDEOS_ADDED': {
      return updateResearch(state, action.id, (d) => {
        // 旧 hasStyleGuide=true 被 flip 成 false → 缓存的风格指南作废
        const styleGuideInvalidated = d.meta.hasStyleGuide && !action.meta.hasStyleGuide
        return {
          ...d,
          meta: action.meta,
          subVideos: [...d.subVideos, ...action.newSubVideos],
          styleGuide: styleGuideInvalidated ? null : d.styleGuide,
        }
      })
    }

    case 'RESEARCH_DELETED': {
      const research = state.research.filter((d) => d.meta.id !== action.id)
      const selectedResearchId =
        state.selectedResearchId === action.id ? null : state.selectedResearchId
      return { ...state, research, selectedResearchId }
    }

    case 'RESEARCH_META_RELOADED':
      return updateResearch(state, action.meta.id, (d) => ({
        ...d,
        meta: action.meta,
        subVideos: action.subVideos,
      }))

    case 'RESEARCH_STYLE_GUIDE_LOADED':
      return updateResearch(state, action.id, (d) => ({ ...d, styleGuide: action.styleGuide }))

    case 'SELECT_RESEARCH':
      return {
        ...state,
        selectedResearchId: action.id,
        selectedProjectId: action.id ? null : state.selectedProjectId,
      }

    case 'RESEARCH_JOB_START':
      return {
        ...updateResearch(state, action.id, (d) => ({
          ...d,
          job: action.job,
          styleGuide: null, // 重新开始 → 清空缓存
        })),
        jobIdToResearchId: {
          ...state.jobIdToResearchId,
          [action.job.jobId]: action.id,
        },
        drawerOpen: true,
        drawerTab: 'research',
      }

    case 'RESEARCH_PROGRESS': {
      const id = state.jobIdToResearchId[action.ev.jobId]
      if (!id) return state
      return updateResearch(state, id, (d) => {
        if (!d.job || d.job.jobId !== action.ev.jobId) return d
        const ev = action.ev
        const newLog =
          ev.message && ev.message !== d.job.message
            ? [...d.job.log, { ts: Date.now(), text: ev.message }].slice(-50)
            : d.job.log
        // 更新对应 sub 的进度
        const subVideos = d.subVideos.map((sv) => {
          if (ev.subVideoPath && sv.videoPath === ev.subVideoPath) {
            return {
              ...sv,
              status: ev.subStatus ?? sv.status,
              progress: ev.subProgress ?? sv.progress,
              message: ev.message,
            }
          }
          return sv
        })
        return {
          ...d,
          subVideos,
          job: {
            ...d.job,
            status: ev.status,
            progress: ev.progress,
            message: ev.message,
            currentSub: ev.currentSub,
            totalSubs: ev.totalSubs,
            partialStyleGuide: ev.partialStyleGuide ?? d.job.partialStyleGuide,
            log: newLog,
          },
        }
      })
    }

    case 'RESEARCH_COMPLETED': {
      const id = state.jobIdToResearchId[action.ev.jobId]
      if (!id) return state
      return updateResearch(state, id, (d) => ({
        ...d,
        meta: action.ev.meta,
        styleGuide: action.ev.styleGuide,
        job: d.job
          ? {
              ...d.job,
              status: 'completed',
              progress: 1,
              message: '完成',
              partialStyleGuide: action.ev.styleGuide,
            }
          : null,
      }))
    }

    case 'RESEARCH_FAILED': {
      const id = state.jobIdToResearchId[action.jobId]
      if (!id) return state
      return updateResearch(state, id, (d) =>
        d.job
          ? { ...d, job: { ...d.job, status: 'failed', message: action.message } }
          : d
      )
    }

    case 'RESEARCH_JOB_CLEAR':
      return updateResearch(state, action.id, (d) => ({ ...d, job: null }))

    default:
      return state
  }
}

function isFinishedResearch(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

interface ContextValue extends AppState {
  dispatch: React.Dispatch<Action>
}

const StoreCtx = createContext<ContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    const v2s = window.v2s
    if (!v2s) {
      return
    }

    v2s
      .getConfig()
      .then((cfg) => dispatch({ type: 'SET_CONFIG', config: cfg }))
      .catch((e) => console.error('load config failed', e))

    v2s
      .listProjects()
      .then((projects) => dispatch({ type: 'PROJECTS_LOADED', projects }))
      .catch((e) => console.error('load projects failed', e))

    v2s.research
      .listResearch()
      .then(async (metas) => {
        const items = await Promise.all(
          metas.map(async (m) => {
            try {
              const loaded = await v2s.research.loadResearch(m.id)
              return {
                meta: m,
                subVideos: loaded?.subVideos ?? m.videoPaths.map((vp) => ({
                  videoPath: vp,
                  videoName: vp.replace(/\\/g, '/').split('/').pop() ?? vp,
                  status: 'pending' as const,
                  progress: 0,
                  message: '',
                  shots: 0,
                })),
              }
            } catch {
              return { meta: m, subVideos: [] as ResearchSubVideo[] }
            }
          })
        )
        dispatch({ type: 'RESEARCHES_LOADED', items })
      })
      .catch((e) => console.error('load research failed', e))

    const off1 = v2s.onProgress((ev) => dispatch({ type: 'SCRIPT_PROGRESS', ev }))
    const off2 = v2s.onCompleted((result) => dispatch({ type: 'SCRIPT_COMPLETED', result }))
    const off3 = v2s.onFailed((info) =>
      dispatch({ type: 'SCRIPT_FAILED', jobId: info.jobId, message: info.message })
    )
    const off4 = v2s.onStoryboardProgress((ev) => dispatch({ type: 'STORYBOARD_PROGRESS', ev }))
    const off5 = v2s.onStoryboardCompleted((result) =>
      dispatch({ type: 'STORYBOARD_COMPLETED', jobId: result.jobId })
    )
    const off6 = v2s.onStoryboardFailed((info) =>
      dispatch({ type: 'STORYBOARD_FAILED', jobId: info.jobId, message: info.message })
    )
    const off6b = v2s.onStoryboardShotUpdated((ev) =>
      dispatch({
        type: 'STORYBOARD_SHOT_UPDATED',
        projectId: ev.projectId,
        index: ev.index,
        shot: ev.shot,
      })
    )
    const off6c = v2s.onStoryboardScaffold((ev) => dispatch({ type: 'STORYBOARD_SCAFFOLD', ev }))
    const off7 = v2s.onProjectUpdated(async (info) => {
      try {
        const [meta, scriptResult, sbProject] = await Promise.all([
          v2s.loadProject(info.id),
          v2s.loadProjectScript(info.id),
          v2s.loadProjectStoryboard(info.id),
        ])
        if (meta) dispatch({ type: 'PROJECT_META_RELOADED', project: meta })
        dispatch({ type: 'PROJECT_SCRIPT_LOADED', id: info.id, result: scriptResult })
        dispatch({ type: 'PROJECT_STORYBOARD_LOADED', id: info.id, sbProject })
      } catch (e) {
        console.error('reload project failed', e)
      }
    })

    const offD1 = v2s.research.onResearchProgress((ev) =>
      dispatch({ type: 'RESEARCH_PROGRESS', ev })
    )
    const offD2 = v2s.research.onResearchCompleted((ev: ResearchCompletedEvent) =>
      dispatch({ type: 'RESEARCH_COMPLETED', ev })
    )
    const offD3 = v2s.research.onResearchFailed((ev: ResearchFailedEvent) =>
      dispatch({ type: 'RESEARCH_FAILED', jobId: ev.jobId, message: ev.message })
    )
    const offD4 = v2s.research.onResearchUpdated(async (info) => {
      try {
        const loaded = await v2s.research.loadResearch(info.id)
        if (!loaded) return
        const styleGuide = await v2s.research
          .loadResearchStyleGuide(info.id)
          .catch(() => null)
        dispatch({
          type: 'RESEARCH_META_RELOADED',
          meta: loaded.meta,
          subVideos: loaded.subVideos,
        })
        dispatch({ type: 'RESEARCH_STYLE_GUIDE_LOADED', id: info.id, styleGuide })
      } catch (e) {
        console.error('reload research failed', e)
      }
    })

    return () => {
      off1()
      off2()
      off3()
      off4()
      off5()
      off6()
      off6b()
      off6c()
      off7()
      offD1()
      offD2()
      offD3()
      offD4()
    }
  }, [])

  return <StoreCtx.Provider value={{ ...state, dispatch }}>{children}</StoreCtx.Provider>
}

export function useStore(): ContextValue {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export function useSelectedProject(): ProjectState | null {
  const { projects, selectedProjectId } = useStore()
  return useMemo(() => {
    if (!selectedProjectId) return null
    return projects.find((p) => p.meta.id === selectedProjectId) ?? null
  }, [projects, selectedProjectId])
}

export function useSelectedResearch(): ResearchState | null {
  const { research, selectedResearchId } = useStore()
  return useMemo(() => {
    if (!selectedResearchId) return null
    return research.find((d) => d.meta.id === selectedResearchId) ?? null
  }, [research, selectedResearchId])
}
