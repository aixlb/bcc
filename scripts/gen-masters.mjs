/**
 * 把 methods/ 下的「剧本大师」经验文档编译进源码。
 *
 * - 编辑源：methods/<大师>/*.md（公开方法论文档，保留原作者署名）
 * - 产物（均提交入库，改动 methods/ 后运行 `npm run gen:masters` 重新生成）：
 *   - packages/bcc-core/src/shared/masters-meta.ts  大师元数据（id/name/description），渲染进程下拉可安全引用
 *   - packages/bcc-core/src/shared/masters-data.ts  文档内容 gzip+base64 载荷，仅主进程/CLI 解压使用
 * - 发布产物使用 gzip+base64 减小内嵌文档体积；原始 Markdown 随源码公开。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

/** 大师清单（唯一事实源）：新增大师在此登记，文档放 methods/<目录>/ */
const MASTERS = [
  {
    id: 'shanzhiyin',
    name: '山之音',
    description: '导演方法论：叙事目的分析 / 节奏规划 / 镜头设计',
    /** 入驻作者（设置页「编剧大师」展示） */
    author: '@山音',
    github: 'https://github.com/Shanyin-ai/shanyin-screenwriting-master',
    xiaohongshu:
      'https://www.xiaohongshu.com/user/profile/61920f2f000000001000b970',
    /** 悬停推广文案 */
    promo: '联系山音，可以购买专业级的剧本解析方案！',
    dir: 'methods/山之音',
    /** 剧本管线注入的文档 */
    scriptDocs: ['core-methodology.md'],
    /** 分镜表逐镜分析注入的文档 */
    storyboardDocs: ['core-methodology.md', 'shot-design.md'],
  },
]

const banner = (source) => `/**
 * 本文件由 scripts/gen-masters.mjs 生成（源：${source}），不要手改。
 * 改动 methods/ 或大师清单后运行：npm run gen:masters
 */
`

// ---- masters-meta.ts（渲染进程可安全引用，不含文档载荷） ----
const metaTs = `${banner('methods/ 大师清单')}
/** 剧本大师元数据（GUI 下拉 / CLI --master 校验 / 设置页「编剧大师」展示用） */
export interface ScriptMasterMeta {
  id: string
  name: string
  description: string
  /** 入驻作者展示名，如 '@山音' */
  author: string
  /** 作者 GitHub 主页/仓库 */
  github: string
  /** 作者小红书主页 */
  xiaohongshu: string
  /** 悬停推广文案 */
  promo: string
}

/** 内置剧本大师（'' 或 'default' = 默认，不在此列） */
export const BUILTIN_MASTERS: ScriptMasterMeta[] = ${JSON.stringify(
  MASTERS.map(({ id, name, description, author, github, xiaohongshu, promo }) => ({ id, name, description, author, github, xiaohongshu, promo })),
  null,
  2
)}
`

// ---- masters-data.ts（gzip+base64 载荷；同一文档在两条管线复用只嵌一份） ----
const dataEntries = MASTERS.map((m) => {
  const files = [...new Set([...m.scriptDocs, ...m.storyboardDocs])]
  const docs = {}
  for (const f of files) {
    const raw = readFileSync(resolve(m.dir, f))
    docs[f] = gzipSync(raw, { level: 9 }).toString('base64')
  }
  return { id: m.id, name: m.name, docs, scriptDocs: m.scriptDocs, storyboardDocs: m.storyboardDocs }
})

const dataTs = `${banner('methods/ 下各大师目录的 md 文档')}
/** 单个大师的文档载荷：docs 值为 gzip+base64，运行时用 node:zlib 解压 */
export interface ScriptMasterData {
  id: string
  name: string
  /** 文件名 -> gzip+base64 内容 */
  docs: Record<string, string>
  /** 剧本管线注入的文档（docs 键） */
  scriptDocs: string[]
  /** 分镜表逐镜分析注入的文档（docs 键） */
  storyboardDocs: string[]
}

export const MASTERS_DATA: ScriptMasterData[] = ${JSON.stringify(dataEntries, null, 2)}
`

writeFileSync(resolve('packages/bcc-core/src/shared/masters-meta.ts'), metaTs, 'utf-8')
writeFileSync(resolve('packages/bcc-core/src/shared/masters-data.ts'), dataTs, 'utf-8')

for (const m of dataEntries) {
  const kb = Object.values(m.docs).reduce((n, b64) => n + Buffer.from(b64, 'base64').length, 0) / 1024
  console.log(`[gen-masters] ${m.name} (${m.id}): ${Object.keys(m.docs).length} 篇文档，压缩后 ${kb.toFixed(1)} KB`)
}
console.log('[gen-masters] 已生成 packages/bcc-core/src/shared/masters-meta.ts / masters-data.ts')
