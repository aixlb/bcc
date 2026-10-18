/**
 * 构建纯 Node CLI（bcc）为单文件 ESM 包：out/cli/index.mjs。
 *
 * - 入口 apps/bcc-cli/src/index.ts（含 shebang，esbuild 会保留在产物顶部）
 * - bundle 自有源码（相对导入 + @shared 别名），node_modules 包保持 external，运行时解析
 * - 注入 __APP_VERSION__（取 package.json 版本）
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
  format: 'esm',
  outfile: 'out/cli/index.mjs',
  packages: 'external',
  alias: {
    '@shared': resolve('packages/bcc-core/src/shared'),
    '@core': resolve('packages/bcc-core/src'),
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  logLevel: 'info',
})

console.log('[build-cli] out/cli/index.mjs 已生成')
