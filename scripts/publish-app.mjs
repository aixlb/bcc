/** Publish desktop artifacts from this repository; --dry-run only lists files. */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const repo = 'aixlb/bcc'
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const tag = `v${version}`
const releaseDir = path.resolve('release')
if (!existsSync(releaseDir)) throw new Error('release/ 不存在，先构建桌面安装包')
const files = readdirSync(releaseDir).filter((file) =>
  file.includes(version) && /\.(exe|dmg|zip)$/i.test(file) && !/setup/i.test(file)
).map((file) => path.join(releaseDir, file))
if (!files.length) throw new Error(`release/ 中没有 ${version} 的免安装包`)
console.error(`[publish:app] ${tag} → ${repo}\n${files.join('\n')}`)
if (process.argv.includes('--dry-run')) process.exit(0)

function gh(args, options = {}) {
  const result = spawnSync('gh', args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} 失败 (${result.status})`)
  return result
}
// Fail on missing CLI/auth before attempting a release mutation.
gh(['auth', 'status'])
const view = spawnSync('gh', ['release', 'view', tag, '--repo', repo], { encoding: 'utf8' })
if (view.error) throw view.error
if (view.status !== 0) {
  if (!/not found|HTTP 404/i.test(view.stderr ?? '')) throw new Error(view.stderr || '无法读取 Release')
  gh(['release', 'create', tag, '--repo', repo, '--title', tag, '--notes', '桌面安装包'])
}
gh(['release', 'upload', tag, '--repo', repo, ...files, '--clobber'])
console.error(`[publish:app] 完成：https://github.com/${repo}/releases/tag/${tag}`)
