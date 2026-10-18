/**
 * 顶层项目持久化 — 一个视频 + 可选剧本 + 可选分镜表
 * 目录: userData/projects/<id>/
 *   project.json    {id, name, videoPath, createdAt, updatedAt}
 *   script.md       可选
 *   storyboard.md   可选
 *   frames/         可选 (分镜表关键帧)
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Project,
  SceneScoreData,
  ScriptVersionMeta,
  ScriptVersionsInfo,
  StoryboardBoundaryOverrides,
  StoryboardProject,
} from '@shared/types'
import { serializeStoryboardMd, loadStoryboardProject } from './storyboard-storage.js'
import { getDataRoot } from './paths.js'
import { importMediaToContainer } from './media-import.js'

interface ProjectMeta {
  id: string
  name: string
  videoPath: string
  createdAt: number
  updatedAt: number
}

function getProjectsDir(): string {
  return path.join(getDataRoot(), 'projects')
}

export function getProjectDir(id: string): string {
  return path.join(getProjectsDir(), id)
}

export function getProjectScriptPath(id: string): string {
  return path.join(getProjectDir(id), 'script.md')
}

export function getProjectStoryboardPath(id: string): string {
  return path.join(getProjectDir(id), 'storyboard.md')
}

export function getProjectFramesDir(id: string): string {
  return path.join(getProjectDir(id), 'frames')
}

export function getProjectSceneScoresPath(id: string): string {
  return path.join(getProjectDir(id), 'scene-scores.json')
}

export function getProjectStoryboardOverridesPath(id: string): string {
  return path.join(getProjectDir(id), 'storyboard-boundary-overrides.json')
}

function getMetaPath(id: string): string {
  return path.join(getProjectDir(id), 'project.json')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readMeta(id: string): Promise<ProjectMeta | null> {
  try {
    const raw = await fs.readFile(getMetaPath(id), 'utf-8')
    return JSON.parse(raw) as ProjectMeta
  } catch {
    return null
  }
}

async function writeMeta(meta: ProjectMeta): Promise<void> {
  await fs.mkdir(getProjectDir(meta.id), { recursive: true })
  // 原子写：先写 .tmp 再 rename，避免崩溃/断电留下半截 project.json（readMeta 会把它当损坏
  // 返回 null，整个项目就从列表里消失了，即便 script.md / storyboard.md 仍在）。
  const target = getMetaPath(meta.id)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf-8')
  await fs.rename(tmp, target)
}

/**
 * 按项目串行化 project.json 的「读-改-写」。
 * 分镜异步识别会高频 touchProject（写 updatedAt），与用户重命名并发时，
 * 两段 read-modify-write 交错会丢更新（如重命名被旧快照覆盖回去）。
 */
const metaLocks = new Map<string, Promise<unknown>>()
function withMetaLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = metaLocks.get(id) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  metaLocks.set(
    id,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}

async function toProject(meta: ProjectMeta): Promise<Project> {
  const [hasScript, hasStoryboard] = await Promise.all([
    exists(getProjectScriptPath(meta.id)),
    exists(getProjectStoryboardPath(meta.id)),
  ])
  return {
    id: meta.id,
    name: meta.name,
    videoPath: meta.videoPath,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    hasScript,
    hasStoryboard,
  }
}

export async function listProjects(): Promise<Project[]> {
  const root = getProjectsDir()
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const projects: Project[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const meta = await readMeta(entry.name)
      if (!meta) continue
      projects.push(await toProject(meta))
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  const meta = await readMeta(id)
  if (!meta) return null
  return await toProject(meta)
}

export async function createProject(args: { name: string; videoPath: string }): Promise<Project> {
  const now = Date.now()
  const id = randomUUID()
  // 沙盒下把源视频拷贝进项目容器目录，后续 ffmpeg/预览/重读都走容器副本
  const videoPath = await importMediaToContainer(args.videoPath, getProjectDir(id))
  const meta: ProjectMeta = {
    id,
    name: args.name.trim() || '未命名项目',
    videoPath,
    createdAt: now,
    updatedAt: now,
  }
  await writeMeta(meta)
  return await toProject(meta)
}

export async function renameProject(id: string, name: string): Promise<Project> {
  return withMetaLock(id, async () => {
    const meta = await readMeta(id)
    if (!meta) throw new Error(`项目不存在: ${id}`)
    meta.name = name.trim() || meta.name
    meta.updatedAt = Date.now()
    await writeMeta(meta)
    return await toProject(meta)
  })
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(getProjectDir(id), { recursive: true, force: true })
}

export async function touchProject(id: string): Promise<void> {
  await withMetaLock(id, async () => {
    const meta = await readMeta(id)
    if (!meta) return
    meta.updatedAt = Date.now()
    await writeMeta(meta)
  })
}

export async function writeScriptMd(id: string, content: string): Promise<string> {
  const target = getProjectScriptPath(id)
  await fs.mkdir(getProjectDir(id), { recursive: true })
  await fs.writeFile(target, content, 'utf-8')
  await touchProject(id)
  return target
}

export async function readScriptMd(id: string): Promise<string | null> {
  try {
    return await fs.readFile(getProjectScriptPath(id), 'utf-8')
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// 剧本多版本
// 目录: <project>/scripts/<versionId>.md + versions.json（activeId 指针）
// script.md 始终是激活版本的镜像 —— 导出/CLI/hasScript 判定等旧路径零改动。
// ------------------------------------------------------------------

export function getProjectScriptVersionsDir(id: string): string {
  return path.join(getProjectDir(id), 'scripts')
}

function getVersionsJsonPath(id: string): string {
  return path.join(getProjectScriptVersionsDir(id), 'versions.json')
}

function getVersionFilePath(id: string, versionId: string): string {
  return path.join(getProjectScriptVersionsDir(id), `${versionId}.md`)
}

/** 按项目串行化版本清单的读-改-写（生成完成落版本 与 用户切换/删除 可能并发） */
const versionLocks = new Map<string, Promise<unknown>>()
function withVersionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = versionLocks.get(id) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  versionLocks.set(
    id,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}

async function readVersionsInfo(id: string): Promise<ScriptVersionsInfo | null> {
  try {
    const raw = await fs.readFile(getVersionsJsonPath(id), 'utf-8')
    const parsed = JSON.parse(raw) as ScriptVersionsInfo
    if (!parsed || !Array.isArray(parsed.versions)) return null
    return parsed
  } catch {
    return null
  }
}

async function writeVersionsInfo(id: string, info: ScriptVersionsInfo): Promise<void> {
  await fs.mkdir(getProjectScriptVersionsDir(id), { recursive: true })
  const target = getVersionsJsonPath(id)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(info, null, 2), 'utf-8')
  await fs.rename(tmp, target)
}

/** 懒迁移：script.md 已存在但还没有版本清单时，把现有内容登记为首个版本 */
async function migrateIfNeeded(id: string): Promise<ScriptVersionsInfo | null> {
  const existing = await readVersionsInfo(id)
  if (existing) return existing
  const content = await readScriptMd(id)
  if (content === null) return null
  let createdAt = Date.now()
  try {
    createdAt = (await fs.stat(getProjectScriptPath(id))).mtimeMs
  } catch {
    /* ignore */
  }
  const versionId = `v${Math.round(createdAt)}`
  await fs.mkdir(getProjectScriptVersionsDir(id), { recursive: true })
  await fs.writeFile(getVersionFilePath(id, versionId), content, 'utf-8')
  const info: ScriptVersionsInfo = {
    activeId: versionId,
    versions: [{ id: versionId, createdAt: Math.round(createdAt), providerLabel: '已有剧本' }],
  }
  await writeVersionsInfo(id, info)
  return info
}

/** 版本清单；无剧本时返回 null（旧项目首次调用时自动迁移出 v1） */
export async function listScriptVersions(id: string): Promise<ScriptVersionsInfo | null> {
  return withVersionLock(id, () => migrateIfNeeded(id))
}

/** 新增一个剧本版本并激活（重新生成完成时调用）；script.md 同步为其镜像 */
export async function saveScriptVersion(
  id: string,
  content: string,
  providerLabel: string
): Promise<ScriptVersionMeta> {
  return withVersionLock(id, async () => {
    const info = (await migrateIfNeeded(id)) ?? { activeId: '', versions: [] }
    const now = Date.now()
    let versionId = `v${now}`
    // 时间戳撞车兜底（同秒内连续生成）
    while (info.versions.some((v) => v.id === versionId)) versionId += 'x'
    await fs.mkdir(getProjectScriptVersionsDir(id), { recursive: true })
    await fs.writeFile(getVersionFilePath(id, versionId), content, 'utf-8')
    const meta: ScriptVersionMeta = { id: versionId, createdAt: now, providerLabel }
    info.versions.push(meta)
    info.activeId = versionId
    await writeVersionsInfo(id, info)
    await writeScriptMd(id, content)
    return meta
  })
}

/** 切换激活版本：script.md 换成该版本内容 */
export async function switchScriptVersion(id: string, versionId: string): Promise<void> {
  return withVersionLock(id, async () => {
    const info = await migrateIfNeeded(id)
    if (!info) throw new Error('该项目还没有剧本')
    const target = info.versions.find((v) => v.id === versionId)
    if (!target) throw new Error(`版本不存在: ${versionId}`)
    const content = await fs.readFile(getVersionFilePath(id, versionId), 'utf-8')
    info.activeId = versionId
    await writeVersionsInfo(id, info)
    await writeScriptMd(id, content)
  })
}

/** 删除一个版本；删的是激活版本时切到最新的剩余版本，删光则移除 script.md */
export async function deleteScriptVersion(id: string, versionId: string): Promise<ScriptVersionsInfo | null> {
  return withVersionLock(id, async () => {
    const info = await migrateIfNeeded(id)
    if (!info) return null
    const idx = info.versions.findIndex((v) => v.id === versionId)
    if (idx < 0) return info
    info.versions.splice(idx, 1)
    await fs.unlink(getVersionFilePath(id, versionId)).catch(() => {})

    if (info.versions.length === 0) {
      await fs.unlink(getVersionsJsonPath(id)).catch(() => {})
      await fs.unlink(getProjectScriptPath(id)).catch(() => {})
      await touchProject(id)
      return null
    }
    if (info.activeId === versionId) {
      const latest = [...info.versions].sort((a, b) => b.createdAt - a.createdAt)[0]
      info.activeId = latest.id
      const content = await fs.readFile(getVersionFilePath(id, latest.id), 'utf-8')
      await writeVersionsInfo(id, info)
      await writeScriptMd(id, content)
    } else {
      await writeVersionsInfo(id, info)
      await touchProject(id)
    }
    return info
  })
}

/** 编辑剧本内容（场景增删改）：写 script.md 镜像并同步激活版本文件 */
export async function updateActiveScriptContent(id: string, content: string): Promise<void> {
  return withVersionLock(id, async () => {
    const info = await migrateIfNeeded(id)
    await writeScriptMd(id, content)
    if (info?.activeId) {
      await fs.writeFile(getVersionFilePath(id, info.activeId), content, 'utf-8').catch(() => {})
    }
  })
}

/** 把 StoryboardProject 写到当前项目的 storyboard.md（截图已通过 getProjectFramesDir 写在同目录） */
export async function writeStoryboardMd(id: string, sbProject: StoryboardProject): Promise<void> {
  await fs.mkdir(getProjectDir(id), { recursive: true })
  const md = serializeStoryboardMd(sbProject)
  await fs.writeFile(getProjectStoryboardPath(id), md, 'utf-8')
  await touchProject(id)
}

/** 读取项目的 storyboard.md，复用 storyboard-storage 的解析器 */
export async function readStoryboard(id: string): Promise<StoryboardProject | null> {
  const dir = getProjectDir(id)
  if (!(await exists(getProjectStoryboardPath(id)))) return null
  return await loadStoryboardProject(dir)
}

// ------------------------------------------------------------------
// 分镜人工切点覆盖层
// ------------------------------------------------------------------

const boundaryOverrideLocks = new Map<string, Promise<unknown>>()

function emptyStoryboardBoundaryOverrides(): StoryboardBoundaryOverrides {
  return { version: 1, forced: [], suppressed: [], updatedAt: 0 }
}

function sanitizeBoundaryMilliseconds(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return [...new Set(
    values
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0)
      .map((v) => Math.floor(v))
  )].sort((a, b) => a - b)
}

function sanitizeStoryboardBoundaryOverrides(value: unknown): StoryboardBoundaryOverrides {
  if (!value || typeof value !== 'object') return emptyStoryboardBoundaryOverrides()
  const raw = value as Partial<StoryboardBoundaryOverrides>
  return {
    version: 1,
    forced: sanitizeBoundaryMilliseconds(raw.forced),
    suppressed: sanitizeBoundaryMilliseconds(raw.suppressed),
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
  }
}

/** 读取人工切点覆盖；旧项目/无覆盖时返回空集合。 */
export async function readStoryboardBoundaryOverrides(id: string): Promise<StoryboardBoundaryOverrides> {
  try {
    const raw = await fs.readFile(getProjectStoryboardOverridesPath(id), 'utf-8')
    return sanitizeStoryboardBoundaryOverrides(JSON.parse(raw))
  } catch (err: any) {
    if (err?.code === 'ENOENT') return emptyStoryboardBoundaryOverrides()
    throw err
  }
}

async function writeStoryboardBoundaryOverridesUnlocked(
  id: string,
  value: StoryboardBoundaryOverrides
): Promise<StoryboardBoundaryOverrides> {
  const next = sanitizeStoryboardBoundaryOverrides({
    ...value,
    version: 1,
    updatedAt: Date.now(),
  })
  await fs.mkdir(getProjectDir(id), { recursive: true })
  const target = getProjectStoryboardOverridesPath(id)
  const tmp = `${target}.${randomUUID()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
  try {
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
  return next
}

/**
 * 按项目串行读改写人工切点覆盖，并通过临时文件 + rename 原子提交 sidecar。
 */
export function updateStoryboardBoundaryOverrides(
  id: string,
  mutate: (current: StoryboardBoundaryOverrides) => StoryboardBoundaryOverrides
): Promise<StoryboardBoundaryOverrides> {
  const prev = boundaryOverrideLocks.get(id) ?? Promise.resolve()
  const run = prev.then(
    async () => writeStoryboardBoundaryOverridesUnlocked(id, mutate(await readStoryboardBoundaryOverrides(id))),
    async () => writeStoryboardBoundaryOverridesUnlocked(id, mutate(await readStoryboardBoundaryOverrides(id)))
  )
  boundaryOverrideLocks.set(id, run.then(() => undefined, () => undefined))
  return run
}

/** 写入每帧场景差异曲线数据（生成分镜时产出） */
export async function writeSceneScores(id: string, data: SceneScoreData): Promise<void> {
  await fs.mkdir(getProjectDir(id), { recursive: true })
  await fs.writeFile(getProjectSceneScoresPath(id), JSON.stringify(data), 'utf-8')
}

/** 读取每帧场景差异曲线数据；不存在时返回 null */
export async function readSceneScores(id: string): Promise<SceneScoreData | null> {
  try {
    const raw = await fs.readFile(getProjectSceneScoresPath(id), 'utf-8')
    const parsed = JSON.parse(raw) as SceneScoreData
    if (!parsed || !Array.isArray(parsed.points)) return null
    return parsed
  } catch {
    return null
  }
}
