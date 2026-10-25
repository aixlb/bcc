/**
 * 共享类型定义 - 主进程 / 渲染进程 / preload 通用
 */

/** Gemini 配置 */
export interface GeminiConfig {
  api_key: string
  model: string
  video_resolution: 'low' | 'high'
  proxy: string
}

/** Kimi 配置 */
export interface KimiConfig {
  api_key: string
  model: string
  base_url: string
}

/** MiniMax 配置（OpenAI 兼容，MiniMax-M3 视频理解） */
export interface MinimaxConfig {
  api_key: string
  model: string
  base_url: string
}

/** OpenAI (ChatGPT) 配置 — 官方 GPT API。剧本走关键帧多图（官方接口不收视频） */
export interface OpenAIConfig {
  api_key: string
  model: string
  /** 内置供应商固定官方端点，不出 UI；留字段供网关/代理场景手改 config.yaml */
  base_url: string
}

/** Anthropic (Claude) 配置 — 官方 Claude API。剧本走关键帧多图（官方接口不收视频） */
export interface AnthropicConfig {
  api_key: string
  model: string
  /** 内置供应商固定官方端点，不出 UI；留字段供网关/代理场景手改 config.yaml */
  base_url: string
}

/** 自定义 OpenAI 兼容供应商 */
export interface CustomProvider {
  /** 唯一标识，用于 storyboard_provider / synthesis_provider 引用 */
  id: string
  /** 显示名称，如 "MiniMax M3" */
  name: string
  api_key: string
  base_url: string
  model: string
  /** 剧本输入：video = 整段视频（兼容旧配置）；frames = 采样关键帧，适合 DeepSeek 等图像模型。 */
  script_input?: 'video' | 'frames'
}

/** 分镜切割方式：smart 混合检测（硬切/白闪/锋面/叠化 + 长镜头覆盖补帧）/ scene ffmpeg 帧差阈值法 */
export type CutMethod = 'smart' | 'scene'

/** 一次切割使用的方式与参数快照（切割确认面板展示 / 重切时回传） */
export interface CutParams {
  method: CutMethod
  /** scene：切点判定阈值（0~1） */
  scene_threshold: number
  /** smart：硬切最低帧差（0~255 尺度） */
  smart_hard_min: number
  /** smart：硬切相对倍率（× 局部中位数） */
  smart_hard_ratio: number
  /** smart：切点最小间隔（秒） */
  smart_min_gap: number
}

/** 分镜表配置 */
export interface StoryboardConfig {
  prompt: string
  /** 镜头切割方式（默认 smart） */
  cut_method: CutMethod
  /** 切点判定阈值：每帧 scene 差异值 > 此值即判为切点（0~1，默认 0.3；仅 scene 方式） */
  scene_threshold: number
  /** smart：硬切最低帧差（默认 5.5） */
  smart_hard_min: number
  /** smart：硬切相对倍率（默认 8） */
  smart_hard_ratio: number
  /** smart：切点最小间隔秒（默认 0.3；0.1~0.15 可拆动画连环快切） */
  smart_min_gap: number
  max_shots: number
  concurrency: number
}

/** 风格研究配置 */
export interface ResearchConfig {
  /** 同时跑几个视频的分镜（1..4） */
  video_concurrency: number
  /** 合成风格指南时使用的 provider；null = 继承 storyboard_provider */
  synthesis_provider: string | null
  /** 每个子视频拼几张关键帧到 mosaic */
  mosaic_frames_per_video: number
  /** 合成阶段的系统 prompt（留空用默认） */
  synthesis_prompt: string
}

/** 完整应用配置（对应 config.yaml） */
export interface AppConfig {
  gemini: GeminiConfig
  kimi: KimiConfig
  minimax: MinimaxConfig
  openai: OpenAIConfig
  anthropic: AnthropicConfig
  /** 自定义 OpenAI 兼容供应商列表 */
  custom_providers: CustomProvider[]
  /** 生成剧本使用的 API provider：'gemini' | 'kimi' | 'minimax' | 'openai' | 'anthropic' | custom_provider_id */
  script_provider: string
  /** 剧本大师：'' = 默认，其余为内置大师 id（如 'shanzhiyin'）；生成剧本时注入其方法论 */
  script_master: string
  /** 分镜表分析使用的 API provider：'gemini' | 'kimi' | 'minimax' | 'openai' | custom_provider_id */
  storyboard_provider: string
  /** 分镜大师：'' = 默认，其余为内置大师 id；分镜逐镜分析时注入其方法论（与剧本大师可各选各的） */
  storyboard_master: string
  storyboard: StoryboardConfig
  research: ResearchConfig
}

/** 单个分镜条目 */
export interface StoryboardShot {
  number: number
  /** 已识别内容归一为：特写 / 近景 / 中景 / 全景 / 大全景 / 远景；占位/失败态可暂用状态文本 */
  shotType: string
  angle: string
  cameraMove: string
  /** 新识别内容固定为七行提示词描述；字段名沿用 description 以兼容旧项目 */
  description: string
  dialogue: string
  sound: string
  timeRange: string
  startSec: number
  endSec: number
  /** 该分镜与上一帧的场景差异分数 (0-1)，第一帧为 0 */
  sceneScore: number
  /** 用户是否手动编辑过内容字段；移动切点时为 true 则保留内容、不自动重新识别 */
  userEdited?: boolean
}

/**
 * 人工切点覆盖层（持久化在项目目录 storyboard-boundary-overrides.json）。
 * 时间统一存为整数毫秒，避免浮点比较与 Markdown 三位小数往返造成漂移。
 */
export interface StoryboardBoundaryOverrides {
  version: 1
  /** 人工强制保留的切点（毫秒）；重新切割后仍会合并进自动结果 */
  forced: number[]
  /** 人工删除的自动切点（毫秒）；重新切割时从自动结果剔除 */
  suppressed: number[]
  updatedAt: number
}

/** 分镜表项目（持久化） */
export interface StoryboardProject {
  id: string
  videoPath: string
  createdAt: number
  shots: StoryboardShot[]
  framePaths: string[]
}

/** 顶层项目：一个视频 + 可选剧本 + 可选分镜表 */
export interface Project {
  id: string
  name: string
  videoPath: string
  createdAt: number
  updatedAt: number
  hasScript: boolean
  hasStoryboard: boolean
}

/** 分镜表生成结果 */
export interface StoryboardResult {
  jobId: string
  videoPath: string
  xlsxPath: string
  shots: StoryboardShot[]
}

/** 截图采样阶段产出的单帧（用于在 AI 分析前实时核对镜头切分） */
export interface StoryboardCapturedFrame {
  /** 0-based 镜头序号 */
  index: number
  /** 关键帧图片的绝对路径 */
  path: string
  /** 该帧在视频中的时间戳（秒） */
  timestamp: number
  /** 与上一帧的场景差异分数（0-1），第一帧为 0 */
  score: number
  /** smart 切割时该镜起始点类型（hard/blank/front/dissolve/sample）；scene 方式与首镜无 */
  kind?: string
}

/** 等待开始识别时，某种切割方式的完整预览快照（用于原子替换中间插入后的序号）。 */
export interface StoryboardCutResultSnapshot {
  method: CutParams['method']
  frames: StoryboardCapturedFrame[]
  sceneSeries?: SceneScoreData
}

/** 分镜表进度事件 */
export interface StoryboardProgressEvent {
  jobId: string
  status:
    | 'detecting'
    | 'capturing'
    | 'awaiting_confirm'
    | 'analyzing'
    | 'generating'
    | 'completed'
    | 'failed'
    | 'cancelled'
  progress: number
  message: string
  currentShot?: number
  totalShots?: number
  /** 本次拆分使用的镜头切换检测阈值（首个事件携带，便于 UI 提示当前灵敏度；仅 scene 方式） */
  threshold?: number
  /** 本次切割使用的方式与参数快照（确认面板展示/重切回填） */
  cutParams?: CutParams
  /** 新一轮切割开始（重切）：渲染端应清空已积累的截图列表 */
  resetFrames?: boolean
  /** 截图采样阶段新采样到的一帧（边采样边推送，供实时核对镜头切分） */
  capturedFrame?: StoryboardCapturedFrame
  /** 镜头检测完成后一次性下发的帧差异曲线，供截图核对阶段实时展示（与编辑器同款曲线） */
  sceneSeries?: SceneScoreData
  /** 人工修改等待确认的切割结果后，原子替换对应方式的完整预览。 */
  cutResult?: StoryboardCutResultSnapshot
  /** 作业类型：'generate' 完整生成 / 'reanalyze' 复用截图重新识别。缺省视为 generate */
  kind?: 'generate' | 'reanalyze'
  /** 重新识别作业的归属项目 id —— 渲染进程据此凭首个事件即可建任务卡 */
  projectId?: string
  /** 本次作业使用的 API 标签快照（如 "Kimi · kimi-k3"），供任务卡显示 */
  providerLabel?: string
}

/** 切割确认决定（renderer → main） */
export interface StoryboardCutDecision {
  /**
   * confirm       用 params.method 对应的已切结果开始识别
   * recut         用 params 重新切割，切完仍停在确认页
   * recut_analyze 用 params 重新切割并直接进入识别（「切割并识别」）
   * cancel        取消整个作业
   */
  action: 'confirm' | 'recut' | 'recut_analyze' | 'cancel'
  /** 切割参数（confirm 时用 method 指定识别哪套已切结果） */
  params?: CutParams
}

/** 时间轴上单个采样点的场景差异值（用于排查镜头切分） */
export interface SceneScorePoint {
  /** 时间戳（秒） */
  t: number
  /** 与上一（采样）帧的场景差异分数（0-1） */
  score: number
}

/** 每帧差异值曲线数据（持久化在项目目录的 scene-scores.json） */
export interface SceneScoreData {
  /** 切点判定阈值，用于在曲线上画阈值线（曲线越线处即切点区） */
  threshold: number
  /** 视频时长（秒），用于把曲线横轴铺满时间轴 */
  durationSec: number
  /** 采样后的每帧差异值序列（已降采样，保留峰值） */
  points: SceneScorePoint[]
}

/**
 * 生成分镜时的「占位脚手架」事件（main → renderer）：
 * 截图采样完成、AI 分析开始前一次性下发全部镜头的占位行（含时间区间/关键帧路径，
 * 内容待识别），让主编辑器的分镜表先把表格铺出来，随后由 StoryboardShotUpdated 逐镜填充。
 */
export interface StoryboardScaffoldEvent {
  jobId: string
  projectId: string
  /** 占位分镜（shotType 为「识别中…」，描述等留空，时间/关键帧已就位） */
  shots: StoryboardShot[]
  /** 与 shots 对齐的关键帧绝对路径 */
  framePaths: string[]
}

/** 单个分镜重新识别完成事件（main → renderer，逐镜增量推送） */
export interface StoryboardShotUpdatedEvent {
  projectId: string
  /** 0-based 镜头序号 */
  index: number
  /** 重新识别后的分镜（失败时为保留的旧分镜） */
  shot: StoryboardShot
  /** 本次重新识别的错误信息（成功时为空） */
  error?: string
}

/** 重新识别结果汇总 */
export interface StoryboardReanalyzeResult {
  ok: boolean
  /** 成功更新的镜头数 */
  updated: number
  /** 失败的镜头数 */
  failed: number
}

/** 一次剧本生成作业 */
export interface ScriptJob {
  id: string
  videoPath: string
  videoName: string
  durationSec: number
  startedAt: number
  status: JobStatus
}

export type JobStatus =
  | 'pending'
  | 'preparing'
  | 'compressing'
  | 'uploading'
  | 'waiting_process'
  | 'generating'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 进度事件 - 主进程推送给渲染进程 */
export interface ProgressEvent {
  jobId: string
  status: JobStatus
  /** 0-1 进度 */
  progress: number
  /** 当前操作描述 */
  message: string
  /** 流式生成时累计的剧本文本（用于实时展示） */
  partialScript?: string
  /** 当前分段编号（分段处理时） */
  currentSegment?: number
  totalSegments?: number
  /** 已用时（ms） */
  elapsedMs?: number
  /** 预计剩余（ms） */
  etaMs?: number
  /** 已消耗 token 数 */
  tokensUsed?: number
  /** 视频文件大小（字节），用于在上传阶段显示 */
  videoSizeBytes?: number
}

/** 剧本生成最终结果 */
export interface ScriptResult {
  jobId: string
  videoPath: string
  durationSec: number
  script: string
  /** 解析出的场景（带时间戳） */
  scenes: ScriptScene[]
  /** 生成耗时 ms */
  generatedInMs: number
  generatedAt: number
  /** 已写入项目目录的 script.md 绝对路径（持久化后回填） */
  scriptPath?: string
}

/** 剧本版本元数据（多版本：重新生成时保留旧版可切换） */
export interface ScriptVersionMeta {
  id: string
  createdAt: number
  /** 生成该版本使用的 API 标签（如 "Gemini · gemini-3.5-flash"）；导入/旧数据为「导入」 */
  providerLabel: string
}

/** 项目的剧本版本清单 */
export interface ScriptVersionsInfo {
  /** 当前激活版本 id（script.md 是它的镜像） */
  activeId: string
  versions: ScriptVersionMeta[]
}

/** 解析后的场景片段 */
export interface ScriptScene {
  /** 场景在原始剧本中的起始字符位置 */
  charStart: number
  charEnd: number
  /** 视频中开始时间（秒） */
  startSec: number
  /** 场景标题，如 "1-1 大学教室 日/内" */
  heading: string
  /** 该场景的完整原文（包含标题和后续描述） */
  body: string
  /** 场景编号 1-1 */
  number: string
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  ok: boolean
  message: string
  /** 模型可用列表（若 ok） */
  models?: string[]
}

// ---------- 风格研究（research） ----------

/** 研究中子视频的处理状态 */
export type ResearchSubVideoStatus =
  | 'pending'
  | 'detecting'
  | 'analyzing'
  | 'completed'
  | 'failed'

/** 研究项目中的一条源视频 */
export interface ResearchSubVideo {
  videoPath: string
  videoName: string
  status: ResearchSubVideoStatus
  /** 0..1 — 该子视频在 phase A 中的局部进度 */
  progress: number
  message: string
  /** 已成功分析的镜头数（仅 completed 时有效） */
  shots: number
  errorMessage?: string
  /** 持久化的子分镜 .md 路径（成功后回填） */
  storyboardPath?: string
  /** 持久化的关键帧拼图路径（成功后回填） */
  thumbnailPath?: string
}

/** 研究项目元数据（持久化） */
export interface ResearchMeta {
  id: string
  name: string
  videoPaths: string[]
  createdAt: number
  updatedAt: number
  hasStyleGuide: boolean
}

/** 研究作业 */
export interface ResearchJob {
  jobId: string
  status:
    | 'preparing'
    | 'analyzing_subs'
    | 'building_mosaics'
    | 'synthesizing'
    | 'completed'
    | 'failed'
    | 'cancelled'
  /** 0..1 整体进度 */
  progress: number
  message: string
  /** 1-based 当前正在处理的子视频（phase A 阶段有效） */
  currentSub?: number
  totalSubs: number
  /** phase B 阶段 AI 流式输出的累计文本 */
  partialStyleGuide: string
  /** 实时日志 */
  log: Array<{ ts: number; text: string }>
}

/** 研究进度事件 - 主进程推送给渲染进程 */
export interface ResearchProgressEvent {
  jobId: string
  status: ResearchJob['status']
  progress: number
  message: string
  currentSub?: number
  totalSubs: number
  partialStyleGuide?: string
  subVideoPath?: string
  subStatus?: ResearchSubVideoStatus
  subProgress?: number
}

/** 研究完成事件载荷 */
export interface ResearchCompletedEvent {
  jobId: string
  meta: ResearchMeta
  styleGuide: string
}

/** 研究失败事件载荷 */
export interface ResearchFailedEvent {
  jobId: string
  message: string
}
