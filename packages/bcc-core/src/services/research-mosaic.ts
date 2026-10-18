/**
 * 关键帧拼图：用 ffmpeg xstack filter 把 N 张图拼成 1 张网格
 * 4 列 480×270 网格，N 自然落在 1..12 之间
 */

import { spawn } from 'node:child_process'
import { ensureFfmpegBinaries } from './ffmpeg-runtime.js'

/**
 * 把 framePaths 拼成 outPath 的一张图。
 * - 不足 cols 列时按 ceil(N/cols) 行
 * - framePaths 为空 → 抛错
 */
export async function buildFrameMosaic(
  framePaths: string[],
  outPath: string,
  cols = 4
): Promise<void> {
  if (framePaths.length === 0) {
    throw new Error('buildFrameMosaic: framePaths 为空')
  }

  const N = framePaths.length
  const c = Math.max(1, Math.min(N, cols))
  const r = Math.ceil(N / c)
  const cellW = 480
  const cellH = 270

  // 单帧：xstack 要求 ≥2 路输入，直接缩放+黑边到一个单元格输出（否则 ffmpeg 报错退出）
  if (N === 1) {
    const args = [
      '-i', framePaths[0],
      '-vf',
      `scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,` +
        `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
      '-frames:v', '1',
      '-q:v', '3',
      '-y',
      outPath,
    ]
    console.log(`[mosaic] ffmpeg 单帧 -> ${outPath}`)
    await runMosaicFfmpeg(args)
    return
  }

  // 构造 xstack layout：layout=0_0|w0_0|w0+h0_0|...
  // 单元格 (col, row) → x = col*cellW, y = row*cellH
  const parts: string[] = []
  for (let i = 0; i < N; i++) {
    const col = i % c
    const row = Math.floor(i / c)
    const x = col * cellW
    const y = row * cellH
    parts.push(`${x}_${y}`)
  }
  const layout = parts.join('|')

  // 每个输入先统一到 cellW×cellH（保持比例 + 黑边 padding）
  const filterInputs: string[] = []
  for (let i = 0; i < N; i++) {
    filterInputs.push(
      `[${i}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,` +
        `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`
    )
  }
  const filter = filterInputs.join(';') + `;${Array.from({ length: N }, (_, i) => `[v${i}]`).join('')}xstack=inputs=${N}:layout=${layout}[out]`

  const args: string[] = []
  for (const p of framePaths) args.push('-i', p)
  args.push(
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    '-q:v', '3',
    '-y',
    outPath
  )

  console.log(`[mosaic] ffmpeg xstack ${N} 帧 -> ${outPath} (${c}x${r})`)

  await runMosaicFfmpeg(args)
}

/** 跑一次 ffmpeg 拼图命令，非零退出码即抛错 */
async function runMosaicFfmpeg(args: string[]): Promise<void> {
  const { ffmpeg: FFMPEG_BIN } = await ensureFfmpegBinaries()
  return new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg mosaic 退出码=${code}：${err.slice(-500)}`))
    })
  })
}
