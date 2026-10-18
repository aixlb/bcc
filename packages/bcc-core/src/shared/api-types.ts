/**
 * window.v2s API 类型声明 - 主进程和渲染进程共享
 * 让 preload 实现这个接口，渲染进程消费这个类型
 */
import type {
  AppConfig,
  ConnectionTestResult,
  CutParams,
  CustomProvider,
  ResearchCompletedEvent,
  ResearchFailedEvent,
  ResearchMeta,
  ResearchProgressEvent,
  ResearchSubVideo,
  KimiConfig,
  MinimaxConfig,
  OpenAIConfig,
  AnthropicConfig,
  Project,
  ProgressEvent,
  SceneScoreData,
  ScriptResult,
  ScriptVersionsInfo,
  StoryboardCutDecision,
  StoryboardProgressEvent,
  StoryboardReanalyzeResult,
  StoryboardResult,
  StoryboardProject,
  StoryboardScaffoldEvent,
  StoryboardShot,
  StoryboardShotUpdatedEvent,
} from './types'
import type { ModelPresetMap } from './model-presets'

export interface VideoInfoDto {
  path: string
  durationSec: number
  width: number
  height: number
  sizeBytes: number
  format: string
  videoCodec: string
  audioCodec: string
}

export interface V2sApi {
  getConfig(): Promise<AppConfig>
  setConfig(config: AppConfig): Promise<{ ok: boolean }>
  testConnection(override?: AppConfig): Promise<ConnectionTestResult>
  testStoryboardConnection(override?: AppConfig): Promise<ConnectionTestResult>
  testKimiConnection(kimi: KimiConfig): Promise<ConnectionTestResult>
  testMinimaxConnection(minimax: MinimaxConfig): Promise<ConnectionTestResult>
  testOpenAIConnection(openai: OpenAIConfig): Promise<ConnectionTestResult>
  testAnthropicConnection(anthropic: AnthropicConfig): Promise<ConnectionTestResult>
  testCustomProviderConnection(provider: CustomProvider): Promise<ConnectionTestResult>
  /** 内置默认 + 数据目录 models.json 合并后的「模型」下拉预设 */
  getModelPresets(): Promise<ModelPresetMap>

  pickVideo(): Promise<string | null>
  saveScript(defaultName: string, content: string): Promise<string | null>
  saveStoryboard(defaultName: string, sourcePath: string): Promise<string | null>
  openInFolder(filePath: string): Promise<{ ok: boolean }>
  getVideoMediaUrl(videoPath: string): Promise<string>
  getMediaUrl(absPath: string): string
  getPathForFile(file: File): string

  pickScript(): Promise<string | null>
  readScript(filePath: string): Promise<string>

  getVideoInfo(videoPath: string): Promise<VideoInfoDto>

  /** master：本次生成使用的剧本大师 id（''=默认）；缺省用全局配置 script_master */
  startGenerate(projectId: string, videoPath: string, master?: string): Promise<{ jobId: string }>
  cancelGenerate(jobId: string): Promise<{ ok: boolean }>

  /** 剧本版本清单（无剧本时 null；旧项目首次调用自动迁移出首个版本） */
  listScriptVersions(projectId: string): Promise<ScriptVersionsInfo | null>
  /** 切换激活的剧本版本（script.md 换成该版本内容） */
  switchScriptVersion(projectId: string, versionId: string): Promise<{ ok: boolean }>
  /** 删除一个剧本版本；返回删除后的版本清单（删光为 null） */
  deleteScriptVersion(projectId: string, versionId: string): Promise<ScriptVersionsInfo | null>
  /** 保存剧本全文（场景增删改后调用），同步激活版本文件 */
  saveProjectScript(projectId: string, content: string): Promise<{ ok: boolean }>

  windowClose(): Promise<void>
  windowMinimize(): Promise<void>
  openExternal(url: string): Promise<void>

  /**
   * 开始生成分镜；cutParams 为切割页选好的方式与参数（缺省用全局配置）；skipConfirm=true 切完直接识别（「切割并识别」）；
   * master 为本次使用的分镜大师 id（''=默认，缺省用全局配置 storyboard_master）
   */
  startStoryboard(
    projectId: string,
    videoPath: string,
    cutParams?: CutParams,
    skipConfirm?: boolean,
    master?: string
  ): Promise<{ jobId: string }>
  cancelStoryboard(jobId: string): Promise<{ ok: boolean }>
  /** 对 awaiting_confirm 状态的切割作业作出决定（确认 / 调参重切 / 取消） */
  confirmStoryboardCut(jobId: string, decision: StoryboardCutDecision): Promise<{ ok: boolean }>
  /** 在切割完成、开始识别前，为指定切割结果手动新增一个切点。 */
  addStoryboardPreviewCut(
    jobId: string,
    method: CutParams['method'],
    timeSec: number
  ): Promise<{ ok: boolean; index: number; reason?: string }>
  /** 复用已有截图，对指定镜头（0-based 序号）重新调用 AI 识别 */
  reanalyzeStoryboardShots(projectId: string, indices: number[]): Promise<StoryboardReanalyzeResult>
  /** 在指定时间手动新增一个分镜（截帧 + AI 识别 + 按时间插入），返回插入位置 */
  addStoryboardShot(
    projectId: string,
    timeSec: number
  ): Promise<{ ok: boolean; index: number; reason?: string }>
  /** 移动指定分镜的起始切点；第一镜（index=0）不可移动 */
  moveStoryboardShot(
    projectId: string,
    index: number,
    timeSec: number
  ): Promise<{ ok: boolean; index: number; reason?: string }>
  /** 编辑单个分镜的文本字段（景别/角度/运镜/提示词描述/台词/音效） */
  updateStoryboardShot(
    projectId: string,
    index: number,
    fields: Partial<Pick<StoryboardShot, 'shotType' | 'angle' | 'cameraMove' | 'description' | 'dialogue' | 'sound'>>
  ): Promise<{ ok: boolean; reason?: string }>
  /** 删除右侧分镜及其起始切点，让左镜吞并区间；第一镜不可删除 */
  deleteStoryboardShot(projectId: string, index: number): Promise<{ ok: boolean; reason?: string }>

  pickStoryboardProject(): Promise<string | null>
  loadStoryboardProject(projectDir: string): Promise<StoryboardProject | null>

  // 项目管理
  listProjects(): Promise<Project[]>
  createProject(args: { name: string; videoPath: string }): Promise<Project>
  renameProject(id: string, name: string): Promise<Project>
  deleteProject(id: string): Promise<{ ok: boolean }>
  loadProject(id: string): Promise<Project | null>
  loadProjectScript(id: string): Promise<ScriptResult | null>
  loadProjectStoryboard(id: string): Promise<StoryboardProject | null>
  /** 读取每帧场景差异曲线（生成分镜时算出）；无则返回 null */
  loadProjectSceneScores(id: string): Promise<SceneScoreData | null>
  importScriptAsProject(): Promise<Project | null>
  importStoryboardAsProject(): Promise<Project | null>
  openProjectDir(id: string): Promise<{ ok: boolean }>
  exportScriptDocx(projectId: string): Promise<string | null>
  exportStoryboardXlsx(projectId: string): Promise<string | null>
  /** 导出剧本 + 分镜为单个可交互 HTML，返回保存路径或 null（取消/无内容） */
  exportProjectHtml(projectId: string): Promise<string | null>

  onProgress(handler: (ev: ProgressEvent) => void): () => void
  onCompleted(handler: (result: ScriptResult) => void): () => void
  onFailed(handler: (info: { jobId: string; message: string }) => void): () => void
  onStoryboardProgress(handler: (ev: StoryboardProgressEvent) => void): () => void
  onStoryboardCompleted(handler: (result: StoryboardResult) => void): () => void
  onStoryboardFailed(handler: (info: { jobId: string; message: string }) => void): () => void
  onStoryboardShotUpdated(handler: (ev: StoryboardShotUpdatedEvent) => void): () => void
  onStoryboardScaffold(handler: (ev: StoryboardScaffoldEvent) => void): () => void
  onProjectUpdated(handler: (info: { id: string }) => void): () => void
}

/** 风格研究子 API — 暴露在 window.v2s.research */
export interface ResearchApi {
  pickVideos(): Promise<string[] | null>
  listResearch(): Promise<ResearchMeta[]>
  createResearch(args: { name: string; videoPaths: string[] }): Promise<ResearchMeta>
  loadResearch(id: string): Promise<{ meta: ResearchMeta; subVideos: ResearchSubVideo[] } | null>
  loadResearchStyleGuide(id: string): Promise<string | null>
  loadResearchSubStoryboard(id: string, subIndex: number): Promise<StoryboardProject | null>
  renameResearch(id: string, name: string): Promise<ResearchMeta>
  deleteResearch(id: string): Promise<{ ok: boolean }>
  openResearchDir(id: string): Promise<{ ok: boolean }>
  startResearch(id: string): Promise<{ jobId: string }>
  cancelResearch(jobId: string): Promise<{ ok: boolean }>
  addVideosToResearch(
    id: string,
    videoPaths: string[]
  ): Promise<{ meta: ResearchMeta; newSubVideos: ResearchSubVideo[] }>

  onResearchProgress(handler: (ev: ResearchProgressEvent) => void): () => void
  onResearchCompleted(handler: (ev: ResearchCompletedEvent) => void): () => void
  onResearchFailed(handler: (ev: ResearchFailedEvent) => void): () => void
  onResearchUpdated(handler: (info: { id: string }) => void): () => void
}
