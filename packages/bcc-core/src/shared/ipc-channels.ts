/**
 * IPC 通道名常量 - 主进程和渲染进程共享，避免硬编码字符串
 */

export const IPC = {
  // 配置
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_TEST_CONNECTION: 'config:test-connection',
  CONFIG_TEST_STORYBOARD_CONNECTION: 'config:test-storyboard-connection',
  CONFIG_TEST_KIMI: 'config:test-kimi',
  CONFIG_TEST_MINIMAX: 'config:test-minimax',
  CONFIG_TEST_OPENAI: 'config:test-openai',
  CONFIG_TEST_ANTHROPIC: 'config:test-anthropic',
  CONFIG_TEST_CUSTOM_PROVIDER: 'config:test-custom-provider',
  CONFIG_GET_MODEL_PRESETS: 'config:get-model-presets',

  // 文件
  FILE_PICK_VIDEO: 'file:pick-video',
  FILE_SAVE_SCRIPT: 'file:save-script',
  FILE_OPEN_IN_FOLDER: 'file:open-in-folder',
  FILE_GET_VIDEO_URL: 'file:get-video-url',
  FILE_SAVE_STORYBOARD: 'file:save-storyboard',

  // 视频信息
  VIDEO_GET_INFO: 'video:get-info',

  // 剧本生成
  SCRIPT_START: 'script:start',
  SCRIPT_CANCEL: 'script:cancel',

  // 剧本多版本 + 编辑
  SCRIPT_VERSIONS_LIST: 'script:versions-list',
  SCRIPT_VERSIONS_SWITCH: 'script:versions-switch',
  SCRIPT_VERSIONS_DELETE: 'script:versions-delete',
  PROJECT_SAVE_SCRIPT: 'project:save-script',

  // 导入剧本
  FILE_PICK_SCRIPT: 'file:pick-script',
  FILE_READ_SCRIPT: 'file:read-script',

  // 窗口控制
  WINDOW_CLOSE: 'window:close',
  WINDOW_MINIMIZE: 'window:minimize',

  // 分镜表
  STORYBOARD_START: 'storyboard:start',
  STORYBOARD_CANCEL: 'storyboard:cancel',
  STORYBOARD_CONFIRM_CUT: 'storyboard:confirm-cut',
  STORYBOARD_ADD_PREVIEW_CUT: 'storyboard:add-preview-cut',
  STORYBOARD_REANALYZE: 'storyboard:reanalyze',
  STORYBOARD_ADD_SHOT: 'storyboard:add-shot',
  STORYBOARD_MOVE_SHOT: 'storyboard:move-shot',
  STORYBOARD_UPDATE_SHOT: 'storyboard:update-shot',
  STORYBOARD_DELETE_SHOT: 'storyboard:delete-shot',

  // 分镜表导入
  STORYBOARD_PICK_PROJECT: 'storyboard:pick-project',
  STORYBOARD_LOAD_PROJECT: 'storyboard:load-project',

  // 项目（一个视频 + 可选剧本 + 可选分镜表）
  PROJECT_LIST: 'project:list',
  PROJECT_CREATE: 'project:create',
  PROJECT_RENAME: 'project:rename',
  PROJECT_DELETE: 'project:delete',
  PROJECT_LOAD: 'project:load',
  PROJECT_LOAD_SCRIPT: 'project:load-script',
  PROJECT_LOAD_STORYBOARD: 'project:load-storyboard',
  PROJECT_LOAD_SCENE_SCORES: 'project:load-scene-scores',
  PROJECT_IMPORT_SCRIPT: 'project:import-script',
  PROJECT_IMPORT_STORYBOARD: 'project:import-storyboard',
  PROJECT_OPEN_DIR: 'project:open-dir',
  PROJECT_EXPORT_SCRIPT_DOCX: 'project:export-script-docx',
  PROJECT_EXPORT_STORYBOARD_XLSX: 'project:export-storyboard-xlsx',
  PROJECT_EXPORT_HTML: 'project:export-html',

  // 多选视频
  FILE_PICK_VIDEOS: 'file:pick-videos',

  // 风格研究
  RESEARCH_LIST: 'research:list',
  RESEARCH_CREATE: 'research:create',
  RESEARCH_RENAME: 'research:rename',
  RESEARCH_DELETE: 'research:delete',
  RESEARCH_LOAD: 'research:load',
  RESEARCH_LOAD_STYLE_GUIDE: 'research:load-style-guide',
  RESEARCH_LOAD_SUB_STORYBOARD: 'research:load-sub-storyboard',
  RESEARCH_OPEN_DIR: 'research:open-dir',
  RESEARCH_START: 'research:start',
  RESEARCH_CANCEL: 'research:cancel',
  RESEARCH_ADD_VIDEOS: 'research:add-videos',

  // Shell
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // 推送事件（main → renderer）
  EVENT_PROGRESS: 'event:progress',
  EVENT_COMPLETED: 'event:completed',
  EVENT_FAILED: 'event:failed',
  EVENT_LOG: 'event:log',
  EVENT_STORYBOARD_PROGRESS: 'event:storyboard-progress',
  EVENT_STORYBOARD_COMPLETED: 'event:storyboard-completed',
  EVENT_STORYBOARD_FAILED: 'event:storyboard-failed',
  EVENT_STORYBOARD_SHOT_UPDATED: 'event:storyboard-shot-updated',
  EVENT_STORYBOARD_SCAFFOLD: 'event:storyboard-scaffold',
  EVENT_PROJECT_UPDATED: 'event:project-updated',
  EVENT_RESEARCH_PROGRESS: 'event:research-progress',
  EVENT_RESEARCH_COMPLETED: 'event:research-completed',
  EVENT_RESEARCH_FAILED: 'event:research-failed',
  EVENT_RESEARCH_UPDATED: 'event:research-updated',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
