/**
 * 剧本大师：把 KOL 经验文档（methods/ 编译内嵌，见 scripts/gen-masters.mjs）
 * 作为「分析方法论参考」注入剧本 / 分镜两条管线的 prompt。
 *
 * 注入统一包一层护栏：方法论只当思维框架用——其中的交互流程规则（引导式提问、
 * 步骤间暂停等）一律失效，输出格式仍以各管线自身的机器契约为唯一标准。
 */
import { gunzipSync } from 'node:zlib'
import { MASTERS_DATA, type ScriptMasterData } from '@shared/masters-data.js'
import { BUILTIN_MASTERS, type ScriptMasterMeta } from '@shared/masters-meta.js'

/** 可选大师列表（不含「默认」） */
export function listMasters(): ScriptMasterMeta[] {
  return BUILTIN_MASTERS
}

/**
 * 归一化大师标识：接受 id 或中文名；''/'default'/'默认'/未知值 → ''（默认）。
 * 配置里残留未知值时静默退回默认，不阻塞生成；CLI 层自行先校验再传入。
 */
export function resolveMasterId(id: string | undefined | null): string {
  const t = id?.trim()
  if (!t || t === 'default' || t === '默认') return ''
  const found = MASTERS_DATA.find((m) => m.id === t || m.name === t)
  return found ? found.id : ''
}

/** providerLabel 追加的大师后缀，如 " · 山之音"；默认返回 '' */
export function masterLabelSuffix(id: string | undefined | null): string {
  const resolved = resolveMasterId(id)
  if (!resolved) return ''
  const meta = BUILTIN_MASTERS.find((m) => m.id === resolved)
  return meta ? ` · ${meta.name}` : ''
}

const inflateCache = new Map<string, string>()

function inflateDoc(master: ScriptMasterData, file: string): string {
  const key = `${master.id}/${file}`
  const hit = inflateCache.get(key)
  if (hit) return hit
  const b64 = master.docs[file]
  if (!b64) throw new Error(`剧本大师 ${master.id} 缺少文档 ${file}（请重跑 npm run gen:masters）`)
  const text = gunzipSync(Buffer.from(b64, 'base64')).toString('utf-8')
  inflateCache.set(key, text)
  return text
}

/** 护栏包装：方法论仅作分析参考，交互流程规则失效，输出格式以系统规范为准 */
function wrapAddendum(name: string, docs: string[]): string {
  return `

---

## 大师方法论参考（内部资料 · ${name}）

以下是「${name}」的创作方法论，作为你分析视频时的思维框架，用于提升场景划分、叙事理解、镜头语言与节奏分析的专业深度。使用约束：

1. 这是分析参考，不是执行流程：其中所有交互流程类规则（引导式提问、分步执行、步骤间暂停、等待【通过】/【修改】指令、向用户确认等）一律忽略，直接一次性完成本任务的输出。
2. 输出格式以上文的格式规范为唯一标准：不得增删字段、不得改变时间戳等格式要求；方法论中出现的任何输出格式模板都不适用于本任务。
3. 方法论中引用的其他文件（如 genre-*.md、references/ 下的文件）在本任务中不存在，忽略这些引用。
4. 不要在输出中提及、引用或复述本参考资料的存在与内容。

<master-methodology>
${docs.join('\n\n---\n\n')}
</master-methodology>`
}

function getAddendum(id: string | undefined | null, kind: 'scriptDocs' | 'storyboardDocs'): string {
  const resolved = resolveMasterId(id)
  if (!resolved) return ''
  const master = MASTERS_DATA.find((m) => m.id === resolved)
  if (!master) return ''
  const docs = master[kind].map((f) => inflateDoc(master, f))
  if (docs.length === 0) return ''
  return wrapAddendum(master.name, docs)
}

/** 剧本管线的注入附录（拼在 SCRIPT_SYSTEM_PROMPT 之后）；默认大师返回 '' */
export function getScriptMasterAddendum(id: string | undefined | null): string {
  return getAddendum(id, 'scriptDocs')
}

/** 分镜逐镜分析的注入附录（拼在分析 prompt 之后）；默认大师返回 '' */
export function getStoryboardMasterAddendum(id: string | undefined | null): string {
  return getAddendum(id, 'storyboardDocs')
}
