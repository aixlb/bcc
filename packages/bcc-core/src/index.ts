/**
 * Core 门面：framework-agnostic 单一入口。
 *
 * GUI（Electron IPC）与 CLI（纯 Node）都通过这里调用同一套业务逻辑；测试也从这里导入。
 * 调用前必须由宿主注入运行时上下文：setDataRoot()/setDataRootResolver()（+ 可选 setProxyResolver()）。
 *
 * 底层 services、shared 与 pipelines 均归属 bcc-core，不依赖 Electron。
 * 宿主调用本门面；专门的单元测试可以直接导入具体模块。
 */

// ---------- 运行时上下文（数据根 / 代理注入） ----------
export {
  setDataRoot,
  setDataRootResolver,
  setProxyResolver,
  getDataRoot,
  type ProxyResolver,
  type ProgressTarget,
} from './runtime.js'

// ---------- 配置 ----------
export {
  loadConfig,
  saveConfig,
  getConfig,
  getConfigFilePath,
  applyProxyEnv,
} from './services/config.js'

// ---------- 全局 fetch / 代理装配 ----------
export { installGlobalFetch } from './services/gemini.js'

// ---------- 管线：剧本 ----------
export {
  runScript,
  type RunScriptOptions,
  type ScriptRunResult,
  type ScriptProgress,
  type ScriptGenerate,
  type ScriptGenerationCallbacks,
} from './pipelines/script.js'

// ---------- 管线：分镜 ----------
export {
  runStoryboardOnce,
  resolveAnalyzerConfig,
  detectAndCaptureShots,
  type RunStoryboardOptions,
  type RunStoryboardResult,
  type DetectAndCaptureOptions,
  type DetectAndCaptureResult,
} from './services/storyboard-manager.js'
export type { DetectedShot } from './services/storyboard.js'

// ---------- 管线：风格研究 ----------
export {
  runResearch,
  resolveSynthesizerConfig,
  type RunResearchOptions,
  type ResearchRunResult,
  type ResearchProgress,
} from './pipelines/research.js'

// ---------- 导出：docx / xlsx / html ----------
export { generateScriptDocx } from './services/script-export.js'
export { generateStoryboardXlsx, extractFrame } from './services/storyboard.js'
export { generateProjectHtml, type HtmlExportInput } from './services/html-export.js'
export { buildProjectHtml, type BuildProjectHtmlOptions } from './export.js'

// ---------- 视频信息 ----------
export {
  getVideoInfo,
  formatBytes,
  formatHMS,
  type VideoInfo,
} from './services/video.js'

// ---------- 存储：顶层项目 ----------
export {
  listProjects,
  loadProject,
  createProject,
  renameProject,
  deleteProject,
  getProjectDir,
  getProjectFramesDir,
  writeScriptMd,
  readScriptMd,
  writeStoryboardMd,
  readStoryboard,
  writeSceneScores,
  readSceneScores,
} from './services/project-storage.js'

// ---------- 存储：分镜项目 ----------
export {
  saveStoryboardProject,
  loadStoryboardProject,
  serializeStoryboardMd,
  getStoryboardProjectDir,
} from './services/storyboard-storage.js'

// ---------- 存储：风格研究 ----------
export {
  listResearch,
  loadResearch,
  createResearch,
  renameResearch,
  deleteResearch,
  addVideosToResearch,
  readStyleGuide,
  getResearchDir,
  migrateLegacyResearchDir,
} from './services/research-storage.js'

// ---------- 剧本大师（方法论注入） ----------
export {
  listMasters,
  resolveMasterId,
  getScriptMasterAddendum,
  getStoryboardMasterAddendum,
} from './services/masters.js'
export type { ScriptMasterMeta } from '@shared/masters-meta.js'

// ---------- 剧本解析（来自 shared） ----------
export { parseScript } from '@shared/parse-script'

// ---------- 连接测试用的 provider service（供 CLI config test） ----------
export { GeminiService } from './services/gemini.js'
export { KimiService } from './services/kimi.js'
export { MinimaxService } from './services/minimax.js'
export { OpenAIScriptService } from './services/openai-script.js'
export { ChatGPTService } from './services/chatgpt.js'
export { ClaudeService } from './services/claude.js'
