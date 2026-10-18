/**
 * CLI 运行上下文装配：智能数据根 + 配置加载 + 代理/全局 fetch。
 *
 * 数据根优先级（与 GUI 共用同一份 config + 项目库）：
 *   --data-dir 参数 > BCC_DATA_DIR 环境变量 > cwd 有 config.yaml/data 则用 cwd（贴合 npm run dev）
 *   > 平台 userData（贴合已安装 GUI；productName 必须为 XLB Storyboard 才能共用）
 */
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import type { AppConfig } from '@shared/types'
import {
  setDataRoot,
  loadConfig,
  applyProxyEnv,
  installGlobalFetch,
  migrateLegacyResearchDir,
} from '@core/index.js'

/** 必须与 electron build.productName 一致，否则 CLI 与安装版 GUI 不共用数据目录 */
const PRODUCT_NAME = 'XLB Storyboard'

/** 复刻 Electron app.getPath('userData') 的平台路径 */
function platformUserData(): string {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', PRODUCT_NAME)
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), PRODUCT_NAME)
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), PRODUCT_NAME)
}

/**
 * 返回数据根（即 <appDir>/data）。config.yaml 始终位于其同级（dirname）。
 * --data-dir / BCC_DATA_DIR 给的是「应用目录」appDir（内含 config.yaml 与 data/），与 GUI 语义一致。
 */
export function resolveDataRoot(explicit?: string): string {
  if (explicit?.trim()) return path.join(path.resolve(explicit.trim()), 'data')
  const env = process.env.BCC_DATA_DIR?.trim()
  if (env) return path.join(path.resolve(env), 'data')
  const cwd = process.cwd()
  if (existsSync(path.join(cwd, 'config.yaml')) || existsSync(path.join(cwd, 'data'))) {
    return path.join(cwd, 'data')
  }
  return path.join(platformUserData(), 'data')
}

export interface BootstrapOptions {
  dataDir?: string
  /** 是否装配全局 fetch / 代理（拆剧本/分镜/研究等联网命令需要；纯 config 读写不需要） */
  network?: boolean
  /** 输出数据根到 stderr，便于排查 */
  verbose?: boolean
}

export interface CliContext {
  config: AppConfig
  dataRoot: string
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<CliContext> {
  const dataRoot = resolveDataRoot(opts.dataDir)
  setDataRoot(dataRoot)
  if (opts.verbose) process.stderr.write(`[bcc] dataRoot=${dataRoot}\n`)
  await migrateLegacyResearchDir()
  const config = await loadConfig()
  if (opts.network) {
    applyProxyEnv(config.gemini)
    await installGlobalFetch(config.gemini.proxy)
  }
  return { config, dataRoot }
}
