/**
 * 跨平台 dev 启动脚本
 * Windows 下先把控制台代码页切到 UTF-8（65001），避免中文日志乱码；
 * macOS / Linux 终端默认即为 UTF-8，直接启动 electron-vite。
 */
import { spawnSync } from 'node:child_process'

const isWin = process.platform === 'win32'

// 仅在 Windows 上切换控制台代码页（chcp 是 cmd 内建命令）
if (isWin) {
  spawnSync('chcp', ['65001'], { stdio: 'ignore', shell: true })
}

const result = spawnSync('electron-vite', ['dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
})

process.exit(result.status ?? (result.signal ? 1 : 0))
