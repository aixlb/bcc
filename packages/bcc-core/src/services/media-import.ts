/**
 * 沙盒媒体导入。
 *
 * Mac App Store 强制 App Sandbox：被 spawn 出来的 ffmpeg/ffprobe 子进程
 * 无法按路径访问「容器之外」的用户文件（安全作用域不会传递给子进程）。
 * 因此在导入时把源视频拷贝进沙盒容器目录，后续所有 ffmpeg 处理、预览、
 * 跨会话重读都走容器内副本。
 *
 * 非沙盒构建（Windows / 公证 DMG / 开发）原样返回外部路径，行为完全不变。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { isSandboxed } from './paths.js'

/**
 * 把用户选择的视频导入到容器目录 destDir。
 * 沙盒下拷贝并返回容器内路径（保留原文件名）；否则原样返回 externalPath。
 */
export async function importMediaToContainer(externalPath: string, destDir: string): Promise<string> {
  if (!externalPath || !isSandboxed()) return externalPath

  await fs.mkdir(destDir, { recursive: true })
  const dest = path.join(destDir, path.basename(externalPath))

  // 已在容器内（同一路径）则跳过，避免自拷贝
  if (path.resolve(externalPath) === path.resolve(dest)) return externalPath

  // 不同来源可能同名（不同目录各有一个 clip.mp4）。多个视频会并发导入同一 videos/ 目录，
  // 直接 copyFile 会用默认覆盖语义把先到的文件冲掉 → 数据丢失。用 COPYFILE_EXCL 防覆盖，
  // 冲突时：体积一致视为「同一文件重复导入」直接复用，否则追加序号另存。
  return await copyIntoContainerUnique(externalPath, dest)
}

async function copyIntoContainerUnique(src: string, preferredDest: string): Promise<string> {
  const dir = path.dirname(preferredDest)
  const ext = path.extname(preferredDest)
  const stem = path.basename(preferredDest, ext)
  const srcSize = (await fs.stat(src)).size

  let candidate = preferredDest
  for (let i = 1; i <= 1000; i++) {
    try {
      await fs.copyFile(src, candidate, fs.constants.COPYFILE_EXCL)
      return candidate
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err
      // 目标已存在：体积一致视为同一文件（重复导入）→ 复用，避免重复占空间且保持去重语义
      try {
        if ((await fs.stat(candidate)).size === srcSize) return candidate
      } catch {
        /* 读不到目标信息就换名重试 */
      }
      candidate = path.join(dir, `${stem}_${i}${ext}`)
    }
  }
  throw new Error(`无法为 ${path.basename(src)} 在容器内分配唯一文件名`)
}
