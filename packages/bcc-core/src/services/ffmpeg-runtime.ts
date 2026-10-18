/**
 * ffmpeg / ffprobe 二进制解析与按需下载（自包含运行时的核心）。
 *
 * 解析优先级（找到即停）：
 *   1. BCC_FFMPEG_PATH / BCC_FFPROBE_PATH 环境变量（CLI --ffmpeg-path/--ffprobe-path 注入）
 *   2. BCC_RUNTIME_DIR 根目录下的 ffmpeg(.exe)/ffprobe(.exe)（用户自备运行时目录）
 *   3. skill 自带的 runtime/ 目录（<skill>/bin/bcc.mjs 的 ../runtime）
 *   4. 本地 node_modules（ffmpeg-static/ffprobe-static）—— dev / Electron / 旧 npm 安装行为不变
 *   5. 本地缓存（默认 ~/.cache/bcc-runtime 或 %LOCALAPPDATA%\bcc-runtime）
 *   6. 自动下载到缓存：
 *      - ffmpeg  ← ffmpeg-static 官方 GitHub Release（按平台 gz 压缩，仅 ~40-80MB）
 *      - ffprobe ← npm registry 的 ffprobe-static tarball（内含全平台，取本平台二进制）
 *      下载走 globalThis.fetch（CLI 启动时已按配置挂代理），进度打印到 stderr（机器契约：stderr=进度）。
 *
 * 与 package.json dependencies 保持一致的固定版本：
 *   ffmpeg-static@5.3.0（GitHub release tag b6.1.1）
 *   ffprobe-static@3.1.0
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'
import { fetch as undiciFetch, ProxyAgent } from 'undici'

/** 断流判定：超过该时长无任何数据即中止（网络卡死时不能无限挂起） */
const STALL_MS = 90 * 1000
/** 单次下载整体超时 */
const OVERALL_TIMEOUT_MS = 30 * 60 * 1000

/**
 * 代理感知的 fetch：原生 fetch 不读 HTTPS_PROXY，这里用 undici 显式挂 ProxyAgent。
 * undici 在 skill bundle 中被内联、在 npm 包中是声明依赖，两种形态都可用。
 */
function proxyAwareFetch(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  const proxy =
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  const dispatcher = proxy?.trim() ? new ProxyAgent({ uri: proxy.trim() }) : undefined
  return undiciFetch(url, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>
}

/** 当前文件路径：CJS bundle（skill bcc.cjs）用原生 __filename，ESM bundle（npm bcc）用 import.meta.url */
function currentFile(): string {
  if (typeof __filename !== 'undefined') return __filename
  return fileURLToPath(import.meta.url)
}

/** 解析 require：CJS bundle 用原生 require，ESM bundle 用 createRequire(import.meta.url) */
function requireFromHere(id: string): unknown {
  if (typeof __filename !== 'undefined') return require(id)
  return createRequire(import.meta.url)(id)
}

/** ffmpeg-static@5.3.0 对应的 GitHub Release tag（下载地址: .../download/<tag>/ffmpeg-<platform>-<arch>.gz） */
const FFMPEG_RELEASE_TAG = 'b6.1.1'
/** ffprobe-static@3.1.0（tarball 内含全平台二进制） */
const FFPROBE_VERSION = '3.1.0'
/** npm 回退源：@ffmpeg-installer/<platform>-<arch>（二进制直接打包在 npm tarball 里，镜像可拉） */
const FFMPEG_INSTALLER_VERSION = '4.1.0'
/** npm 回退源：@ffprobe-installer/<platform>-<arch> */
const FFPROBE_INSTALLER_VERSION = '5.1.0'
/** 缓存目录内的版本子目录名（与上面两个版本对齐，换版本即换目录，避免混用） */
const FFMPEG_CACHE_DIR = `ffmpeg-${FFMPEG_RELEASE_TAG}`
const FFPROBE_CACHE_DIR = `ffprobe-${FFPROBE_VERSION}`

/** 下载锁最长等待（另一个进程正在下载时） */
const LOCK_WAIT_MS = 15 * 60 * 1000
/** 锁目录视为陈旧（进程崩溃遗留）的时长 */
const LOCK_STALE_MS = 30 * 60 * 1000

export interface FfmpegBinaries {
  ffmpeg: string
  ffprobe: string
}

let promise: Promise<FfmpegBinaries> | null = null

/**
 * 确保 ffmpeg/ffprobe 可用，返回两条二进制绝对路径。
 * 模块内缓存一次（含失败？不缓存失败——下次调用重试解析链）。
 */
export function ensureFfmpegBinaries(): Promise<FfmpegBinaries> {
  if (!promise) {
    promise = resolve().catch((err) => {
      promise = null
      throw err
    })
  }
  return promise
}

/** 仅 CLI 用：解析后打印实际采用的来源，便于排查 */
export async function describeFfmpegSource(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const bins = await ensureFfmpegBinaries()
  return { ffmpeg: bins.ffmpeg, ffprobe: bins.ffprobe }
}

async function resolve(): Promise<FfmpegBinaries> {
  // 1. 显式路径
  const explicitFfmpeg = process.env.BCC_FFMPEG_PATH?.trim()
  const explicitFfprobe = process.env.BCC_FFPROBE_PATH?.trim()
  if (explicitFfmpeg && explicitFfprobe) {
    if (!fs.existsSync(explicitFfmpeg)) throw new Error(`--ffmpeg-path 指向的文件不存在: ${explicitFfmpeg}`)
    if (!fs.existsSync(explicitFfprobe)) throw new Error(`--ffprobe-path 指向的文件不存在: ${explicitFfprobe}`)
    logSource('显式路径', explicitFfmpeg, explicitFfprobe)
    return { ffmpeg: explicitFfmpeg, ffprobe: explicitFfprobe }
  }

  // 2. BCC_RUNTIME_DIR 根目录
  const runtimeDir = process.env.BCC_RUNTIME_DIR?.trim()
  if (runtimeDir) {
    const bins = findInDir(runtimeDir)
    if (bins) {
      logSource(`BCC_RUNTIME_DIR (${runtimeDir})`, bins.ffmpeg, bins.ffprobe)
      return bins
    }
  }

  // 3. skill 自带 runtime/（bcc.cjs 位于 <skill>/bin/ 下）
  const skillRuntime = path.join(path.dirname(currentFile()), '..', 'runtime')
  const skillBins = findInDir(skillRuntime)
  if (skillBins) {
    logSource(`skill runtime (${skillRuntime})`, skillBins.ffmpeg, skillBins.ffprobe)
    return skillBins
  }

  // 4. 本地 node_modules（保持 dev / Electron / 声明了依赖的旧安装行为）
  const nm = resolveFromNodeModules()
  if (nm) {
    logSource('node_modules', nm.ffmpeg, nm.ffprobe)
    return nm
  }

  // 5. 缓存
  const cached = findInCache(cacheRoot())
  if (cached) {
    logSource(`缓存 (${cacheRoot()})`, cached.ffmpeg, cached.ffprobe)
    return cached
  }

  // 6. 自动下载
  const downloaded = await downloadAll(cacheRoot())
  logSource(`自动下载 (${cacheRoot()})`, downloaded.ffmpeg, downloaded.ffprobe)
  return downloaded
}

/** 在 dir 下找 ffmpeg(.exe)/ffprobe(.exe)（也接受 <dir>/<platform>-<arch>/ 布局） */
function findInDir(dir: string): FfmpegBinaries | null {
  const exe = process.platform === 'win32' ? '.exe' : ''
  for (const layout of [dir, path.join(dir, platformArch())]) {
    const ffmpeg = path.join(layout, `ffmpeg${exe}`)
    const ffprobe = path.join(layout, `ffprobe${exe}`)
    if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) return { ffmpeg, ffprobe }
  }
  return null
}

/** 通过 require 解析 ffmpeg-static/ffprobe-static（Electron 下 app.asar → app.asar.unpacked） */
function resolveFromNodeModules(): FfmpegBinaries | null {
  try {
    let ffmpeg = requireFromHere('ffmpeg-static') as string
    let ffprobe = (requireFromHere('ffprobe-static') as { path: string }).path
    if (typeof ffmpeg !== 'string' || !ffmpeg) ffmpeg = ''
    ffmpeg = ffmpeg.replace('app.asar', 'app.asar.unpacked')
    ffprobe = ffprobe.replace('app.asar', 'app.asar.unpacked')
    if (ffmpeg && ffprobe && fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) {
      return { ffmpeg, ffprobe }
    }
  } catch {
    /* 未安装这些包：继续走缓存/下载 */
  }
  return null
}

function platformArch(): string {
  return `${process.platform}-${process.arch}`
}

function exeName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

function cacheRoot(): string {
  if (process.env.BCC_RUNTIME_DIR?.trim()) return path.resolve(process.env.BCC_RUNTIME_DIR.trim())
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'bcc-runtime')
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'bcc-runtime')
}

function findInCache(root: string): FfmpegBinaries | null {
  const key = platformArch()
  const ffmpeg = path.join(root, FFMPEG_CACHE_DIR, key, exeName('ffmpeg'))
  const ffprobe = path.join(root, FFPROBE_CACHE_DIR, key, exeName('ffprobe'))
  if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) return { ffmpeg, ffprobe }
  return null
}

async function downloadAll(root: string): Promise<FfmpegBinaries> {
  const key = platformArch()
  const ffmpegFinal = path.join(root, FFMPEG_CACHE_DIR, key, exeName('ffmpeg'))
  const ffprobeFinal = path.join(root, FFPROBE_CACHE_DIR, key, exeName('ffprobe'))
  const ffmpegExists = fs.existsSync(ffmpegFinal)
  const ffprobeExists = fs.existsSync(ffprobeFinal)

  // 并发安全：同一目标目录用锁目录串行化；其他进程已下载完则直接复用
  const locks: Array<Promise<void>> = []
  if (!ffmpegExists) locks.push(withLock(ffmpegFinal, () => ensureDownloadedFfmpeg(ffmpegFinal)))
  if (!ffprobeExists) locks.push(withLock(ffprobeFinal, () => ensureDownloadedFfprobe(ffprobeFinal)))
  await Promise.all(locks)

  return { ffmpeg: ffmpegFinal, ffprobe: ffprobeFinal }
}

/**
 * 锁机制：mkdir 原子占锁；已存在则轮询等待（对方可能正在下载，完成后 final 文件出现）。
 * 陈旧锁（超过 LOCK_STALE_MS）强制接管。
 */
async function withLock(finalPath: string, work: () => Promise<void>): Promise<void> {
  const lockDir = `${finalPath}.lock`
  const started = Date.now()
  // 等待他人完成
  while (fs.existsSync(lockDir)) {
    if (fs.existsSync(finalPath)) return
    const st = await fsp.stat(lockDir).catch(() => null)
    if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
      await fsp.rm(lockDir, { recursive: true, force: true })
      break
    }
    if (Date.now() - started > LOCK_WAIT_MS) {
      throw new Error(`等待其他进程下载超时（锁: ${lockDir}）。删除该目录后重试。`)
    }
    await sleep(2000)
  }
  await fsp.mkdir(lockDir, { recursive: true })
  try {
    if (fs.existsSync(finalPath)) return
    await work()
  } finally {
    await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {})
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** npm registry 基础地址（镜像用户可用 BCC_NPM_REGISTRY 覆盖，如 https://registry.npmmirror.com） */
function npmRegistryBase(): string {
  return (
    process.env.BCC_NPM_REGISTRY?.trim() ||
    process.env.npm_config_registry?.trim() ||
    'https://registry.npmjs.org'
  ).replace(/\/+$/, '')
}

/** 组装 npm tarball URL（支持 scoped 与普通包名） */
function npmTarballUrl(pkg: string, version: string): string {
  const base = npmRegistryBase()
  const slash = pkg.indexOf('/')
  if (slash >= 0) {
    const scope = pkg.slice(0, slash)
    const name = pkg.slice(slash + 1)
    return `${base}/${scope}/${name}/-/${name}-${version}.tgz`
  }
  return `${base}/${pkg}/-/${pkg}-${version}.tgz`
}

async function ensureDownloadedFfmpeg(finalPath: string): Promise<void> {
  const key = platformArch()
  // 与 ffmpeg-static 官方 install.js 一致的平台清单
  const supported = [
    'darwin-arm64', 'darwin-x64', 'linux-arm', 'linux-arm64', 'linux-ia32', 'linux-x64', 'win32-ia32', 'win32-x64',
  ]
  if (!supported.includes(key)) {
    throw new Error(`不支持的平台 ${key}：请用 --ffmpeg-path 指定已有 ffmpeg 二进制`)
  }
  // 主源：官方 GitHub Release（gz 压缩，体积小）；失败回退 npm 源（国内镜像友好）
  const ghUrl =
    process.env.BCC_FFMPEG_URL?.trim() ||
    `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE_TAG}/ffmpeg-${key}.gz`
  try {
    await downloadFile(ghUrl, finalPath, 'ffmpeg', true)
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    console.error(`[bcc] GitHub 源不可用（${msg}），改用 npm 源下载 ffmpeg`)
    const npmUrl = npmTarballUrl(`@ffmpeg-installer/${key}`, FFMPEG_INSTALLER_VERSION)
    await downloadFile(npmUrl, finalPath, 'ffmpeg', false, `package/${exeName('ffmpeg')}`)
  }
}

async function ensureDownloadedFfprobe(finalPath: string): Promise<void> {
  const key = platformArch()
  // ffprobe-static 包内的平台目录
  const platformDir: Record<string, string> = {
    'darwin-arm64': 'darwin/arm64',
    'darwin-x64': 'darwin/x64',
    'linux-ia32': 'linux/ia32',
    'linux-x64': 'linux/x64',
    'win32-ia32': 'win32/ia32',
    'win32-x64': 'win32/x64',
  }
  const dir = platformDir[key]
  if (!dir) {
    throw new Error(`不支持的平台 ${key}：请用 --ffprobe-path 指定已有 ffprobe 二进制`)
  }
  // 主源：ffprobe-static 全平台 tarball（ffprobe 较新）；失败回退 @ffprobe-installer 单平台包（体积小）
  const primaryUrl =
    process.env.BCC_FFPROBE_URL?.trim() || npmTarballUrl('ffprobe-static', FFPROBE_VERSION)
  try {
    await downloadFile(primaryUrl, finalPath, 'ffprobe', false, `package/bin/${dir}/${exeName('ffprobe')}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    console.error(`[bcc] ffprobe-static 源不可用（${msg}），改用 @ffprobe-installer 单平台包`)
    const npmUrl = npmTarballUrl(`@ffprobe-installer/${key}`, FFPROBE_INSTALLER_VERSION)
    await downloadFile(npmUrl, finalPath, 'ffprobe', false, `package/${exeName('ffprobe')}`)
  }
}

/** 下载单个文件到 finalPath；gzip 参数决定是否解压；tarEntry 非空时从 tarball 中抽取该条目。失败自动重试一次。 */
async function downloadFile(
  url: string,
  finalPath: string,
  label: string,
  gzip: boolean,
  tarEntry?: string
): Promise<void> {
  const attemptLog = (n: number) =>
    console.error(`[bcc] 首次运行：下载 ${label} 到本地缓存（第 ${n} 次尝试）(${url})`)
  attemptLog(1)
  try {
    await downloadOnce(url, finalPath, label, gzip, tarEntry)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[bcc] ${label} 下载中断，自动重试一次: ${msg}`)
    attemptLog(2)
    await downloadOnce(url, finalPath, label, gzip, tarEntry)
  }
}

async function downloadOnce(
  url: string,
  finalPath: string,
  label: string,
  gzip: boolean,
  tarEntry?: string
): Promise<void> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bcc-dl-'))
  const rawPath = path.join(tmpDir, 'download.bin')

  // 超时控制：90s 无数据 → 断流中止；30 分钟总超时
  const ac = new AbortController()
  let lastReceived = Date.now()
  const watchdog = setInterval(() => {
    if (Date.now() - lastReceived > STALL_MS) ac.abort(new Error('90 秒未收到数据，连接可能已中断'))
  }, 10_000)
  const overall = setTimeout(() => ac.abort(new Error('下载超时（30 分钟）')), OVERALL_TIMEOUT_MS)

  try {
    const res = await proxyAwareFetch(url, { redirect: 'follow', signal: ac.signal })
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`)
    }
    const total = Number(res.headers.get('content-length')) || 0
    let received = 0
    let lastReport = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        lastReceived = Date.now()
        if (received - lastReport >= 10 * 1024 * 1024) {
          lastReport = received
          const pct = total > 0 ? ` ${Math.round((received / total) * 100)}%` : ''
          console.error(`[bcc] 已下载 ${label} ${(received / 1048576).toFixed(0)}MB${total > 0 ? ` / ${(total / 1048576).toFixed(0)}MB${pct}` : ''}`)
        }
        cb(null, chunk)
      },
    })
    const out = fs.createWriteStream(rawPath)
    if (gzip) {
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), counter, zlib.createGunzip(), out)
    } else {
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), counter, out)
    }

    await fsp.mkdir(path.dirname(finalPath), { recursive: true })
    if (tarEntry) {
      await tar.extract({
        file: rawPath,
        cwd: tmpDir,
        filter: (p) => p === tarEntry,
        strict: true,
      })
      const extracted = path.join(tmpDir, tarEntry)
      if (!fs.existsSync(extracted)) {
        throw new Error(`tarball 中未找到 ${tarEntry}（${url}）`)
      }
      await fsp.rename(extracted, finalPath)
    } else {
      await fsp.rename(rawPath, finalPath)
    }
    if (process.platform !== 'win32') await fsp.chmod(finalPath, 0o755)
    console.error(`[bcc] ${label} 就绪: ${finalPath}`)
  } catch (err) {
    await fsp.rm(finalPath, { force: true }).catch(() => {})
    const hint =
      process.env.HTTPS_PROXY || process.env.https_proxy
        ? '当前已设置 HTTPS_PROXY，请确认代理可用'
        : '网络不可达时可配置代理（HTTPS_PROXY 或 bcc config set gemini.proxy）后重试，或自备二进制：--ffmpeg-path/--ffprobe-path'
    throw new Error(`${label}: ${(err as Error).message}\n提示: ${hint}`)
  } finally {
    clearInterval(watchdog)
    clearTimeout(overall)
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function logSource(kind: string, ffmpeg: string, ffprobe: string): void {
  console.error(`[bcc] ffmpeg 来源(${kind}): ${ffmpeg}`)
  console.error(`[bcc] ffprobe 来源(${kind}): ${ffprobe}`)
}
