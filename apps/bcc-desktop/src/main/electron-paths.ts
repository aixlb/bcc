/**
 * Electron 专属的数据根目录解析（从原 services/paths.ts 抽出）。
 * 仅 main 进程使用：在 app.whenReady 后通过 setDataRootResolver 注入给 core/runtime。
 *
 * 关键要求：同一台机器上「跨重启稳定且可写」，否则关程序再打开会丢配置（如 API Key）。
 * 详见各分支注释。productName=「XLB Storyboard」决定 userData 路径，CLI 复用同一路径以共享数据。
 */
import { app } from 'electron'
import path from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'

/** portable 形态下，数据收纳进 exe 同级的这个 app 专属子目录里（避免撒在 exe 目录/盘根） */
const APP_DATA_DIRNAME = 'XLB Storyboard'

export function resolveDataRootElectron(): string {
  const appPath = app.getAppPath()
  const isPacked = appPath.includes('app.asar')

  if (!isPacked) {
    // 开发：项目根目录/data（appPath 是稳定的项目根，所以 dev 不会丢配置）
    return path.join(appPath, 'data')
  }

  if (process.platform === 'darwin') {
    // macOS 打包（含 MAS 沙盒）：userData/data（.app 包只读、/Applications 不可写）
    return path.join(app.getPath('userData'), 'data')
  }

  // Windows 打包
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
  if (portableDir) {
    // portable：数据收纳进 exe 同级的 app 专属子目录（避免盘根 mkdir EPERM 起不来）
    if (isWritableDir(portableDir)) {
      return path.join(portableDir, APP_DATA_DIRNAME, 'data')
    }
    return path.join(app.getPath('userData'), 'data')
  }

  // 安装 / 解压目录形态：沿用「安装目录/data」；盘根或不可写 → 回退 userData。
  const installDir = path.dirname(path.dirname(appPath))
  if (!isDriveRoot(installDir) && isWritableDir(installDir)) {
    return path.join(installDir, 'data')
  }
  return path.join(app.getPath('userData'), 'data')
}

/** 路径是否为盘符根（如 E:\ / C:\）：盘根的父目录等于自身，且对其 mkdir 在 Windows 会 EPERM */
function isDriveRoot(p: string): boolean {
  return path.dirname(p) === p
}

/** 用「写一个探测文件再删掉」判断目录是否真的可写（accessSync W_OK 在 Windows 上不可靠） */
function isWritableDir(dir: string): boolean {
  const probe = path.join(dir, '.v2s-write-test')
  try {
    writeFileSync(probe, '')
    return true
  } catch {
    return false
  } finally {
    try {
      unlinkSync(probe)
    } catch {
      /* 探测文件可能根本没写成功，忽略删除失败 */
    }
  }
}
