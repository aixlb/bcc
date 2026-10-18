/**
 * 构建自包含 skill 运行时：skills/bcc/bin/bcc.cjs。
 *
 * 与 build-cli 的区别：把所有 JS 依赖（含 tar/undici/docx/exceljs 等）全部内联进单文件，
 * 唯一不内联的是 node 内置模块与 ffmpeg/ffprobe 二进制（由 ffmpeg-runtime 在运行时解析/按需下载）。
 * 这样 skill 使用者无需 npm i -g @aixlb/bcc，直接 node bin/bcc.cjs 即可。
 *
 * 产物随 skills/bcc 一起提交到本仓库，安装 skill 后即可离线调用 CLI。
 * 输出用 CJS：google-auth-library 等依赖有动态 require，CJS 下原生支持。
 */
import esbuild from 'esbuild'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

await esbuild.build({
  entryPoints: ['apps/bcc-cli/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  banner: {
    js: 'const __bccModuleUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  outfile: 'skills/bcc/bin/bcc.cjs',
  alias: {
    '@shared': resolve('packages/bcc-core/src/shared'),
    '@core': resolve('packages/bcc-core/src'),
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    'import.meta.url': '__bccModuleUrl',
  },
  // 全量内联（除 node 内置模块）；ffmpeg-static/ffprobe-static 已不再被静态 import
  logLevel: 'info',
})

console.log('[build-skill] skills/bcc/bin/bcc.cjs 已生成（自包含，除 node 内置与 ffmpeg 二进制外零外部依赖）')
