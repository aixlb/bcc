/**
 * Preload 脚本：在渲染进程的 `window` 上暴露安全的 API
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ResearchApi, V2sApi } from '@shared/api-types'

/** 把本地绝对路径编码为 media:// URL（复用主进程 buildMediaUrl 逻辑） */
function buildMediaUrl(absPath: string): string {
  const b64 = Buffer.from(absPath, 'utf-8').toString('base64url')
  return 'media://local/' + b64
}

const api: V2sApi = {
  // 配置
  getConfig: () => ipcRenderer.invoke(IPC.CONFIG_GET),
  setConfig: (config) => ipcRenderer.invoke(IPC.CONFIG_SET, config),
  testConnection: (override) => ipcRenderer.invoke(IPC.CONFIG_TEST_CONNECTION, override),
  testStoryboardConnection: (override) => ipcRenderer.invoke(IPC.CONFIG_TEST_STORYBOARD_CONNECTION, override),
  testKimiConnection: (kimi) => ipcRenderer.invoke(IPC.CONFIG_TEST_KIMI, kimi),
  testMinimaxConnection: (minimax) => ipcRenderer.invoke(IPC.CONFIG_TEST_MINIMAX, minimax),
  testOpenAIConnection: (openai) => ipcRenderer.invoke(IPC.CONFIG_TEST_OPENAI, openai),
  testAnthropicConnection: (anthropic) => ipcRenderer.invoke(IPC.CONFIG_TEST_ANTHROPIC, anthropic),
  testCustomProviderConnection: (provider) => ipcRenderer.invoke(IPC.CONFIG_TEST_CUSTOM_PROVIDER, provider),
  getModelPresets: () => ipcRenderer.invoke(IPC.CONFIG_GET_MODEL_PRESETS),

  // 文件
  pickVideo: () => ipcRenderer.invoke(IPC.FILE_PICK_VIDEO),
  saveScript: (defaultName, content) =>
    ipcRenderer.invoke(IPC.FILE_SAVE_SCRIPT, { defaultName, content }),
  saveStoryboard: (defaultName, sourcePath) =>
    ipcRenderer.invoke(IPC.FILE_SAVE_STORYBOARD, { defaultName, sourcePath }),
  openInFolder: (filePath) => ipcRenderer.invoke(IPC.FILE_OPEN_IN_FOLDER, filePath),
  getVideoMediaUrl: (videoPath) => ipcRenderer.invoke(IPC.FILE_GET_VIDEO_URL, videoPath),
  getMediaUrl: (absPath: string) => buildMediaUrl(absPath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  pickScript: () => ipcRenderer.invoke(IPC.FILE_PICK_SCRIPT),
  readScript: (filePath) => ipcRenderer.invoke(IPC.FILE_READ_SCRIPT, filePath),

  pickStoryboardProject: () => ipcRenderer.invoke(IPC.STORYBOARD_PICK_PROJECT),
  loadStoryboardProject: (projectDir) => ipcRenderer.invoke(IPC.STORYBOARD_LOAD_PROJECT, projectDir),

  // 视频
  getVideoInfo: (videoPath) => ipcRenderer.invoke(IPC.VIDEO_GET_INFO, videoPath),

  // 剧本生成
  startGenerate: (projectId, videoPath, master) =>
    ipcRenderer.invoke(IPC.SCRIPT_START, { projectId, videoPath, master }),
  cancelGenerate: (jobId) => ipcRenderer.invoke(IPC.SCRIPT_CANCEL, jobId),

  // 剧本多版本 + 编辑
  listScriptVersions: (projectId) => ipcRenderer.invoke(IPC.SCRIPT_VERSIONS_LIST, projectId),
  switchScriptVersion: (projectId, versionId) =>
    ipcRenderer.invoke(IPC.SCRIPT_VERSIONS_SWITCH, { projectId, versionId }),
  deleteScriptVersion: (projectId, versionId) =>
    ipcRenderer.invoke(IPC.SCRIPT_VERSIONS_DELETE, { projectId, versionId }),
  saveProjectScript: (projectId, content) =>
    ipcRenderer.invoke(IPC.PROJECT_SAVE_SCRIPT, { projectId, content }),

  windowClose: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
  windowMinimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),

  // 分镜表
  startStoryboard: (projectId, videoPath, cutParams, skipConfirm, master) =>
    ipcRenderer.invoke(IPC.STORYBOARD_START, { projectId, videoPath, cutParams, skipConfirm, master }),
  cancelStoryboard: (jobId) => ipcRenderer.invoke(IPC.STORYBOARD_CANCEL, jobId),
  confirmStoryboardCut: (jobId, decision) =>
    ipcRenderer.invoke(IPC.STORYBOARD_CONFIRM_CUT, { jobId, decision }),
  addStoryboardPreviewCut: (jobId, method, timeSec) =>
    ipcRenderer.invoke(IPC.STORYBOARD_ADD_PREVIEW_CUT, { jobId, method, timeSec }),
  reanalyzeStoryboardShots: (projectId, indices) =>
    ipcRenderer.invoke(IPC.STORYBOARD_REANALYZE, { projectId, indices }),
  addStoryboardShot: (projectId, timeSec) =>
    ipcRenderer.invoke(IPC.STORYBOARD_ADD_SHOT, { projectId, timeSec }),
  moveStoryboardShot: (projectId, index, timeSec) =>
    ipcRenderer.invoke(IPC.STORYBOARD_MOVE_SHOT, { projectId, index, timeSec }),
  updateStoryboardShot: (projectId, index, fields) =>
    ipcRenderer.invoke(IPC.STORYBOARD_UPDATE_SHOT, { projectId, index, fields }),
  deleteStoryboardShot: (projectId, index) =>
    ipcRenderer.invoke(IPC.STORYBOARD_DELETE_SHOT, { projectId, index }),

  // 项目
  listProjects: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
  createProject: (args) => ipcRenderer.invoke(IPC.PROJECT_CREATE, args),
  renameProject: (id, name) => ipcRenderer.invoke(IPC.PROJECT_RENAME, { id, name }),
  deleteProject: (id) => ipcRenderer.invoke(IPC.PROJECT_DELETE, id),
  loadProject: (id) => ipcRenderer.invoke(IPC.PROJECT_LOAD, id),
  loadProjectScript: (id) => ipcRenderer.invoke(IPC.PROJECT_LOAD_SCRIPT, id),
  loadProjectStoryboard: (id) => ipcRenderer.invoke(IPC.PROJECT_LOAD_STORYBOARD, id),
  loadProjectSceneScores: (id) => ipcRenderer.invoke(IPC.PROJECT_LOAD_SCENE_SCORES, id),
  importScriptAsProject: () => ipcRenderer.invoke(IPC.PROJECT_IMPORT_SCRIPT),
  importStoryboardAsProject: () => ipcRenderer.invoke(IPC.PROJECT_IMPORT_STORYBOARD),
  openProjectDir: (id) => ipcRenderer.invoke(IPC.PROJECT_OPEN_DIR, id),
  exportScriptDocx: (projectId) => ipcRenderer.invoke(IPC.PROJECT_EXPORT_SCRIPT_DOCX, projectId),
  exportStoryboardXlsx: (projectId) => ipcRenderer.invoke(IPC.PROJECT_EXPORT_STORYBOARD_XLSX, projectId),
  exportProjectHtml: (projectId) => ipcRenderer.invoke(IPC.PROJECT_EXPORT_HTML, projectId),

  // 事件订阅
  onProgress: (handler) => {
    const listener = (_: unknown, ev: Parameters<typeof handler>[0]) => handler(ev)
    ipcRenderer.on(IPC.EVENT_PROGRESS, listener)
    return () => ipcRenderer.off(IPC.EVENT_PROGRESS, listener)
  },
  onCompleted: (handler) => {
    const listener = (_: unknown, result: Parameters<typeof handler>[0]) => handler(result)
    ipcRenderer.on(IPC.EVENT_COMPLETED, listener)
    return () => ipcRenderer.off(IPC.EVENT_COMPLETED, listener)
  },
  onFailed: (handler) => {
    const listener = (_: unknown, info: Parameters<typeof handler>[0]) => handler(info)
    ipcRenderer.on(IPC.EVENT_FAILED, listener)
    return () => ipcRenderer.off(IPC.EVENT_FAILED, listener)
  },
  onStoryboardProgress: (handler) => {
    const listener = (_: unknown, ev: Parameters<typeof handler>[0]) => handler(ev)
    ipcRenderer.on(IPC.EVENT_STORYBOARD_PROGRESS, listener)
    return () => ipcRenderer.off(IPC.EVENT_STORYBOARD_PROGRESS, listener)
  },
  onStoryboardCompleted: (handler) => {
    const listener = (_: unknown, result: Parameters<typeof handler>[0]) => handler(result)
    ipcRenderer.on(IPC.EVENT_STORYBOARD_COMPLETED, listener)
    return () => ipcRenderer.off(IPC.EVENT_STORYBOARD_COMPLETED, listener)
  },
  onStoryboardFailed: (handler) => {
    const listener = (_: unknown, info: Parameters<typeof handler>[0]) => handler(info)
    ipcRenderer.on(IPC.EVENT_STORYBOARD_FAILED, listener)
    return () => ipcRenderer.off(IPC.EVENT_STORYBOARD_FAILED, listener)
  },
  onStoryboardShotUpdated: (handler) => {
    const listener = (_: unknown, ev: Parameters<typeof handler>[0]) => handler(ev)
    ipcRenderer.on(IPC.EVENT_STORYBOARD_SHOT_UPDATED, listener)
    return () => ipcRenderer.off(IPC.EVENT_STORYBOARD_SHOT_UPDATED, listener)
  },
  onStoryboardScaffold: (handler) => {
    const listener = (_: unknown, ev: Parameters<typeof handler>[0]) => handler(ev)
    ipcRenderer.on(IPC.EVENT_STORYBOARD_SCAFFOLD, listener)
    return () => ipcRenderer.off(IPC.EVENT_STORYBOARD_SCAFFOLD, listener)
  },
  onProjectUpdated: (handler) => {
    const listener = (_: unknown, info: Parameters<typeof handler>[0]) => handler(info)
    ipcRenderer.on(IPC.EVENT_PROJECT_UPDATED, listener)
    return () => ipcRenderer.off(IPC.EVENT_PROJECT_UPDATED, listener)
  },
}

const research: ResearchApi = {
  pickVideos: () => ipcRenderer.invoke(IPC.FILE_PICK_VIDEOS),
  listResearch: () => ipcRenderer.invoke(IPC.RESEARCH_LIST),
  createResearch: (args) => ipcRenderer.invoke(IPC.RESEARCH_CREATE, args),
  loadResearch: (id) => ipcRenderer.invoke(IPC.RESEARCH_LOAD, id),
  loadResearchStyleGuide: (id) => ipcRenderer.invoke(IPC.RESEARCH_LOAD_STYLE_GUIDE, id),
  loadResearchSubStoryboard: (id, subIndex) =>
    ipcRenderer.invoke(IPC.RESEARCH_LOAD_SUB_STORYBOARD, { id, subIndex }),
  renameResearch: (id, name) => ipcRenderer.invoke(IPC.RESEARCH_RENAME, { id, name }),
  deleteResearch: (id) => ipcRenderer.invoke(IPC.RESEARCH_DELETE, id),
  openResearchDir: (id) => ipcRenderer.invoke(IPC.RESEARCH_OPEN_DIR, id),
  startResearch: (id) => ipcRenderer.invoke(IPC.RESEARCH_START, { researchId: id }),
  cancelResearch: (jobId) => ipcRenderer.invoke(IPC.RESEARCH_CANCEL, jobId),
  addVideosToResearch: (id, videoPaths) =>
    ipcRenderer.invoke(IPC.RESEARCH_ADD_VIDEOS, id, videoPaths),
  onResearchProgress: (handler) => {
    const listener = (_: unknown, ev: Parameters<typeof handler>[0]) => handler(ev)
    ipcRenderer.on(IPC.EVENT_RESEARCH_PROGRESS, listener)
    return () => ipcRenderer.off(IPC.EVENT_RESEARCH_PROGRESS, listener)
  },
  onResearchCompleted: (handler) => {
    const listener = (_: unknown, ev: Parameters<typeof handler>[0]) => handler(ev)
    ipcRenderer.on(IPC.EVENT_RESEARCH_COMPLETED, listener)
    return () => ipcRenderer.off(IPC.EVENT_RESEARCH_COMPLETED, listener)
  },
  onResearchFailed: (handler) => {
    const listener = (_: unknown, ev: Parameters<typeof handler>[0]) => handler(ev)
    ipcRenderer.on(IPC.EVENT_RESEARCH_FAILED, listener)
    return () => ipcRenderer.off(IPC.EVENT_RESEARCH_FAILED, listener)
  },
  onResearchUpdated: (handler) => {
    const listener = (_: unknown, info: Parameters<typeof handler>[0]) => handler(info)
    ipcRenderer.on(IPC.EVENT_RESEARCH_UPDATED, listener)
    return () => ipcRenderer.off(IPC.EVENT_RESEARCH_UPDATED, listener)
  },
}

contextBridge.exposeInMainWorld('v2s', { ...api, research })
