/**
 * 挂载最终 DMG，并直接运行包内 Electron 主进程的发布冒烟测试。
 * 顶层 import 有任何运行时依赖漏包（例如 @google/genai → p-retry）都会非零退出。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (process.platform !== 'darwin') {
  console.error('[smoke:mac-release] 仅支持 macOS')
  process.exit(1)
}

const root = process.cwd()
const version = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'package.json'), 'utf8'))
).version
const releaseDir = path.join(root, 'release')
const dmgs = process.argv.slice(2)
const targets = dmgs.length > 0
  ? dmgs.map((file) => path.resolve(file))
  : [
      path.join(releaseDir, `XLB Storyboard-${version}-arm64.dmg`),
      path.join(releaseDir, `XLB Storyboard-${version}.dmg`),
    ]

for (const dmg of targets) {
  if (!existsSync(dmg)) {
    console.error(`[smoke:mac-release] 找不到 DMG: ${dmg}`)
    process.exit(1)
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'xlb-release-smoke-'))

try {
  for (const [index, dmg] of targets.entries()) {
    const mountPoint = path.join(tempRoot, `mount-${index}`)
    mkdirSync(mountPoint)
    let mounted = false

    try {
      const attach = spawnSync(
        'hdiutil',
        ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mountPoint],
        { encoding: 'utf8', timeout: 60_000 }
      )
      if (attach.status !== 0) {
        throw new Error(`挂载失败 (${attach.status}): ${attach.stderr || attach.stdout}`)
      }
      mounted = true

      const binary = path.join(
        mountPoint,
        'XLB Storyboard.app',
        'Contents',
        'MacOS',
        'XLB Storyboard'
      )
      if (!existsSync(binary)) throw new Error(`DMG 中找不到应用主程序: ${binary}`)

      const run = spawnSync(binary, ['--smoke-test'], {
        encoding: 'utf8',
        // Apple Silicon 上首次通过 Rosetta 启动 x64 Electron 可能需要约一分钟。
        timeout: 120_000,
        env: { ...process.env },
      })
      const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
      if (run.error || run.status !== 0 || !output.includes('XLB_STORYBOARD_PACKAGED_RUNTIME_OK')) {
        throw new Error(
          `包内应用启动失败 (${run.status ?? run.signal ?? 'unknown'}):\n${run.error?.stack ?? output}`
        )
      }
      console.error(`[smoke:mac-release] 通过: ${path.basename(dmg)}`)
    } finally {
      if (mounted) {
        const detach = spawnSync('hdiutil', ['detach', mountPoint], {
          encoding: 'utf8',
          timeout: 60_000,
        })
        if (detach.status !== 0) {
          // 仅作用于本脚本创建的临时只读挂载点；异常退出时确保不遗留磁盘镜像。
          spawnSync('hdiutil', ['detach', mountPoint, '-force'], {
            encoding: 'utf8',
            timeout: 60_000,
          })
        }
      }
    }
  }
} catch (error) {
  console.error('[smoke:mac-release] 失败:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
