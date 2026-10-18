import { Document, Paragraph, TextRun, Packer, HeadingLevel, AlignmentType } from 'docx'
import type { ScriptResult } from '@shared/types'

function formatHMS(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export async function generateScriptDocx(result: ScriptResult): Promise<Buffer> {
  const children: Paragraph[] = []

  // 标题
  children.push(
    new Paragraph({
      text: '剧本',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  )

  // 元信息
  const videoName = result.videoPath ? result.videoPath.replace(/.*[\\/]/, '') : '未知视频'
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `源视频: `, bold: true, size: 20 }),
        new TextRun({ text: videoName, size: 20 }),
      ],
      spacing: { after: 100 },
    })
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `时长: `, bold: true, size: 20 }),
        new TextRun({ text: formatHMS(result.durationSec), size: 20 }),
      ],
      spacing: { after: 100 },
    })
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `场景数: `, bold: true, size: 20 }),
        new TextRun({ text: String(result.scenes.length), size: 20 }),
      ],
      spacing: { after: 200 },
    })
  )

  // 分割线
  children.push(new Paragraph({ text: '', spacing: { after: 200 } }))

  // 每个场景
  for (let i = 0; i < result.scenes.length; i++) {
    const scene = result.scenes[i]

    children.push(
      new Paragraph({
        text: `${scene.heading} (${formatHMS(scene.startSec)})`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    )

    const bodyLines = scene.body.split('\n').slice(1)
    for (const line of bodyLines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      if (trimmed.startsWith('△')) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: trimmed, italics: true, color: '666666', size: 20 })],
            spacing: { after: 60 },
          })
        )
      } else if (trimmed.startsWith('人物：')) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: trimmed, color: '666666', size: 18 })],
            spacing: { after: 60 },
          })
        )
      } else if (trimmed.startsWith('【字幕') || trimmed.startsWith('【闪回')) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: trimmed, color: 'CC8833', size: 20 })],
            spacing: { after: 60 },
          })
        )
      } else {
        const dialogueMatch = trimmed.match(/^([^：]+?)([vV][oO]|[oO][sS])?：(.*)$/)
        if (dialogueMatch) {
          const character = dialogueMatch[1]
          const tag = dialogueMatch[2]?.toLowerCase()
          const content = dialogueMatch[3]
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: character, bold: true, color: 'D4A373', size: 20 }),
                ...(tag ? [new TextRun({ text: ` (${tag})`, color: '999999', size: 16 })] : []),
                new TextRun({ text: '：', color: '999999', size: 20 }),
                new TextRun({ text: content, size: 20 }),
              ],
              spacing: { after: 60 },
            })
          )
        } else {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: trimmed, size: 20 })],
              spacing: { after: 60 },
            })
          )
        }
      }
    }
  }

  // 如果没有解析出场景，直接输出原文
  if (result.scenes.length === 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: result.script, size: 20 })],
      })
    )
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })

  return await Packer.toBuffer(doc)
}
