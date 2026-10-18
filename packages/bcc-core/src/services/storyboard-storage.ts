/**
 * 分镜表项目持久化 — md + 图片文件夹格式
 * 目录: userData/storyboards/<id>/storyboard.md + frames/
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { StoryboardProject, StoryboardShot } from '@shared/types'
import {
  formatStoryboardDescription,
  isStructuredStoryboardDescription,
  normalizeStoryboardShotType,
  parseStoryboardDescriptionParts,
} from '@shared/defaults.js'
import { getDataRoot } from './paths.js'

function getProjectsDir(): string {
  return path.join(getDataRoot(), 'storyboards')
}

function getProjectDir(id: string): string {
  return path.join(getProjectsDir(), id)
}

function getFramesDir(id: string): string {
  return path.join(getProjectDir(id), 'frames')
}

/** 保存分镜表项目 */
export async function saveStoryboardProject(project: StoryboardProject): Promise<void> {
  const dir = getProjectDir(project.id)
  const framesDir = getFramesDir(project.id)
  await fs.mkdir(framesDir, { recursive: true })

  // 写入 md
  const md = buildMarkdown(project)
  await fs.writeFile(path.join(dir, 'storyboard.md'), md, 'utf-8')

  // framePaths 指向持久化目录，不需要再复制
  // 但确保 frames/ 目录中的文件存在
}

/** 加载分镜表项目（接受完整目录路径） */
export async function loadStoryboardProject(projectDir: string): Promise<StoryboardProject | null> {
  const mdPath = path.join(projectDir, 'storyboard.md')
  try {
    const md = await fs.readFile(mdPath, 'utf-8')
    return parseMarkdown(md, projectDir)
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/** 列出所有项目 */
export async function listStoryboardProjects(): Promise<Array<{ id: string; videoName: string; createdAt: number }>> {
  const projectsDir = getProjectsDir()
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true })
    const projects: Array<{ id: string; videoName: string; createdAt: number }> = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const md = await fs.readFile(path.join(projectsDir, entry.name, 'storyboard.md'), 'utf-8')
        const meta = parseMeta(md)
        projects.push({ id: entry.name, videoName: meta.videoName || entry.name, createdAt: meta.createdAt || 0 })
      } catch { /* ignore */ }
    }
    return projects.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

/** 删除项目 */
export async function deleteStoryboardProject(id: string): Promise<void> {
  const dir = getProjectDir(id)
  await fs.rm(dir, { recursive: true, force: true })
}

/** 获取项目目录路径 */
export function getStoryboardProjectDir(id: string): string {
  return getProjectDir(id)
}

/** 获取截图目录路径 */
export function getStoryboardFramesDir(id: string): string {
  return getFramesDir(id)
}

// ------------------------------------------------------------------
// Markdown 生成
// ------------------------------------------------------------------

export function serializeStoryboardMd(project: StoryboardProject): string {
  return buildMarkdown(project)
}

function buildMarkdown(project: StoryboardProject): string {
  const date = new Date(project.createdAt).toLocaleString('zh-CN')
  const videoName = project.videoPath ? path.basename(project.videoPath) : '未知'

  let md = `# 分镜表\n\n`
  md += `> 源视频: \`${videoName}\`\n`
  md += `> 生成时间: ${date}\n`
  md += `> 总镜头数: ${project.shots.length}\n\n`
  md += `---\n\n`

  for (const shot of project.shots) {
    md += `## 镜 ${shot.number} | ${shot.timeRange}\n\n`
    md += `**景别**: ${shot.shotType} | **角度**: ${shot.angle} | **运镜**: ${shot.cameraMove}\n\n`
    if (shot.userEdited === true) {
      md += `<!-- userEdited: true -->\n\n`
    }

    if (shot.startSec !== undefined) {
      md += `**开始时间**: ${formatHMS(shot.startSec)}\n\n`
      // 机器可读的精确起止秒（含小数），避免 HH:MM:SS 取整丢精度（手动加分镜被「附近已有」误判、末镜负时长等）
      md += `**起始秒**: ${formatPreciseSeconds(shot.startSec)}\n\n`
      if (typeof shot.endSec === 'number') {
        md += `**结束秒**: ${formatPreciseSeconds(shot.endSec)}\n\n`
      }
    }

    if (shot.sceneScore > 0) {
      md += `**场景差异**: ${shot.sceneScore.toFixed(4)}\n\n`
    }

    // 图片引用（相对路径）
    const frameFile = path.basename(project.framePaths[shot.number - 1] || '')
    if (frameFile) {
      md += `![关键帧](frames/${frameFile})\n\n`
    }

    if (shot.description) {
      if (isStructuredStoryboardDescription(shot.description)) {
        const canonical = formatStoryboardDescription(
          parseStoryboardDescriptionParts(shot.description) ?? {},
          shot.shotType
        )
        md += `**提示词描述**:\n\n\`\`\`text\n${canonical}\n\`\`\`\n\n`
      } else {
        // 旧项目的自然语言描述、等待态和失败态保持旧标签，不伪装成七段提示词。
        md += shot.description.includes('\n')
          ? `**描述**:\n\n\`\`\`text\n${shot.description}\n\`\`\`\n\n`
          : `**描述**: ${shot.description}\n\n`
      }
    }
    if (shot.dialogue) {
      md += `**台词**: ${shot.dialogue}\n\n`
    }
    if (shot.sound) {
      md += `**音效**: ${shot.sound}\n\n`
    }
    md += `---\n\n`
  }

  return md.trim() + '\n'
}

// ------------------------------------------------------------------
// Markdown 解析
// ------------------------------------------------------------------

function parseMarkdown(md: string, projectDir: string): StoryboardProject {
  const meta = parseMeta(md)
  const shots: StoryboardShot[] = []
  const framePaths: string[] = []

  // 按 ## 镜 N 分割
  const sections = md.split(/\n## 镜\s+/).slice(1)

  for (const section of sections) {
    const lines = section.split('\n').map((l) => l.trim())
    const headingLine = lines[0] || ''

    // 解析 "镜 1 | 00:00:00 - 00:00:02"
    const headingMatch = headingLine.match(/^(\d+)\s*\|\s*(.+)/)
    const number = headingMatch ? parseInt(headingMatch[1]) : shots.length + 1
    const timeRange = headingMatch ? headingMatch[2].trim() : ''

    // 解析景别/角度/运镜
    const infoLine = lines.find((l) => l.startsWith('**景别**'))
    let shotType = '近景'
    let angle = '平视角'
    let cameraMove = '静态镜头'
    if (infoLine) {
      const m = infoLine.match(/\*\*景别\*\*:\s*([^|]+)\|\s*\*\*角度\*\*:\s*([^|]+)\|\s*\*\*运镜\*\*:\s*(.+)/)
      if (m) {
        shotType = normalizeStoryboardShotType(m[1].trim())
        angle = m[2].trim()
        cameraMove = m[3].trim()
      }
    }

    // 解析开始时间
    const timeLine = lines.find((l) => l.startsWith('**开始时间**'))
    let startSec = 0
    if (timeLine) {
      const m = timeLine.match(/(\d{2}):(\d{2}):(\d{2})/)
      if (m) {
        startSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
      }
    }
    // 精确起始秒（新版写入，优先用）；旧文件没有则沿用上面按 HH:MM:SS 解析的整数秒
    const secLine = lines.find((l) => l.startsWith('**起始秒**'))
    if (secLine) {
      const v = parseFloat(secLine.replace(/\*\*起始秒\*\*:\s*/, '').trim())
      if (!isNaN(v)) startSec = v
    }

    // 解析图片路径
    const imgLine = lines.find((l) => l.startsWith('!['))
    let framePath = ''
    if (imgLine) {
      const m = imgLine.match(/!\[.*?\]\((.+?)\)/)
      if (m) {
        framePath = path.resolve(projectDir, m[1].trim())
        // fallback：如果解析出的路径不存在，尝试在当前项目 frames/ 目录下查找同名文件
        if (!existsSync(framePath)) {
          const framesDir = path.join(projectDir, 'frames')
          const baseName = path.basename(framePath)
          const altPath = path.join(framesDir, baseName)
          if (existsSync(altPath)) {
            framePath = altPath
          }
        }
      }
    }

    // 解析七段式提示词描述；新版使用 fenced text 块，兼容早期可能出现的同行写法。
    const promptBlock = section.match(
      /\*\*提示词描述\*\*:\s*(?:\r?\n\s*)+```(?:text)?\s*\r?\n([\s\S]*?)\r?\n```/
    )
    const legacyDescBlock = section.match(
      /\*\*描述\*\*:\s*(?:\r?\n\s*)+```(?:text)?\s*\r?\n([\s\S]*?)\r?\n```/
    )
    const promptLine = lines.find((l) => l.startsWith('**提示词描述**'))
    const legacyDescLine = lines.find((l) => l.startsWith('**描述**'))
    const dialogueLine = lines.find((l) => l.startsWith('**台词**'))
    const soundLine = lines.find((l) => l.startsWith('**音效**'))

    const rawDescription = promptBlock
      ? promptBlock[1].trim()
      : promptLine
        ? promptLine.replace(/\*\*提示词描述\*\*:\s*/, '').trim()
        : legacyDescBlock
          ? legacyDescBlock[1].trim()
          : legacyDescLine
          ? legacyDescLine.replace(/\*\*描述\*\*:\s*/, '').trim()
          : ''
    // 旧 `**描述**` 即使正文碰巧含有“景别：”等字样，也不能自动伪装成新提示词；
    // 只有明确的新标签，或本身已经是完整七段式时才做规范化。
    const shouldCanonicalizeDescription =
      !!promptBlock || !!promptLine || isStructuredStoryboardDescription(rawDescription)
    const descriptionParts = shouldCanonicalizeDescription
      ? parseStoryboardDescriptionParts(rawDescription)
      : null
    const description = descriptionParts
      ? formatStoryboardDescription(descriptionParts, shotType)
      : rawDescription
    const dialogue = dialogueLine ? dialogueLine.replace(/\*\*台词\*\*:\s*/, '').trim() : ''
    const sound = soundLine ? soundLine.replace(/\*\*音效\*\*:\s*/, '').trim() : ''
    const userEditedMatch = section.match(/<!--\s*userEdited:\s*(true|false)\s*-->/i)
    const userEdited = userEditedMatch ? userEditedMatch[1].toLowerCase() === 'true' : undefined

    // 解析时间范围
    let endSec = startSec + 1
    const timeRangeMatch = timeRange.match(/(\d{2}):(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2}):(\d{2})/)
    if (timeRangeMatch) {
      endSec = parseInt(timeRangeMatch[4]) * 3600 + parseInt(timeRangeMatch[5]) * 60 + parseInt(timeRangeMatch[6])
    }
    // 精确结束秒（新版写入，优先用）；旧文件没有则沿用按 timeRange 解析的整数秒
    const endLine = lines.find((l) => l.startsWith('**结束秒**'))
    if (endLine) {
      const v = parseFloat(endLine.replace(/\*\*结束秒\*\*:\s*/, '').trim())
      if (!isNaN(v)) endSec = v
    }
    // 兜底：避免取整/旧数据导致 endSec < startSec 的负时长
    if (endSec < startSec) endSec = startSec

    // 解析场景差异
    const scoreLine = lines.find((l) => l.startsWith('**场景差异**'))
    const sceneScore = scoreLine ? parseFloat(scoreLine.replace(/\*\*场景差异\*\*:\s*/, '').trim()) || 0 : 0

    shots.push({
      number,
      shotType,
      angle,
      cameraMove,
      description,
      dialogue,
      sound,
      timeRange,
      startSec,
      endSec,
      sceneScore,
      userEdited,
    })

    framePaths.push(framePath)
  }

  return {
    id: path.basename(projectDir),
    videoPath: meta.videoPath,
    createdAt: meta.createdAt,
    shots,
    framePaths,
  }
}

function parseMeta(md: string): { videoPath: string; videoName: string; createdAt: number } {
  let videoPath = ''
  let videoName = ''
  let createdAt = 0

  const videoMatch = md.match(/源视频:\s*`?([^`\n]+)`?/)
  if (videoMatch) {
    videoPath = videoMatch[1].trim()
    videoName = path.basename(videoPath)
  }

  const dateMatch = md.match(/生成时间:\s*(.+)/)
  if (dateMatch) {
    const d = new Date(dateMatch[1].trim())
    if (!isNaN(d.getTime())) createdAt = d.getTime()
  }

  return { videoPath, videoName, createdAt }
}

function formatHMS(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 与人工切点 sidecar 的整数毫秒规则一致，规避 toFixed 在半毫秒附近的浮点下溢。 */
function formatPreciseSeconds(sec: number): string {
  return (Math.round(sec * 1000) / 1000).toFixed(3)
}
