/**
 * 构建 npm 发布包到 cli-dist/：
 *   1) 先 build:cli 生成 out/cli/index.mjs（单文件 ESM，core 已内联，node_modules external）
 *   2) 扫描产物里真正用到的外部依赖，从根 package.json 取版本范围（漏带就报错）
 *   3) 生成 cli-dist/package.json（name/bin/deps 等）并拷贝 bundle
 *
 * 发布流程：npm run build:publish → cd cli-dist → npm publish
 * cli-dist/index.mjs 与 package.json 是产物（.gitignore），README.md / .npmrc 是源文件（入库）。
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

const ROOT = process.cwd()
const BUNDLE = path.join(ROOT, 'out/cli/index.mjs')
const DIST = path.join(ROOT, 'cli-dist')

// 发布包的静态元数据（版本与依赖在下面动态注入）
const MANIFEST = {
  name: '@aixlb/bcc',
  version: '0.0.0',
  publishConfig: { access: 'public' },
  description: '包拆拆 bcc —— 视频转剧本/分镜/风格指南的命令行(纯 Node，给 Agent/脚本对接)',
  type: 'module',
  bin: { bcc: 'index.mjs' },
  files: ['index.mjs', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
  engines: { node: '>=20' },
  keywords: ['video', 'storyboard', 'script', 'gemini', 'cli', 'ai', 'agent'],
  author: '玩AI的小笼包',
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/aixlb/bcc.git', directory: 'apps/bcc-cli' },
  homepage: 'https://github.com/aixlb/bcc#readme',
  bugs: { url: 'https://github.com/aixlb/bcc/issues' },
}

console.error('[build-publish] 构建 CLI...')
execSync('npm run build:cli', { stdio: 'inherit' })

// 扫描 bundle 里所有 bare external 依赖（排除相对路径与 node 内建）
const code = readFileSync(BUNDLE, 'utf-8')
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])
const specs = new Set()
const patterns = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*["']([^"']+)["']/g,
]
for (const re of patterns) {
  for (const m of code.matchAll(re)) specs.add(m[1])
}

/** 'foo/bar' → 'foo'，'@scope/pkg/sub' → '@scope/pkg' */
function pkgRoot(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
const rootDeps = rootPkg.dependencies || {}

const needed = new Set()
for (const spec of specs) {
  if (spec.startsWith('.') || spec.startsWith('node:') || builtins.has(spec)) continue
  needed.add(pkgRoot(spec))
}

const dependencies = {}
const missing = []
for (const name of [...needed].sort()) {
  if (rootDeps[name]) dependencies[name] = rootDeps[name]
  else missing.push(name)
}
if (missing.length) {
  console.error(`[build-publish] 产物用到的依赖在根 package.json 找不到: ${missing.join(', ')}`)
  process.exit(1)
}

// 生成 cli-dist/package.json + 拷贝 bundle
mkdirSync(DIST, { recursive: true })
const out = { ...MANIFEST, version: rootPkg.version, dependencies }
writeFileSync(path.join(DIST, 'package.json'), JSON.stringify(out, null, 2) + '\n')
copyFileSync(BUNDLE, path.join(DIST, 'index.mjs'))
copyFileSync(path.join(ROOT, 'LICENSE'), path.join(DIST, 'LICENSE'))
copyFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), path.join(DIST, 'THIRD_PARTY_NOTICES.md'))

console.error(`[build-publish] cli-dist 就绪：${out.name}@${out.version}`)
console.error(`[build-publish] 依赖(${Object.keys(dependencies).length}): ${Object.keys(dependencies).join(', ')}`)
console.error('[build-publish] 发布：cd cli-dist && npm publish')
