/**
 * Electron 主进程入口
 */
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { IPC } from '@shared/ipc-channels'
import type { AppConfig, ScriptResult, StoryboardProject } from '@shared/types'
import { parseScript } from '@shared/parse-script'
import { setDataRootResolver, setProxyResolver } from '@core/runtime.js'
import { resolveDataRootElectron } from './electron-paths.js'
import { electronProxyResolver } from './proxy.js'
import { applyProxyEnv, loadConfig, saveConfig } from '@core/services/config.js'
import { loadModelPresets } from '@core/services/model-presets.js'
import { GeminiService, installGlobalFetch } from '@core/services/gemini.js'
import { KimiService } from '@core/services/kimi.js'
import { ClaudeService } from '@core/services/claude.js'
import { MinimaxService } from '@core/services/minimax.js'
import { testAnalyzerConnection } from '@core/services/storyboard-analyzer.js'
import { getVideoInfo } from '@core/services/video.js'
import { jobManager } from './job-manager.js'
import { storyboardManager } from '@core/services/storyboard-manager.js'
import { researchManager } from '@core/services/research-manager.js'
import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  loadProject,
  readScriptMd,
  readStoryboard,
  readSceneScores,
  writeScriptMd,
  writeStoryboardMd,
  getProjectDir,
  getProjectFramesDir,
  getProjectSceneScoresPath,
  updateStoryboardBoundaryOverrides,
  listScriptVersions,
  switchScriptVersion,
  deleteScriptVersion,
  updateActiveScriptContent,
} from '@core/services/project-storage.js'
import { loadStoryboardProject } from '@core/services/storyboard-storage.js'
import {
  listResearch,
  createResearch,
  loadResearch,
  renameResearch,
  deleteResearch,
  getResearchDir,
  getSubDir,
  readStyleGuide,
  addVideosToResearch,
  migrateLegacyResearchDir,
} from '@core/services/research-storage.js'
import { generateScriptDocx } from '@core/services/script-export.js'
import { generateStoryboardXlsx, extractFrame } from '@core/services/storyboard.js'
import { generateProjectHtml } from '@core/services/html-export.js'

// 保留既有安装的数据目录身份，避免仓库和 npm 包改名后切换 userData 路径。
app.setName('XLB Storyboard')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

// 注册自定义协议，让渲染进程能加载本地视频文件
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

/** 运行期应用图标（dev/打包通用）：out/renderer/icon.png，由 renderer/public 复制而来 */
function loadAppIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(path.join(__dirname, '../renderer/icon.png'))
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

async function createWindow(): Promise<void> {
  const appIcon = loadAppIcon()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    // Windows/Linux 任务栏图标；macOS 用下方 app.dock.setIcon。空图标时回退默认
    ...(appIcon.isEmpty() ? {} : { icon: appIcon }),
    backgroundColor: '#08070a',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // dev 模式加载 vite dev server，否则加载打包后的 index.html
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    jobManager.cancelAll()
    storyboardManager.cancelAll()
    researchManager.cancelAll()
  })
}

function registerMediaProtocol(): void {
  // media://local/<base64-of-absolute-path>
  // 用 base64 编码避免 Windows 路径中的 :/\ 等字符破坏 URL 解析。
  // 必须自己处理 Range request，否则 <video> 元素 seek 会失败、回到 0 或卡死。
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      const b64 = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const absPath = Buffer.from(b64, 'base64url').toString('utf-8')
      if (!existsSync(absPath)) {
        return new Response('Not found: ' + absPath, { status: 404 })
      }

      const stat = await fs.stat(absPath)
      const mime = mimeForExt(path.extname(absPath))
      const total = stat.size
      const rangeHeader = request.headers.get('Range')

      // 没 Range：HEAD 也可能进这里。返回整文件，但声明 Accept-Ranges 让浏览器之后发 Range
      if (!rangeHeader) {
        // 小文件直接用 readFile，避免 Readable.toWeb 兼容问题
        if (total < 5 * 1024 * 1024) {
          const buf = await fs.readFile(absPath)
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(total),
              'Accept-Ranges': 'bytes',
              'Access-Control-Allow-Origin': '*',
            },
          })
        }
        const stream = createReadStream(absPath)
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(total),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }

      // 解析 Range: bytes=start-end（end 可能省略 → 到末尾）
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/)
      if (!m) {
        return new Response('Invalid Range', { status: 416 })
      }
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : total - 1
      // 防御性裁剪
      if (Number.isNaN(start) || start < 0) start = 0
      if (Number.isNaN(end) || end >= total) end = total - 1
      if (start > end) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        })
      }

      const stream = createReadStream(absPath, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (e: any) {
      return new Response('Internal error: ' + e.message, { status: 500 })
    }
  })
}

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mkv':
      return 'video/x-matroska'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.avi':
      return 'video/x-msvideo'
    case '.flv':
      return 'video/x-flv'
    case '.wmv':
      return 'video/x-ms-wmv'
    case '.ogg':
    case '.ogv':
      return 'video/ogg'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function buildMediaUrl(absPath: string): string {
  const b64 = Buffer.from(absPath, 'utf-8').toString('base64url')
  return 'media://local/' + b64
}

function registerIpc(): void {
  // ----- 配置 -----
  ipcMain.handle(IPC.CONFIG_GET, async () => {
    return await loadConfig()
  })
  ipcMain.handle(IPC.CONFIG_SET, async (_e, config: AppConfig) => {
    await saveConfig(config)
    await installGlobalFetch(config.gemini.proxy)
    return { ok: true }
  })
  ipcMain.handle(IPC.CONFIG_GET_MODEL_PRESETS, async () => {
    return await loadModelPresets()
  })
  ipcMain.handle(IPC.CONFIG_TEST_CONNECTION, async (_e, override?: AppConfig) => {
    const cfg = override?.gemini ?? (await loadConfig()).gemini
    if (override) {
      applyProxyEnv(cfg)
      await installGlobalFetch(cfg.proxy)
    }
    const svc = new GeminiService(cfg)
    return await svc.testConnection()
  })
  ipcMain.handle(IPC.CONFIG_TEST_STORYBOARD_CONNECTION, async (_e, override?: AppConfig) => {
    const cfg = override ?? (await loadConfig())
    const provider = cfg.storyboard_provider ?? 'gemini'

    if (provider === 'gemini') {
      if (override) applyProxyEnv(cfg.gemini)
      if (!cfg.gemini.api_key) return { ok: false, message: 'Gemini API Key 未配置' }
      const svc = new GeminiService(cfg.gemini)
      return await svc.testConnection()
    }
    if (provider === 'kimi') {
      if (!cfg.kimi.api_key) return { ok: false, message: 'Kimi API Key 未配置' }
      return await testAnalyzerConnection({
        apiKey: cfg.kimi.api_key,
        baseUrl: cfg.kimi.base_url || 'https://api.moonshot.cn/v1',
      })
    }
    if (provider === 'minimax') {
      if (!cfg.minimax.api_key) return { ok: false, message: 'MiniMax API Key 未配置' }
      return await testAnalyzerConnection({
        apiKey: cfg.minimax.api_key,
        baseUrl: cfg.minimax.base_url || 'https://api.minimaxi.com/v1',
      })
    }
    if (provider === 'openai') {
      if (!cfg.openai?.api_key) return { ok: false, message: 'OpenAI API Key 未配置' }
      return await testAnalyzerConnection({
        apiKey: cfg.openai.api_key,
        baseUrl: cfg.openai.base_url?.trim() || 'https://api.openai.com/v1',
      })
    }
    const custom = cfg.custom_providers?.find((p) => p.id === provider)
    if (!custom) return { ok: false, message: `未知供应商: ${provider}` }
    if (!custom.api_key) return { ok: false, message: `${custom.name} API Key 未配置` }
    return await testAnalyzerConnection({ apiKey: custom.api_key, baseUrl: custom.base_url })
  })
  ipcMain.handle(IPC.CONFIG_TEST_KIMI, async (_e, kimi: import('@shared/types').KimiConfig) => {
    const svc = new KimiService(kimi)
    return await svc.testConnection()
  })
  ipcMain.handle(IPC.CONFIG_TEST_MINIMAX, async (_e, minimax: import('@shared/types').MinimaxConfig) => {
    const svc = new MinimaxService(minimax)
    return await svc.testConnection()
  })
  ipcMain.handle(IPC.CONFIG_TEST_OPENAI, async (_e, openai: import('@shared/types').OpenAIConfig) => {
    if (!openai.api_key) return { ok: false, message: 'OpenAI API Key 未配置' }
    return await testAnalyzerConnection({
      apiKey: openai.api_key,
      baseUrl: openai.base_url?.trim() || 'https://api.openai.com/v1',
    })
  })
  ipcMain.handle(IPC.CONFIG_TEST_ANTHROPIC, async (_e, anthropic: import('@shared/types').AnthropicConfig) => {
    if (!anthropic.api_key) return { ok: false, message: 'Anthropic API Key 未配置' }
    const svc = new ClaudeService(anthropic)
    return await svc.testConnection()
  })
  ipcMain.handle(IPC.CONFIG_TEST_CUSTOM_PROVIDER, async (_e, provider: import('@shared/types').CustomProvider) => {
    if (!provider.api_key) return { ok: false, message: 'API Key 未配置' }
    return await testAnalyzerConnection({ apiKey: provider.api_key, baseUrl: provider.base_url })
  })

  // ----- 文件 -----
  ipcMain.handle(IPC.FILE_PICK_VIDEO, async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择视频文件',
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.FILE_SAVE_SCRIPT, async (_e, args: { defaultName: string; content: string }) => {
    if (!mainWindow) return null
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '保存剧本',
      defaultPath: args.defaultName,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '纯文本', extensions: ['txt'] },
      ],
    })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, args.content, 'utf-8')
    return res.filePath
  })

  ipcMain.handle(IPC.FILE_OPEN_IN_FOLDER, async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
    return { ok: true }
  })

  ipcMain.handle(IPC.FILE_PICK_SCRIPT, async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择剧本文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.FILE_READ_SCRIPT, async (_e, filePath: string) => {
    const text = await fs.readFile(filePath, 'utf-8')
    return text
  })

  ipcMain.handle(IPC.FILE_SAVE_STORYBOARD, async (_e, args: { defaultName: string; sourcePath: string }) => {
    if (!mainWindow) return null
    console.log('[saveStoryboard] sourcePath:', args.sourcePath)
    if (!existsSync(args.sourcePath)) {
      console.error('[saveStoryboard] source file does not exist:', args.sourcePath)
      throw new Error('源文件不存在，可能已过期，请重新生成')
    }
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '保存分镜表',
      defaultPath: args.defaultName,
      filters: [
        { name: 'Excel 工作簿', extensions: ['xlsx'] },
      ],
    })
    if (res.canceled || !res.filePath) {
      console.log('[saveStoryboard] cancelled')
      return null
    }
    console.log('[saveStoryboard] destination:', res.filePath)
    try {
      await fs.copyFile(args.sourcePath, res.filePath)
      console.log('[saveStoryboard] copy OK')
    } catch (copyErr: any) {
      console.error('[saveStoryboard] copy failed:', copyErr?.message ?? String(copyErr))
      throw new Error('复制文件失败: ' + (copyErr?.message ?? String(copyErr)))
    }
    // 保存成功后清理临时目录
    try {
      const tmpDir = path.dirname(args.sourcePath)
      await fs.rm(tmpDir, { recursive: true, force: true })
      console.log('[saveStoryboard] tmpDir cleaned')
    } catch {}
    return res.filePath
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, async () => {
    mainWindow?.close()
  })
  ipcMain.handle(IPC.WINDOW_MINIMIZE, async () => {
    mainWindow?.minimize()
  })
  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_e, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.FILE_GET_VIDEO_URL, async (_e, videoPath: string) => {
    return buildMediaUrl(videoPath)
  })

  // ----- 视频 -----
  ipcMain.handle(IPC.VIDEO_GET_INFO, async (_e, videoPath: string) => {
    return await getVideoInfo(videoPath)
  })

  // ----- 剧本生成 -----
  ipcMain.handle(IPC.SCRIPT_START, async (e, args: { projectId: string; videoPath: string; master?: string }) => {
    const sender = e.sender
    const jobId = await jobManager.start(args, sender)
    return { jobId }
  })
  ipcMain.handle(IPC.SCRIPT_CANCEL, async (_e, jobId: string) => {
    return { ok: jobManager.cancel(jobId) }
  })

  // ----- 剧本多版本 + 编辑 -----
  ipcMain.handle(IPC.SCRIPT_VERSIONS_LIST, async (_e, projectId: string) => {
    return await listScriptVersions(projectId)
  })
  ipcMain.handle(
    IPC.SCRIPT_VERSIONS_SWITCH,
    async (e, args: { projectId: string; versionId: string }) => {
      await switchScriptVersion(args.projectId, args.versionId)
      if (!e.sender.isDestroyed()) e.sender.send(IPC.EVENT_PROJECT_UPDATED, { id: args.projectId })
      return { ok: true }
    }
  )
  ipcMain.handle(
    IPC.SCRIPT_VERSIONS_DELETE,
    async (e, args: { projectId: string; versionId: string }) => {
      const info = await deleteScriptVersion(args.projectId, args.versionId)
      if (!e.sender.isDestroyed()) e.sender.send(IPC.EVENT_PROJECT_UPDATED, { id: args.projectId })
      return info
    }
  )
  ipcMain.handle(IPC.PROJECT_SAVE_SCRIPT, async (e, args: { projectId: string; content: string }) => {
    await updateActiveScriptContent(args.projectId, args.content)
    if (!e.sender.isDestroyed()) e.sender.send(IPC.EVENT_PROJECT_UPDATED, { id: args.projectId })
    return { ok: true }
  })

  // ----- 分镜表 -----
  ipcMain.handle(
    IPC.STORYBOARD_START,
    async (
      e,
      args: {
        projectId: string
        videoPath: string
        cutParams?: import('@shared/types').CutParams
        skipConfirm?: boolean
        master?: string
      }
    ) => {
      const sender = e.sender
      const jobId = await storyboardManager.start(args, sender)
      return { jobId }
    }
  )
  ipcMain.handle(IPC.STORYBOARD_CANCEL, async (_e, jobId: string) => {
    return { ok: storyboardManager.cancel(jobId) }
  })
  ipcMain.handle(
    IPC.STORYBOARD_CONFIRM_CUT,
    async (_e, args: { jobId: string; decision: import('@shared/types').StoryboardCutDecision }) => {
      return { ok: await storyboardManager.decideCut(args.jobId, args.decision) }
    }
  )
  ipcMain.handle(
    IPC.STORYBOARD_ADD_PREVIEW_CUT,
    async (
      e,
      args: {
        jobId: string
        method: import('@shared/types').CutParams['method']
        timeSec: number
      }
    ) => {
      return await storyboardManager.addPreviewCut(args, e.sender)
    }
  )
  ipcMain.handle(
    IPC.STORYBOARD_REANALYZE,
    async (e, args: { projectId: string; indices: number[] }) => {
      return await storyboardManager.reanalyze(args, e.sender)
    }
  )
  ipcMain.handle(
    IPC.STORYBOARD_ADD_SHOT,
    async (e, args: { projectId: string; timeSec: number }) => {
      return await storyboardManager.addShot(args, e.sender)
    }
  )
  ipcMain.handle(
    IPC.STORYBOARD_MOVE_SHOT,
    async (e, args: { projectId: string; index: number; timeSec: number }) => {
      return await storyboardManager.moveShot(args, e.sender)
    }
  )
  ipcMain.handle(
    IPC.STORYBOARD_UPDATE_SHOT,
    async (
      e,
      args: {
        projectId: string
        index: number
        fields: Partial<
          Pick<
            import('@shared/types').StoryboardShot,
            'shotType' | 'angle' | 'cameraMove' | 'description' | 'dialogue' | 'sound'
          >
        >
      }
    ) => {
      return await storyboardManager.updateShot(args, e.sender)
    }
  )
  ipcMain.handle(
    IPC.STORYBOARD_DELETE_SHOT,
    async (e, args: { projectId: string; index: number }) => {
      return await storyboardManager.deleteShot(args, e.sender)
    }
  )

  // ----- 分镜表导入（老路径，用于把老 storyboards/<id>/ 目录变成项目） -----
  ipcMain.handle(IPC.STORYBOARD_PICK_PROJECT, async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择分镜表项目',
      properties: ['openDirectory'],
      buttonLabel: '导入',
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.STORYBOARD_LOAD_PROJECT, async (_e, projectDir: string) => {
    return await loadStoryboardProject(projectDir)
  })

  // ----- 项目管理 -----
  ipcMain.handle(IPC.PROJECT_LIST, async () => {
    return await listProjects()
  })

  ipcMain.handle(IPC.PROJECT_CREATE, async (_e, args: { name: string; videoPath: string }) => {
    return await createProject(args)
  })

  ipcMain.handle(IPC.PROJECT_RENAME, async (_e, args: { id: string; name: string }) => {
    return await renameProject(args.id, args.name)
  })

  ipcMain.handle(IPC.PROJECT_DELETE, async (_e, id: string) => {
    await deleteProject(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.PROJECT_LOAD, async (_e, id: string) => {
    return await loadProject(id)
  })

  ipcMain.handle(IPC.PROJECT_LOAD_SCRIPT, async (_e, id: string): Promise<ScriptResult | null> => {
    const project = await loadProject(id)
    if (!project) return null
    const text = await readScriptMd(id)
    if (text === null) return null
    let durationSec = 0
    try {
      if (project.videoPath && existsSync(project.videoPath)) {
        const info = await getVideoInfo(project.videoPath)
        durationSec = info.durationSec
      }
    } catch { /* ignore */ }
    const scenes = parseScript(text)
    if (durationSec === 0 && scenes.length > 0) {
      durationSec = scenes[scenes.length - 1].startSec + 30
    }
    return {
      jobId: `load-${id}`,
      videoPath: project.videoPath,
      durationSec,
      script: text,
      scenes,
      generatedInMs: 0,
      generatedAt: project.updatedAt,
    }
  })

  ipcMain.handle(IPC.PROJECT_LOAD_STORYBOARD, async (_e, id: string): Promise<StoryboardProject | null> => {
    return await readStoryboard(id)
  })

  ipcMain.handle(IPC.PROJECT_LOAD_SCENE_SCORES, async (_e, id: string) => {
    return await readSceneScores(id)
  })

  ipcMain.handle(IPC.PROJECT_OPEN_DIR, async (_e, id: string) => {
    const dir = getProjectDir(id)
    if (existsSync(dir)) {
      shell.openPath(dir)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle(IPC.PROJECT_EXPORT_SCRIPT_DOCX, async (_e, projectId: string) => {
    if (!mainWindow) return null
    const text = await readScriptMd(projectId)
    if (!text) return null

    let durationSec = 0
    try {
      const project = await loadProject(projectId)
      if (project?.videoPath && existsSync(project.videoPath)) {
        const info = await getVideoInfo(project.videoPath)
        durationSec = info.durationSec
      }
    } catch { /* ignore */ }

    const scenes = parseScript(text)
    const result: ScriptResult = {
      jobId: `export-${projectId}`,
      videoPath: '',
      durationSec,
      script: text,
      scenes,
      generatedInMs: 0,
      generatedAt: Date.now(),
    }

    const buffer = await generateScriptDocx(result)
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出剧本',
      defaultPath: '剧本.docx',
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, buffer)
    return res.filePath
  })

  ipcMain.handle(IPC.PROJECT_EXPORT_STORYBOARD_XLSX, async (_e, projectId: string) => {
    if (!mainWindow) return null
    const sbProject = await readStoryboard(projectId)
    if (!sbProject) return null

    let duration = 0
    try {
      const project = await loadProject(projectId)
      if (project?.videoPath && existsSync(project.videoPath)) {
        const info = await getVideoInfo(project.videoPath)
        duration = info.durationSec
      }
    } catch { /* ignore */ }

    const tmpPath = path.join(app.getPath('temp'), `storyboard-${projectId}.xlsx`)
    await generateStoryboardXlsx(sbProject.shots, sbProject.framePaths, tmpPath, duration)

    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出分镜表',
      defaultPath: '分镜表.xlsx',
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    })
    if (res.canceled || !res.filePath) {
      try { await fs.unlink(tmpPath) } catch {}
      return null
    }
    await fs.copyFile(tmpPath, res.filePath)
    try { await fs.unlink(tmpPath) } catch {}
    return res.filePath
  })

  ipcMain.handle(IPC.PROJECT_EXPORT_HTML, async (_e, projectId: string) => {
    if (!mainWindow) return null

    const project = await loadProject(projectId)
    const scriptText = await readScriptMd(projectId)
    const sbProject = await readStoryboard(projectId)

    // 至少要有剧本或分镜之一
    const hasScript = !!scriptText && scriptText.trim().length > 0
    const hasStoryboard = !!sbProject && sbProject.shots.length > 0
    if (!hasScript && !hasStoryboard) return null

    const formatBytes = (b: number): string => {
      if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`
      if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`
      if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`
      return `${b} B`
    }
    const formatBitrate = (bps: number): string => {
      if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`
      if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} kbps`
      return `${Math.round(bps)} bps`
    }
    const formatFps = (f: number): string => {
      const r = Math.round(f * 100) / 100
      return Number.isInteger(r) ? String(r) : r.toFixed(2)
    }

    let durationSec = 0
    let videoMeta:
      | { resolution: string; fps: string; bitrate: string; size: string; codec: string }
      | undefined
    try {
      if (project?.videoPath && existsSync(project.videoPath)) {
        const info = await getVideoInfo(project.videoPath)
        durationSec = info.durationSec
        const bps =
          info.bitrateBps > 0
            ? info.bitrateBps
            : info.sizeBytes > 0 && info.durationSec > 0
              ? (info.sizeBytes * 8) / info.durationSec
              : 0
        videoMeta = {
          resolution: info.width && info.height ? `${info.width}×${info.height}` : '',
          fps: info.fps > 0 ? formatFps(info.fps) : '',
          bitrate: bps > 0 ? formatBitrate(bps) : '',
          size: info.sizeBytes > 0 ? formatBytes(info.sizeBytes) : '',
          codec: info.videoCodec || '',
        }
      }
    } catch { /* ignore */ }

    const videoName = project?.videoPath ? project.videoPath.replace(/.*[\\/]/, '') : ''
    const scenes = hasScript ? parseScript(scriptText as string) : []

    // 剧本场景关键帧：按每个场景时间码从视频抓帧（剧本本身不含截图）。
    // 写到临时目录，generateProjectHtml 读取并内嵌为 base64 后即清理。
    let sceneFramePaths: string[] = []
    let sceneFramesDir: string | null = null
    const canCaptureScenes =
      hasScript && scenes.length > 0 && !!project?.videoPath && existsSync(project.videoPath)
    if (canCaptureScenes) {
      sceneFramesDir = path.join(app.getPath('temp'), `v2s-scene-frames-${projectId}-${Date.now()}`)
      await fs.mkdir(sceneFramesDir, { recursive: true })
      sceneFramePaths = new Array(scenes.length).fill('')
      // 限并发抓帧，避免一次性拉起过多 ffmpeg
      const CONCURRENCY = 4
      let next = 0
      const workers = Array.from({ length: Math.min(CONCURRENCY, scenes.length) }, async () => {
        while (next < scenes.length) {
          const i = next++
          try {
            sceneFramePaths[i] = await extractFrame(
              project!.videoPath,
              scenes[i].startSec,
              sceneFramesDir as string
            )
          } catch {
            sceneFramePaths[i] = ''
          }
        }
      })
      await Promise.all(workers)
    }

    let html: string
    try {
      html = await generateProjectHtml({
        projectName: project?.name || '未命名项目',
        videoName,
        durationSec,
        videoMeta,
        scenes,
        shots: hasStoryboard ? sbProject!.shots : [],
        framePaths: hasStoryboard ? sbProject!.framePaths : [],
        sceneFramePaths,
        generatedAt: Date.now(),
      })
    } finally {
      if (sceneFramesDir) {
        try { await fs.rm(sceneFramesDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }

    const safeName = (project?.name || '剧本分镜').replace(/[\\/:*?"<>|]/g, '_')
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出网页',
      defaultPath: `${safeName}.html`,
      filters: [{ name: '网页', extensions: ['html'] }],
    })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, html, 'utf-8')
    return res.filePath
  })

  ipcMain.handle(IPC.PROJECT_IMPORT_SCRIPT, async () => {
    if (!mainWindow) return null
    // 1. 选剧本
    const scriptRes = await dialog.showOpenDialog(mainWindow, {
      title: '选择剧本文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (scriptRes.canceled || scriptRes.filePaths.length === 0) return null
    const scriptPath = scriptRes.filePaths[0]

    // 2. 选视频（可选）
    const videoRes = await dialog.showOpenDialog(mainWindow, {
      title: '选择关联视频（可选，取消则不绑定视频）',
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    const videoPath = videoRes.canceled || videoRes.filePaths.length === 0 ? '' : videoRes.filePaths[0]

    // 3. 创建项目并写入 script.md
    const name = videoPath
      ? path.basename(videoPath, path.extname(videoPath))
      : path.basename(scriptPath, path.extname(scriptPath))
    const project = await createProject({ name, videoPath })
    const content = await fs.readFile(scriptPath, 'utf-8')
    await writeScriptMd(project.id, content)
    return await loadProject(project.id)
  })

  ipcMain.handle(IPC.PROJECT_IMPORT_STORYBOARD, async () => {
    if (!mainWindow) return null
    const dirRes = await dialog.showOpenDialog(mainWindow, {
      title: '选择分镜表项目目录',
      properties: ['openDirectory'],
      buttonLabel: '导入',
    })
    if (dirRes.canceled || dirRes.filePaths.length === 0) return null
    const sourceDir = dirRes.filePaths[0]
    const sbProject = await loadStoryboardProject(sourceDir)
    if (!sbProject) {
      throw new Error('目录中未找到 storyboard.md，请重新选择')
    }
    const name = sbProject.videoPath
      ? path.basename(sbProject.videoPath, path.extname(sbProject.videoPath))
      : path.basename(sourceDir)
    const newProject = await createProject({ name, videoPath: sbProject.videoPath })

    // 复制截图到新项目的 frames/
    const newFramesDir = getProjectFramesDir(newProject.id)
    await fs.mkdir(newFramesDir, { recursive: true })
    const newFramePaths: string[] = []
    for (const frame of sbProject.framePaths) {
      if (!frame || !existsSync(frame)) {
        newFramePaths.push('')
        continue
      }
      const dest = path.join(newFramesDir, path.basename(frame))
      try {
        await fs.copyFile(frame, dest)
        newFramePaths.push(dest)
      } catch {
        newFramePaths.push('')
      }
    }

    await writeStoryboardMd(newProject.id, {
      ...sbProject,
      id: newProject.id,
      framePaths: newFramePaths,
    })

    // 项目目录里的曲线和人工切点覆盖也属于分镜数据；有则一并迁移。
    // 覆盖层经标准写入口清洗并原子落盘，损坏的可选 sidecar 不阻断主体导入。
    const sourceSceneScores = path.join(sourceDir, 'scene-scores.json')
    if (existsSync(sourceSceneScores)) {
      await fs.copyFile(sourceSceneScores, getProjectSceneScoresPath(newProject.id)).catch(() => {})
    }
    const sourceOverrides = path.join(sourceDir, 'storyboard-boundary-overrides.json')
    if (existsSync(sourceOverrides)) {
      try {
        const overrides = JSON.parse(await fs.readFile(sourceOverrides, 'utf-8'))
        await updateStoryboardBoundaryOverrides(newProject.id, () => overrides)
      } catch {
        // 可选覆盖层损坏时，已导入的 storyboard.md 仍然可正常使用。
      }
    }

    return await loadProject(newProject.id)
  })

  // ----- 风格研究 -----
  ipcMain.handle(IPC.FILE_PICK_VIDEOS, async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择多个视频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths
  })

  ipcMain.handle(IPC.RESEARCH_LIST, async () => {
    return await listResearch()
  })

  ipcMain.handle(IPC.RESEARCH_CREATE, async (_e, args: { name: string; videoPaths: string[] }) => {
    return await createResearch(args)
  })

  ipcMain.handle(IPC.RESEARCH_LOAD, async (_e, id: string) => {
    return await loadResearch(id)
  })

  ipcMain.handle(IPC.RESEARCH_RENAME, async (_e, args: { id: string; name: string }) => {
    return await renameResearch(args.id, args.name)
  })

  ipcMain.handle(IPC.RESEARCH_DELETE, async (_e, id: string) => {
    await deleteResearch(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.RESEARCH_LOAD_STYLE_GUIDE, async (_e, id: string) => {
    return await readStyleGuide(id)
  })

  ipcMain.handle(IPC.RESEARCH_LOAD_SUB_STORYBOARD, async (_e, args: { id: string; subIndex: number }) => {
    const loaded = await loadResearch(args.id)
    if (!loaded) return null
    const subVideoPath = loaded.meta.videoPaths[args.subIndex - 1]
    if (!subVideoPath) return null
    const subDir = getSubDir(args.id, args.subIndex, subVideoPath)
    return await loadStoryboardProject(subDir)
  })

  ipcMain.handle(IPC.RESEARCH_OPEN_DIR, async (_e, id: string) => {
    const dir = getResearchDir(id)
    if (existsSync(dir)) {
      shell.openPath(dir)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle(IPC.RESEARCH_START, async (e, args: { researchId: string }) => {
    const sender = e.sender
    const jobId = await researchManager.start(args, sender)
    return { jobId }
  })

  ipcMain.handle(IPC.RESEARCH_CANCEL, async (_e, jobId: string) => {
    return { ok: researchManager.cancel(jobId) }
  })

  ipcMain.handle(IPC.RESEARCH_ADD_VIDEOS, async (_e, id: string, videoPaths: string[]) => {
    return addVideosToResearch(id, videoPaths)
  })
}

app.whenReady().then(async () => {
  // 发布包冒烟测试：主进程的所有静态 import 已成功解析后才会执行到这里。
  // 用于从最终 DMG / Windows 免安装 EXE 直接启动验证，避免漏打运行时依赖。
  if (process.argv.includes('--smoke-test')) {
    const smokeResult = 'XLB_STORYBOARD_PACKAGED_RUNTIME_OK'
    const markerPath = process.env.XLB_STORYBOARD_SMOKE_MARKER
    if (markerPath) await fs.writeFile(markerPath, smokeResult, 'utf8')
    console.log(smokeResult)
    app.exit(0)
    return
  }

  // 配置/代理初始化失败也绝不能阻塞建窗（否则表现为「双击没反应、起不来」）
  try {
    // 先把数据根 / 代理解析注入 core/runtime（必须早于任何 getDataRoot / 网络调用）
    setDataRootResolver(resolveDataRootElectron)
    setProxyResolver(electronProxyResolver)
    // 再加载配置 + 注入全局 fetch（让 SDK 走系统代理 / 用户指定代理）
    const cfg = await loadConfig()
    applyProxyEnv(cfg.gemini)
    await installGlobalFetch(cfg.gemini.proxy)
    // 0.2.0：旧 distillations/ 数据目录改名为 research/（尽力而为，失败不阻塞）
    await migrateLegacyResearchDir()
  } catch (e) {
    console.error('[main] 配置/代理初始化失败，按默认状态继续启动:', e)
  }

  // macOS：显式设置 dock 图标（猫脸 logo）。否则 dev 运行时 dock 会显示 Electron 默认图标，
  // 打包版也仅依赖系统图标缓存，缓存陈旧时会回退成通用图标。
  if (process.platform === 'darwin' && app.dock) {
    const icon = loadAppIcon()
    if (!icon.isEmpty()) app.dock.setIcon(icon)
  }

  registerMediaProtocol()
  registerIpc()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => {
  // 兜底：启动期任何未捕获错误都弹窗暴露，而不是静默无窗口（无法定位）
  console.error('[main] 启动失败:', err)
  try {
    dialog.showErrorBox('启动失败', String(err?.stack || err?.message || err))
  } catch {
    /* ignore */
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 处理未捕获异常，避免主进程崩
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException', err)
})

process.on('unhandledRejection', (err) => {
  console.error('[main] unhandledRejection', err)
})
