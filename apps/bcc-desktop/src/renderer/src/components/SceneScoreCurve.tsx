import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, LockKeyhole, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { SceneScoreData, StoryboardShot } from '@shared/types'
import { cn } from '../lib/utils'

type MutationResult = { ok: boolean; reason?: string } | void

type Marker = {
  index: number
  t: number
  number: number
  score?: number
}

type CurveMenu = {
  x: number
  y: number
  t: number
  markerIndex?: number
}

type CutEditor = {
  mode: 'add' | 'move' | 'delete'
  x: number
  y: number
  markerIndex?: number
  originalT: number
}

type Notice = {
  text: string
  tone: 'error' | 'success'
}

const SHORT_SHOT_SECONDS = 0.1

/**
 * 每帧差异值曲线：横轴与时间轴对齐，画阈值线、播放头与切点标记。
 *
 * - 只传 cuts：只读核对曲线（作业抽屉）。
 * - 传 cuts + onAddShot：切割完成、识别前可在空白处右键新增。
 * - 传 shots + CRUD callbacks：识别完成后的完整切点编辑器。
 *   首个 t=0 切点永久锁定。
 */
export function SceneScoreCurve({
  data,
  duration,
  currentTime,
  canEditShots = false,
  shots,
  onAddShot,
  onMoveShot,
  onDeleteShot,
  onSeek,
  cuts,
  label = '帧差异值',
}: {
  data: SceneScoreData
  duration: number
  /** 播放头位置（秒）；不传则不画播放头（如截图核对阶段无播放器） */
  currentTime?: number
  /** 已落盘的当前分镜；提供后切点 marker 可查询，并在 canEditShots 时可编辑 */
  shots?: StoryboardShot[]
  /** 当前阶段是否允许使用所提供的切点编辑能力 */
  canEditShots?: boolean
  /** 在指定秒处新增分镜 */
  onAddShot?: (sec: number) => Promise<MutationResult>
  /** 把 0-based 分镜起点移动到指定秒 */
  onMoveShot?: (index: number, sec: number) => Promise<MutationResult>
  /** 删除 0-based 分镜；等价于删除其起始切点并与前一镜合并 */
  onDeleteShot?: (index: number) => Promise<MutationResult>
  /** 点击曲线或 marker 跳转视频 */
  onSeek?: (sec: number) => void
  /** 尚未生成完整分镜时的切点时间戳 */
  cuts?: number[]
  /** 曲线标题；检测降级时可说明当前仅展示切割时间轴 */
  label?: string
}) {
  const [hover, setHover] = useState<{
    ratio: number
    t: number
    score: number
    markerIndex?: number
  } | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<number | null>(null)
  const [menu, setMenu] = useState<CurveMenu | null>(null)
  const [editor, setEditor] = useState<CutEditor | null>(null)
  const [timeInput, setTimeInput] = useState('')
  const [busy, setBusy] = useState<'add' | 'move' | 'delete' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(id)
  }, [notice])

  // 截图核对阶段可能没有 <video>；优先使用曲线持久化的完整时长，
  // 末点通常只是最后一个采样帧，不能拿它误判视频尾部的合法人工切点。
  const dur =
    duration > 0
      ? duration
      : data.durationSec > 0
        ? data.durationSec
        : data.points[data.points.length - 1]?.t || 1

  const markers = useMemo<Marker[]>(() => {
    if (shots) {
      return shots.map((shot, index) => ({
        index,
        t: shot.startSec,
        number: shot.number || index + 1,
        score: shot.sceneScore,
      }))
    }
    return (cuts ?? []).map((t, index) => ({ index, t, number: index + 1 }))
  }, [shots, cuts])

  useEffect(() => {
    if (selectedMarker != null && selectedMarker >= markers.length) setSelectedMarker(null)
  }, [markers.length, selectedMarker])

  // 关闭右键菜单：任意左键点击 / Esc。精确编辑弹层自己处理关闭。
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const { points, threshold } = data
  const W = 1000
  const H = 100

  // 静态几何只随曲线数据/时长变化；播放头每秒刷新多次，不能让它重算 1500 点的折线串
  const { maxScore, polyline, area, thresholdY } = useMemo(() => {
    const x = (t: number) => Math.max(0, Math.min(W, (t / dur) * W))
    const y = (score: number, mY: number) => H - (Math.max(0, Math.min(mY, score)) / mY) * H
    const mScore = points.reduce((m, p) => (p.score > m ? p.score : m), 0)
    // y 轴上限：让阈值线和峰值都看得清（至少留出阈值上方一点空间）
    const mY = Math.max(threshold * 1.3, mScore, 0.05)
    const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.score, mY).toFixed(1)}`).join(' ')
    const first = points[0]
    const last = points[points.length - 1]
    const ar = first && last ? `${x(first.t).toFixed(1)},${H} ${line} ${x(last.t).toFixed(1)},${H}` : ''
    return { maxScore: mScore, polyline: line, area: ar, thresholdY: y(threshold, mY) }
  }, [points, threshold, dur])

  const interactive = !!onSeek
  const canAdd = canEditShots && !!onAddShot
  const canMove = canEditShots && !!shots && !!onMoveShot
  const canDelete = canEditShots && !!shots && !!onDeleteShot
  const editable = canAdd || canMove || canDelete
  const playheadX =
    currentTime != null ? Math.max(0, Math.min(W, (currentTime / dur) * W)) : null

  const findNearest = (t: number) => {
    // points 已按时间升序，线性扫描足够（≤1500 点）
    let best = points[0] ?? { t: 0, score: 0 }
    let bestD = Math.abs(best.t - t)
    for (const p of points) {
      const d = Math.abs(p.t - t)
      if (d < bestD) {
        best = p
        bestD = d
      }
    }
    return best
  }

  const markerAtClientX = (clientX: number, rect: DOMRect): Marker | undefined => {
    let best: Marker | undefined
    let bestPx = Infinity
    for (const marker of markers) {
      const markerX = rect.left + (marker.t / dur) * rect.width
      const d = Math.abs(clientX - markerX)
      if (d < bestPx) {
        bestPx = d
        best = marker
      }
    }
    // marker 本身只有 1px，给桌面鼠标一个清晰可命中的热区
    return bestPx <= 8 ? best : undefined
  }

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t = ratio * dur
    const near = findNearest(t)
    const marker = markerAtClientX(e.clientX, rect)
    setHover({ ratio, t, score: near.score, markerIndex: marker?.index })
  }

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault() // 抑制 Electron 原生右键菜单；只读曲线右键不弹任何菜单
    if (!editable || busy) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const pointerT = ratio * dur
    const marker = markerAtClientX(e.clientX, rect)
    const t = marker?.t ?? pointerT
    if (marker) setSelectedMarker(marker.index)
    onSeek?.(t)
    if (marker && marker.index > 0 && !canMove && !canDelete) return
    if (!marker && !canAdd) return
    const { x, y } = clampPopoverPoint(e.clientX, e.clientY, 270, 190)
    setMenu({ x, y, t, markerIndex: marker?.index })
  }

  const openEditor = (mode: CutEditor['mode'], source: CurveMenu) => {
    setMenu(null)
    const originalT = source.markerIndex != null ? markers[source.markerIndex]?.t ?? source.t : source.t
    setTimeInput(formatPreciseTime(originalT))
    setEditor({
      mode,
      x: source.x,
      y: source.y,
      markerIndex: source.markerIndex,
      originalT,
    })
  }

  const mutationFailure = (result: MutationResult, fallback: string): string | null => {
    return result && !result.ok ? result.reason || fallback : null
  }

  const submitTimeEdit = async () => {
    if (!editor || editor.mode === 'delete' || busy) return
    const candidate = getCandidateState(editor, timeInput, markers, dur)
    if (candidate.error || candidate.value == null) return

    setBusy(editor.mode)
    setEditor(null)
    try {
      const result =
        editor.mode === 'add'
          ? await onAddShot?.(candidate.value)
          : await onMoveShot?.(editor.markerIndex!, candidate.value)
      const error = mutationFailure(result, editor.mode === 'add' ? '新增切点失败' : '调整切点失败')
      setNotice(
        error
          ? { text: error, tone: 'error' }
          : {
              text:
                editor.mode === 'add'
                  ? `已新增切点 ${formatPreciseTime(candidate.value)}`
                  : `已调整至 ${formatPreciseTime(candidate.value)}`,
              tone: 'success',
            }
      )
    } catch (e: any) {
      setNotice({
        text: e?.message || (editor.mode === 'add' ? '新增切点失败，请重试' : '调整切点失败，请重试'),
        tone: 'error',
      })
    } finally {
      setBusy(null)
    }
  }

  const submitDelete = async () => {
    if (!editor || editor.mode !== 'delete' || editor.markerIndex == null || busy) return
    const index = editor.markerIndex
    setBusy('delete')
    setEditor(null)
    try {
      const result = await onDeleteShot?.(index)
      const error = mutationFailure(result, '删除切点失败')
      setNotice(
        error
          ? { text: error, tone: 'error' }
          : { text: `已删除切点 ${formatPreciseTime(editor.originalT)}`, tone: 'success' }
      )
      if (!error) setSelectedMarker(null)
    } catch (e: any) {
      setNotice({ text: e?.message || '删除切点失败，请重试', tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const queriedMarker =
    hover?.markerIndex != null
      ? markers[hover.markerIndex]
      : selectedMarker != null
        ? markers[selectedMarker]
        : undefined

  const editorCandidate = editor ? getCandidateState(editor, timeInput, markers, dur) : null
  const busyLabel =
    busy === 'add' ? '正在新增分镜…' : busy === 'move' ? '正在调整切点…' : '正在删除并合并分镜…'

  return (
    <div className="relative mt-1.5">
      <div className="mb-0.5 flex items-center justify-between gap-3 text-[9px] text-zinc-600">
        <span className="shrink-0 text-zinc-500">
          {label}
          {canAdd ? ' · 空白处右键新增' : ''}
          {canMove || canDelete ? ' · 切点右键编辑' : ''}
        </span>
        <span className="min-w-0 truncate font-mono">
          {notice ? (
            <span className={notice.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}>
              {notice.text}
            </span>
          ) : queriedMarker ? (
            <span className="text-amber-300">
              {queriedMarker.index === 0 ? '首帧锚点' : `切点 #${pad3(queriedMarker.number)}`} ·{' '}
              {formatPreciseTime(queriedMarker.t)}
              {typeof queriedMarker.score === 'number' ? ` · 差异 ${queriedMarker.score.toFixed(3)}` : ''}
            </span>
          ) : hover ? (
            <span className="text-amber-300">
              {formatPreciseTime(hover.t)} · {hover.score.toFixed(3)}
            </span>
          ) : (
            <span>阈值 {threshold.toFixed(2)} · 峰值 {maxScore.toFixed(3)}</span>
          )}
        </span>
      </div>

      <div
        className={cn(
          'relative h-10 overflow-hidden rounded-md border border-white/[0.05] bg-black/30',
          interactive ? 'cursor-pointer' : 'cursor-default'
        )}
        onClick={(e) => {
          if (!onSeek || busy) return
          const rect = e.currentTarget.getBoundingClientRect()
          const marker = markerAtClientX(e.clientX, rect)
          if (marker) {
            setSelectedMarker(marker.index)
            onSeek(marker.t)
            return
          }
          setSelectedMarker(null)
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          onSeek(ratio * dur)
        }}
        onContextMenu={onContextMenu}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          {/* 阈值线：差异值高于它的帧会被判为切点 */}
          <line
            x1={0}
            x2={W}
            y1={thresholdY}
            y2={thresholdY}
            stroke="rgba(251,191,36,0.55)"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          {/* 差异曲线及其填充 */}
          <polygon points={area} fill="rgba(96,165,250,0.16)" />
          <polyline
            points={polyline}
            fill="none"
            stroke="rgba(96,165,250,0.9)"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
          {/* 切点标记；首镜起点是不可删除、不可移动的锁定锚点 */}
          {markers.map((marker) => {
            const cx = Math.max(0.8, Math.min(W - 0.8, (marker.t / dur) * W))
            const selected = marker.index === selectedMarker || marker.index === hover?.markerIndex
            const locked = marker.index === 0
            return (
              <g key={`${marker.index}-${marker.t}`}>
                <line
                  x1={cx}
                  x2={cx}
                  y1={0}
                  y2={H}
                  stroke={
                    locked
                      ? 'rgba(161,161,170,0.75)'
                      : selected
                        ? 'rgba(253,230,138,1)'
                        : 'rgba(212,163,115,0.55)'
                  }
                  strokeWidth={selected ? 2 : locked ? 1.5 : 1}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={cx}
                  cy={9}
                  r={selected ? 4.5 : 3.2}
                  fill={locked ? 'rgba(161,161,170,0.95)' : 'rgba(212,163,115,0.95)'}
                  stroke={selected ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.5)'}
                  strokeWidth={selected ? 1.2 : 0.8}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}
          {/* 播放头 */}
          {playheadX != null && (
            <line
              x1={playheadX}
              x2={playheadX}
              y1={0}
              y2={H}
              stroke="rgba(255,255,255,0.85)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* 悬停指示线；命中 marker 时 marker 自身已经高亮，不再叠一条线 */}
          {hover && hover.markerIndex == null && (
            <line
              x1={hover.ratio * W}
              x2={hover.ratio * W}
              y1={0}
              y2={H}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-zinc-200">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-accent" />
            {busyLabel}
          </div>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-[230px] overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/95 py-1 shadow-2xl backdrop-blur-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="border-b border-white/[0.06] px-3 py-1.5 font-mono text-[10px] text-zinc-500">
            {menu.markerIndex == null
              ? `新切点 · ${formatPreciseTime(menu.t)}`
              : menu.markerIndex === 0
                ? `首帧锚点 · ${formatPreciseTime(menu.t)}`
                : `切点 #${pad3(markers[menu.markerIndex]?.number ?? menu.markerIndex + 1)} · ${formatPreciseTime(menu.t)}`}
          </div>
          {menu.markerIndex == null ? (
            <CurveMenuButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label="在此新增分镜…"
              onClick={() => openEditor('add', menu)}
            />
          ) : menu.markerIndex === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
              <LockKeyhole className="h-3.5 w-3.5" />
              首镜必须从 00:00:00.000 开始
            </div>
          ) : (
            <>
              {canMove && (
                <CurveMenuButton
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  label="调整切点…"
                  onClick={() => openEditor('move', menu)}
                />
              )}
              {canDelete && (
                <CurveMenuButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="删除切点…"
                  danger
                  onClick={() => openEditor('delete', menu)}
                />
              )}
            </>
          )}
        </div>
      )}

      {editor && (
        <div
          className="fixed inset-0 z-[60]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setEditor(null)
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="fixed w-[300px] rounded-xl border border-white/[0.09] bg-ink-950/95 p-3 shadow-2xl backdrop-blur-xl"
            style={{ left: editor.x, top: editor.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditor(null)
              if (e.key === 'Enter' && editor.mode !== 'delete') {
                e.preventDefault()
                void submitTimeEdit()
              }
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-zinc-100">
                {editor.mode === 'add'
                  ? '新增分镜切点'
                  : editor.mode === 'move'
                    ? `调整切点 #${pad3(markers[editor.markerIndex!]?.number ?? editor.markerIndex! + 1)}`
                    : '删除切点'}
              </div>
              <button
                onClick={() => setEditor(null)}
                className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                aria-label="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {editor.mode === 'delete' ? (
              <>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  删除 {formatPreciseTime(editor.originalT)} 的切点后，将合并
                  <span className="mx-1 text-zinc-200">
                    镜 {shots?.[editor.markerIndex! - 1]?.number ?? editor.markerIndex}
                  </span>
                  与
                  <span className="mx-1 text-zinc-200">
                    镜 {shots?.[editor.markerIndex!]?.number ?? editor.markerIndex! + 1}
                  </span>
                  。后一个分镜及其关键帧会被删除。
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setEditor(null)} className="btn-ghost !px-2.5 !py-1 text-[11px]">
                    取消
                  </button>
                  <button
                    onClick={() => void submitDelete()}
                    className="btn-danger flex items-center gap-1.5 !px-2.5 !py-1 text-[11px]"
                  >
                    <Trash2 className="h-3 w-3" />
                    删除并合并
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-zinc-500">精确秒 / 时间码</span>
                  <input
                    autoFocus
                    value={timeInput}
                    onChange={(e) => setTimeInput(e.target.value)}
                    spellCheck={false}
                    className={cn(
                      'w-full rounded-md border bg-black/30 px-2 py-1.5 font-mono text-xs text-zinc-100 outline-none transition-colors',
                      editorCandidate?.error
                        ? 'border-red-400/40 focus:border-red-400/70'
                        : 'border-white/[0.09] focus:border-accent/50'
                    )}
                  />
                </label>
                <div className="mt-1 text-[9.5px] text-zinc-600">
                  可输入精确秒（12.417）或 HH:MM:SS.mmm
                </div>
                {editor.mode === 'move' && (
                  <div className="mt-1 font-mono text-[9.5px] text-zinc-600">
                    当前 {formatPreciseTime(editor.originalT)}
                  </div>
                )}
                {editorCandidate?.error ? (
                  <div className="mt-2 text-[10px] text-red-300">{editorCandidate.error}</div>
                ) : editorCandidate?.warning ? (
                  <div className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-amber-200">
                    {editorCandidate.warning}
                  </div>
                ) : null}
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setEditor(null)} className="btn-ghost !px-2.5 !py-1 text-[11px]">
                    取消
                  </button>
                  <button
                    onClick={() => void submitTimeEdit()}
                    disabled={!!editorCandidate?.error || editorCandidate?.value == null}
                    className="btn-primary flex items-center gap-1.5 !px-2.5 !py-1 text-[11px] disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    {editor.mode === 'add' ? '新增' : '保存'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CurveMenuButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        danger
          ? 'text-red-300 hover:bg-red-500/10 hover:text-red-200'
          : 'text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100'
      )}
    >
      <span className={danger ? 'text-red-400' : 'text-accent'}>{icon}</span>
      {label}
    </button>
  )
}

function getCandidateState(
  editor: CutEditor,
  input: string,
  markers: Marker[],
  duration: number
): { value: number | null; error?: string; warning?: string } {
  const value = parsePreciseTime(input)
  if (value == null) {
    return { value: null, error: '请输入有效的精确秒或 HH:MM:SS.mmm 时间码' }
  }
  if (value <= 0 || value >= duration) {
    return {
      value,
      error: `切点必须大于 00:00:00.000，且小于视频末尾 ${formatPreciseTime(duration)}`,
    }
  }

  if (editor.mode === 'add') {
    if (markers.some((marker) => sameBoundaryMillisecond(marker.t, value))) {
      return { value, error: '该精确时间已经有切点' }
    }
    const nextIndex = markers.findIndex((marker) => marker.t > value)
    const prev = nextIndex <= 0 ? 0 : markers[nextIndex - 1].t
    const next = nextIndex < 0 ? duration : markers[nextIndex].t
    return {
      value,
      warning: shortShotWarning(value - prev, next - value),
    }
  }

  if (editor.mode === 'move') {
    const index = editor.markerIndex ?? -1
    if (index <= 0) return { value, error: '首帧锚点不能调整' }
    if (sameBoundaryMillisecond(editor.originalT, value)) {
      return { value, error: '切点时间没有变化' }
    }
    const prev = markers[index - 1]?.t ?? 0
    const next = markers[index + 1]?.t ?? duration
    if (value <= prev || value >= next) {
      return {
        value,
        error: `新时间必须位于相邻切点之间：${formatPreciseTime(prev)} – ${formatPreciseTime(next)}`,
      }
    }
    return {
      value,
      warning: shortShotWarning(value - prev, next - value),
    }
  }

  return { value }
}

function shortShotWarning(leftSec: number, rightSec: number): string | undefined {
  const shortest = Math.min(leftSec, rightSec)
  if (shortest >= SHORT_SHOT_SECONDS) return undefined
  return `将产生极短镜头（最短 ${Math.max(0, shortest).toFixed(3)} 秒）。确认时间准确后仍可保存。`
}

function sameBoundaryMillisecond(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000)
}

function parsePreciseTime(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (!text.includes(':')) {
    const seconds = Number(text)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  }

  const parts = text.split(':')
  if (parts.length !== 3) return null
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    return null
  }
  return hours * 3600 + minutes * 60 + seconds
}

function formatPreciseTime(sec: number): string {
  const safe = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const totalMs = Math.round(safe * 1000)
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function clampPopoverPoint(
  clientX: number,
  clientY: number,
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
  }
}

function pad3(value: number): string {
  return String(value).padStart(3, '0')
}
