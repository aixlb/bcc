/**
 * 风格研究项目持久化
 * 目录: userData/research/<id>/
 *   project.json
 *   style-guide.md
 *   videos/
 *     1_<basename>/storyboard.md
 *     1_<basename>/frames/frame_*.jpg
 *     1_<basename>/thumbnail.jpg
 *     1_<basename>/sub.json
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ResearchMeta, ResearchSubVideo, StoryboardProject } from '@shared/types'
import { serializeStoryboardMd } from './storyboard-storage.js'
import { getDataRoot } from './paths.js'
import { importMediaToContainer } from './media-import.js'

function getResearchRootDir(): string {
  return path.join(getDataRoot(), 'research')
}

/**
 * 0.2.0 迁移：风格研究数据目录从 distillations/ 改名为 research/。
 * 仅当老目录存在、且新目录尚不存在时整体改名；两者都在则保守保留老目录、不覆盖。
 * 启动时调用一次，失败只记日志不阻塞（数据兼容是尽力而为，不能拖垮启动）。
 */
export async function migrateLegacyResearchDir(): Promise<void> {
  const legacy = path.join(getDataRoot(), 'distillations')
  const next = getResearchRootDir()
  try {
    await fs.access(legacy)
  } catch {
    return // 没有老目录，无需迁移
  }
  try {
    await fs.access(next)
    console.warn('[research] 迁移跳过：research/ 与旧 distillations/ 并存，保留旧目录不覆盖')
    return
  } catch {
    // next 不存在 → 可以安全改名
  }
  try {
    await fs.rename(legacy, next)
    console.log('[research] 已将 distillations/ 迁移为 research/')
  } catch (e) {
    console.error('[research] 目录迁移失败（不影响启动）:', e)
  }
}

export function getResearchDir(id: string): string {
  return path.join(getResearchRootDir(), id)
}

export function getResearchVideosDir(id: string): string {
  return path.join(getResearchDir(id), 'videos')
}

function getMetaPath(id: string): string {
  return path.join(getResearchDir(id), 'project.json')
}

export function getStyleGuidePath(id: string): string {
  return path.join(getResearchDir(id), 'style-guide.md')
}

function safeBaseName(videoPath: string): string {
  const base = path.basename(videoPath, path.extname(videoPath))
  return base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'video'
}

export function getSubDir(id: string, subIndex: number, videoPath: string): string {
  return path.join(getResearchVideosDir(id), `${subIndex}_${safeBaseName(videoPath)}`)
}

export function getSubFramesDir(id: string, subIndex: number, videoPath: string): string {
  return path.join(getSubDir(id, subIndex, videoPath), 'frames')
}

export function getSubStoryboardPath(id: string, subIndex: number, videoPath: string): string {
  return path.join(getSubDir(id, subIndex, videoPath), 'storyboard.md')
}

export function getSubThumbnailPath(id: string, subIndex: number, videoPath: string): string {
  return path.join(getSubDir(id, subIndex, videoPath), 'thumbnail.jpg')
}

function getSubMetaPath(id: string, subIndex: number, videoPath: string): string {
  return path.join(getSubDir(id, subIndex, videoPath), 'sub.json')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readMeta(id: string): Promise<ResearchMeta | null> {
  try {
    const raw = await fs.readFile(getMetaPath(id), 'utf-8')
    return JSON.parse(raw) as ResearchMeta
  } catch {
    return null
  }
}

async function writeMeta(meta: ResearchMeta): Promise<void> {
  await fs.mkdir(getResearchDir(meta.id), { recursive: true })
  await fs.writeFile(getMetaPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8')
}

export async function listResearch(): Promise<ResearchMeta[]> {
  const root = getResearchRootDir()
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const out: ResearchMeta[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const meta = await readMeta(entry.name)
      if (meta) out.push(meta)
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function loadResearch(
  id: string
): Promise<{ meta: ResearchMeta; subVideos: ResearchSubVideo[] } | null> {
  const meta = await readMeta(id)
  if (!meta) return null

  const subVideos: ResearchSubVideo[] = []
  for (let i = 0; i < meta.videoPaths.length; i++) {
    const videoPath = meta.videoPaths[i]
    const subMetaPath = getSubMetaPath(id, i + 1, videoPath)
    let sub: ResearchSubVideo
    if (await exists(subMetaPath)) {
      try {
        sub = JSON.parse(await fs.readFile(subMetaPath, 'utf-8')) as ResearchSubVideo
        // 进行中状态（detecting/analyzing）是上次运行被关闭/崩溃时持久化的，重启后已无对应作业。
        // 若不复位，UI 会一直转圈。复位为 pending（重新研究会从头覆盖 sub.json）。
        if (sub.status === 'detecting' || sub.status === 'analyzing') {
          sub = { ...sub, status: 'pending', progress: 0, message: '等待研究' }
        }
      } catch {
        sub = makePendingSub(videoPath)
      }
    } else {
      sub = makePendingSub(videoPath)
    }
    subVideos.push(sub)
  }

  return { meta, subVideos }
}

function makePendingSub(videoPath: string): ResearchSubVideo {
  return {
    videoPath,
    videoName: path.basename(videoPath),
    status: 'pending',
    progress: 0,
    message: '',
    shots: 0,
  }
}

export async function createResearch(args: {
  name: string
  videoPaths: string[]
}): Promise<ResearchMeta> {
  const now = Date.now()
  const id = randomUUID()
  // 沙盒下把源视频拷贝进容器 videos/ 目录，后续 ffmpeg/重读都走容器副本
  const videosDir = getResearchVideosDir(id)
  await fs.mkdir(videosDir, { recursive: true })
  const videoPaths = await Promise.all(
    args.videoPaths.map((vp) => importMediaToContainer(vp, videosDir))
  )
  const meta: ResearchMeta = {
    id,
    name: args.name.trim() || '未命名研究',
    videoPaths,
    createdAt: now,
    updatedAt: now,
    hasStyleGuide: false,
  }
  await writeMeta(meta)
  return meta
}

export async function renameResearch(id: string, name: string): Promise<ResearchMeta> {
  const meta = await readMeta(id)
  if (!meta) throw new Error(`研究项目不存在: ${id}`)
  meta.name = name.trim() || meta.name
  meta.updatedAt = Date.now()
  await writeMeta(meta)
  return meta
}

/**
 * 往已存在的研究项目追加源视频。
 * 去重后追加；旧的风格指南作废（hasStyleGuide=false）。
 * 返回最新的 meta + 新增的 sub video 列表。
 */
export async function addVideosToResearch(
  id: string,
  newPaths: string[]
): Promise<{ meta: ResearchMeta; newSubVideos: ResearchSubVideo[] }> {
  const meta = await readMeta(id)
  if (!meta) throw new Error(`研究项目不存在: ${id}`)
  // 沙盒下先把新视频拷进容器，再按容器路径去重（重复导入会落到同一容器路径）
  const imported = await Promise.all(
    newPaths.map((p) => importMediaToContainer(p, getResearchVideosDir(id)))
  )
  const existing = new Set(meta.videoPaths)
  const toAdd = imported.filter((p) => !existing.has(p))
  if (toAdd.length === 0) {
    return { meta, newSubVideos: [] }
  }
  meta.videoPaths = [...meta.videoPaths, ...toAdd]
  // 新增视频没参与分析 → 旧风格指南作废
  if (meta.hasStyleGuide) meta.hasStyleGuide = false
  meta.updatedAt = Date.now()
  await writeMeta(meta)
  const newSubVideos: ResearchSubVideo[] = toAdd.map((vp) => ({
    videoPath: vp,
    videoName: path.basename(vp),
    status: 'pending' as const,
    progress: 0,
    message: '等待研究',
    shots: 0,
  }))
  return { meta, newSubVideos }
}

export async function deleteResearch(id: string): Promise<void> {
  await fs.rm(getResearchDir(id), { recursive: true, force: true })
}

export async function touchResearch(id: string): Promise<void> {
  const meta = await readMeta(id)
  if (!meta) return
  meta.updatedAt = Date.now()
  await writeMeta(meta)
}

export async function markHasStyleGuide(id: string): Promise<ResearchMeta> {
  const meta = await readMeta(id)
  if (!meta) throw new Error(`研究项目不存在: ${id}`)
  meta.hasStyleGuide = true
  meta.updatedAt = Date.now()
  await writeMeta(meta)
  return meta
}

/** 写入子视频的 storyboard.md + sub.json（sub.json 是 sub status 的真实来源） */
export async function writeSubVideoStoryboard(
  id: string,
  subIndex: number,
  videoPath: string,
  sb: StoryboardProject
): Promise<{ storyboardPath: string; framePaths: string[] }> {
  const subDir = getSubDir(id, subIndex, videoPath)
  await fs.mkdir(subDir, { recursive: true })
  const storyboardPath = getSubStoryboardPath(id, subIndex, videoPath)
  const md = serializeStoryboardMd(sb)
  await fs.writeFile(storyboardPath, md, 'utf-8')
  return { storyboardPath, framePaths: sb.framePaths }
}

/** 更新子视频的 sub.json（在每个 phase 转换点调用） */
export async function writeSubMeta(
  id: string,
  subIndex: number,
  videoPath: string,
  sub: ResearchSubVideo
): Promise<void> {
  const subDir = getSubDir(id, subIndex, videoPath)
  await fs.mkdir(subDir, { recursive: true })
  await fs.writeFile(getSubMetaPath(id, subIndex, videoPath), JSON.stringify(sub, null, 2), 'utf-8')
}

export async function readStyleGuide(id: string): Promise<string | null> {
  const p = getStyleGuidePath(id)
  try {
    return await fs.readFile(p, 'utf-8')
  } catch {
    return null
  }
}

/** Atomic write — 先写临时文件再 rename，避免半截内容 */
export async function writeStyleGuide(id: string, content: string): Promise<string> {
  const target = getStyleGuidePath(id)
  await fs.mkdir(getResearchDir(id), { recursive: true })
  const tmp = target + '.tmp'
  await fs.writeFile(tmp, content, 'utf-8')
  await fs.rename(tmp, target)
  await touchResearch(id)
  return target
}
