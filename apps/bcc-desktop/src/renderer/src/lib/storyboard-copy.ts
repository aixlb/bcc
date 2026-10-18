import type { StoryboardShot } from '@shared/types'

export interface StoryboardCopyTarget {
  label: string
  text: string
}

/** 把单镜完整文字排成可直接粘贴到文档/聊天窗口的稳定纯文本。 */
export function formatStoryboardShotForClipboard(shot: StoryboardShot): string {
  const lines = [
    `镜号：${String(shot.number).padStart(3, '0')}`,
    shot.timeRange ? `时间：${shot.timeRange}` : '',
    shot.shotType ? `景别：${shot.shotType}` : '',
    shot.angle ? `角度：${shot.angle}` : '',
    shot.cameraMove ? `运镜：${shot.cameraMove}` : '',
    shot.description ? `提示词描述：\n${shot.description}` : '',
    shot.dialogue ? `台词：${shot.dialogue}` : '',
    shot.sound ? `音效：${shot.sound}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

/** Electron 渲染进程优先走 Clipboard API；不可用时回退到隐藏 textarea。 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 某些 file/app 协议下 Clipboard API 会被权限策略拒绝，继续走 DOM 回退。
  }

  const textarea = document.createElement('textarea')
  try {
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
