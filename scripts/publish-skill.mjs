/** Backward-compatible local build; skill now lives in this repository. */
import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['scripts/build-skill.mjs'], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
console.error('[publish:skill] 已构建本仓库 skills/bcc/bin/bcc.cjs；随源码提交即可，不再推送其他仓库。')
