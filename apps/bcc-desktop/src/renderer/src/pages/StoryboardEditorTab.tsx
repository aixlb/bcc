import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  RefreshCw,
  Loader2,
  RotateCw,
  AlertTriangle,
  Pencil,
  Trash2,
  Scissors,
  Copy,
  Check,
  X,
} from 'lucide-react'
import type { StoryboardProject, StoryboardShot } from '@shared/types'
import {
  STORYBOARD_PENDING_DESC,
  STORYBOARD_SHOT_TYPES,
  createStoryboardDescriptionTemplate,
  formatStoryboardDescription,
  isStructuredStoryboardDescription,
  normalizeStoryboardShotType,
  parseStoryboardDescriptionParts,
} from '@shared/defaults'
import { api } from '../lib/api'
import {
  copyTextToClipboard,
  formatStoryboardShotForClipboard,
  type StoryboardCopyTarget,
} from '../lib/storyboard-copy'
import { cn } from '../lib/utils'

interface Props {
  /** 顶层项目 id；提供时才启用「重新识别 / 重新生成 / 编辑 / 删除」（蒸馏子分镜为只读，不传） */
  projectId?: string
  project: StoryboardProject
  currentTime: number
  /** 生成作业进行中：分镜表是未落盘的占位脚手架，禁用重新识别/重新生成（避免读不到 md 报错、清空错误态等） */
  generating?: boolean
  onShotClick: (sec: number) => void
  /** 重新切割分镜（重新走 切割→确认→识别 全流程，覆盖当前分镜表） */
  onRecut?: () => void
}

/** 判断某个分镜是否处于「分析失败」状态 */
function isFailedShot(shot: StoryboardShot): boolean {
  return (shot.description ?? '').startsWith('分析失败')
}

/** 手动新增、AI 识别尚未完成的占位分镜：复用 loading 态显示「识别中」转圈 */
function isPendingShot(shot: StoryboardShot): boolean {
  return (shot.description ?? '') === STORYBOARD_PENDING_DESC
}

function isLegacyDescription(shot: StoryboardShot): boolean {
  return !!shot.description && !isPendingShot(shot) && !isFailedShot(shot) &&
    !isStructuredStoryboardDescription(shot.description)
}

/** 可编辑的分镜文本字段 */
export interface ShotEditFields {
  shotType: string
  angle: string
  cameraMove: string
  description: string
  dialogue: string
  sound: string
}

interface StoryboardMenuState {
  x: number
  y: number
  shotIndex?: number
  copyTarget?: StoryboardCopyTarget
}

export function StoryboardEditorTab({
  projectId,
  project,
  currentTime,
  generating = false,
  onShotClick,
  onRecut,
}: Props) {
  const activeShotIdx = useMemo(() => {
    return findActiveShotIndex(project.shots, currentTime)
  }, [project.shots, currentTime])

  // 正在重新识别的镜头序号集合（loading 态）
  const [reanalyzing, setReanalyzing] = useState<Set<number>>(new Set())
  // 每个镜头最近一次重新识别的错误信息
  const [errors, setErrors] = useState<Record<number, string>>({})
  // 右键菜单位置 + 命中的镜头/文字字段。
  const [menu, setMenu] = useState<StoryboardMenuState | null>(null)
  // 正在弹窗编辑的镜头序号
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [busyIdx, setBusyIdx] = useState<number | null>(null)

  // 生成作业进行中分镜表尚未落盘，重新识别会读不到 md，先禁用
  const canEdit = !!projectId && !generating

  const failedIndices = useMemo(
    () => project.shots.map((s, i) => (isFailedShot(s) ? i : -1)).filter((i) => i >= 0),
    [project.shots]
  )

  // 监听单镜重新识别完成事件：清掉对应 loading，并记录/清除错误
  useEffect(() => {
    if (!projectId) return
    const off = api().onStoryboardShotUpdated((ev) => {
      if (ev.projectId !== projectId) return
      setReanalyzing((prev) => {
        if (!prev.has(ev.index)) return prev
        const next = new Set(prev)
        next.delete(ev.index)
        return next
      })
      setErrors((prev) => {
        if (ev.error) return { ...prev, [ev.index]: ev.error }
        if (!(ev.index in prev)) return prev
        const next = { ...prev }
        delete next[ev.index]
        return next
      })
    })
    return off
  }, [projectId])

  // 关闭右键菜单：左键点击任意位置 / 按 Esc（右键在表格内会由容器 onContextMenu 重新定位）
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

  const startReanalyze = (indices: number[]) => {
    if (!projectId) return
    const valid = indices.filter((i) => i >= 0 && i < project.shots.length && !!project.framePaths[i])
    if (valid.length === 0) return
    setReanalyzing((prev) => new Set([...prev, ...valid]))
    setErrors((prev) => {
      const next = { ...prev }
      valid.forEach((i) => delete next[i])
      return next
    })
    api()
      .reanalyzeStoryboardShots(projectId, valid)
      .catch((err: any) => {
        const msg = err?.message ?? '重新识别失败'
        setErrors((prev) => {
          const next = { ...prev }
          valid.forEach((i) => (next[i] = msg))
          return next
        })
      })
      .finally(() => {
        // 兜底：清理任何未通过事件清除的 loading（如被服务端过滤的镜头）
        setReanalyzing((prev) => {
          const next = new Set(prev)
          valid.forEach((i) => next.delete(i))
          return next
        })
      })
  }

  const deleteShot = async (index: number) => {
    if (!projectId) return
    const shot = project.shots[index]
    if (!shot) return
    if (!window.confirm(`删除镜 ${shot.number}（${shot.timeRange}）？此操作不可撤销。`)) return
    setBusyIdx(index)
    try {
      const res = await api().deleteStoryboardShot(projectId, index)
      if (!res.ok && res.reason) window.alert(res.reason)
    } catch (e: any) {
      window.alert(e?.message ?? '删除失败')
    } finally {
      setBusyIdx(null)
    }
  }

  const saveEdit = async (index: number, fields: ShotEditFields) => {
    if (!projectId) return
    const res = await api().updateStoryboardShot(projectId, index, fields)
    if (!res.ok && res.reason) throw new Error(res.reason)
  }

  const anyRunning = reanalyzing.size > 0

  return (
    <div
      className="relative flex-1 overflow-auto px-4 py-4"
      onContextMenu={
        canEdit
          ? (e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY })
            }
          : undefined
      }
    >
      <div className="space-y-3">
        {project.shots.map((shot, i) => (
          <ShotCard
            key={i}
            shot={shot}
            framePath={project.framePaths[i]}
            isActive={i === activeShotIdx}
            failed={isFailedShot(shot)}
            loading={reanalyzing.has(i) || isPendingShot(shot) || busyIdx === i}
            error={errors[i]}
            onClick={() => onShotClick(shot.startSec)}
            onReanalyze={canEdit ? () => startReanalyze([i]) : undefined}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({
                x: e.clientX,
                y: e.clientY,
                shotIndex: i,
                copyTarget: {
                  label: '复制此镜全部文字',
                  text: formatStoryboardShotForClipboard(shot),
                },
              })
            }}
            onCopyContextMenu={(e, copyTarget) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({
                x: e.clientX,
                y: e.clientY,
                shotIndex: i,
                copyTarget,
              })
            }}
          />
        ))}
      </div>

      {menu && (canEdit || menu.copyTarget) && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          copyTarget={menu.copyTarget}
          onCopy={
            menu.copyTarget
              ? () => {
                  const target = menu.copyTarget!
                  setMenu(null)
                  void copyTextToClipboard(target.text).then((copied) => {
                    if (!copied) window.alert('复制失败，请重试')
                  })
                }
              : undefined
          }
          shot={menu.shotIndex != null ? project.shots[menu.shotIndex] : undefined}
          shotBusy={
            menu.shotIndex != null &&
            (reanalyzing.has(menu.shotIndex) ||
              isPendingShot(project.shots[menu.shotIndex]) ||
              busyIdx === menu.shotIndex)
          }
          running={anyRunning}
          failedCount={failedIndices.length}
          onEdit={
            canEdit && menu.shotIndex != null
              ? () => {
                  setEditingIdx(menu.shotIndex!)
                  setMenu(null)
                }
              : undefined
          }
          onReanalyzeOne={
            canEdit && menu.shotIndex != null
              ? () => {
                  startReanalyze([menu.shotIndex!])
                  setMenu(null)
                }
              : undefined
          }
          onDelete={
            canEdit && menu.shotIndex != null
              ? () => {
                  const idx = menu.shotIndex!
                  setMenu(null)
                  void deleteShot(idx)
                }
              : undefined
          }
          onAll={
            canEdit
              ? () => {
                  setMenu(null)
                  startReanalyze(project.shots.map((_, i) => i))
                }
              : undefined
          }
          onFailed={
            canEdit
              ? () => {
                  setMenu(null)
                  startReanalyze(failedIndices)
                }
              : undefined
          }
          onRecut={
            canEdit && onRecut
              ? () => {
                  // 进「切割前设置页」选方式/参数，点「开始切割」才真正启动（识别完成落盘时才覆盖旧分镜）
                  setMenu(null)
                  onRecut()
                }
              : undefined
          }
        />
      )}

      {editingIdx != null && project.shots[editingIdx] && (
        <ShotEditModal
          shot={project.shots[editingIdx]}
          onCancel={() => setEditingIdx(null)}
          onSave={async (fields) => {
            await saveEdit(editingIdx, fields)
            setEditingIdx(null)
          }}
        />
      )}
    </div>
  )
}

function ContextMenu({
  x,
  y,
  copyTarget,
  onCopy,
  shot,
  shotBusy,
  running,
  failedCount,
  onEdit,
  onReanalyzeOne,
  onDelete,
  onAll,
  onFailed,
  onRecut,
}: {
  x: number
  y: number
  /** 命中的具体文字字段；卡片空白处右键时为整镜文字。 */
  copyTarget?: StoryboardCopyTarget
  onCopy?: () => void
  /** 在具体镜头卡片上右键时的该镜数据（用于菜单标题） */
  shot?: StoryboardShot
  /** 该镜正在识别/删除中：禁用编辑与删除，避免并发操作后索引漂移写错镜头 */
  shotBusy?: boolean
  running: boolean
  failedCount: number
  onEdit?: () => void
  onReanalyzeOne?: () => void
  onDelete?: () => void
  onAll?: () => void
  onFailed?: () => void
  onRecut?: () => void
}) {
  return (
    <div
      className="fixed z-50 min-w-[188px] overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/95 py-1 shadow-2xl backdrop-blur-md"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {shot && (
        <div className="border-b border-white/[0.06] px-3 py-1.5 font-mono text-[10px] text-zinc-500">
          镜 {String(shot.number).padStart(3, '0')} · {shot.timeRange}
        </div>
      )}
      {onCopy && copyTarget && (
        <MenuItem
          icon={<Copy className="h-3.5 w-3.5" />}
          label={copyTarget.label}
          onClick={onCopy}
        />
      )}
      {onCopy && (onEdit || onReanalyzeOne || onDelete) && (
        <div className="my-1 border-t border-white/[0.06]" />
      )}
      {onEdit && (
        <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="编辑此镜…" onClick={onEdit} disabled={shotBusy} />
      )}
      {onReanalyzeOne && (
        <MenuItem
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          label="重新识别此镜"
          onClick={onReanalyzeOne}
          disabled={shotBusy}
        />
      )}
      {onDelete && (
        <MenuItem
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label={shot?.number === 1 ? '首镜不可删除' : '删除此镜'}
          onClick={onDelete}
          danger
          disabled={shotBusy || shot?.number === 1}
        />
      )}
      {(onEdit || onReanalyzeOne || onDelete) && (onAll || onFailed) && (
        <div className="my-1 border-t border-white/[0.06]" />
      )}
      {onAll && (
        <MenuItem icon={<RotateCw className="h-3.5 w-3.5" />} label="全部重新生成" onClick={onAll} />
      )}
      {onFailed && (
        <MenuItem
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={failedCount > 0 ? `失败重新生成（${failedCount}）` : '失败重新生成'}
          onClick={onFailed}
          disabled={failedCount === 0}
        />
      )}
      {onRecut && (
        <>
          <div className="my-1 border-t border-white/[0.06]" />
          <MenuItem icon={<Scissors className="h-3.5 w-3.5" />} label="重新切割分镜…" onClick={onRecut} />
        </>
      )}
      {running && (
        <div className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-zinc-500">
          正在重新识别…
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        disabled
          ? 'cursor-not-allowed text-zinc-600'
          : danger
            ? 'text-red-300 hover:bg-red-500/10 hover:text-red-200'
            : 'text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100'
      )}
    >
      <span className={disabled ? 'text-zinc-600' : danger ? 'text-red-400' : 'text-accent'}>{icon}</span>
      {label}
    </button>
  )
}

/** 弹窗表单：编辑单镜的景别/角度/运镜/提示词描述/台词/音效 */
function ShotEditModal({
  shot,
  onCancel,
  onSave,
}: {
  shot: StoryboardShot
  onCancel: () => void
  onSave: (fields: ShotEditFields) => Promise<void>
}) {
  const [fields, setFields] = useState<ShotEditFields>({
    shotType: normalizeStoryboardShotType(shot.shotType),
    angle: shot.angle,
    cameraMove: shot.cameraMove,
    description: shot.description || createStoryboardDescriptionTemplate(shot.shotType),
    dialogue: shot.dialogue,
    sound: shot.sound,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof ShotEditFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const shotType = normalizeStoryboardShotType(fields.shotType)
      const parsed = parseStoryboardDescriptionParts(fields.description)
      // 旧项目 prose 在用户没有碰描述时原样保留；一旦修改，就把文本放进「主体描述」
      // 并升级成固定七行，避免继续产生新的非结构化描述。
      const description =
        parsed
          ? formatStoryboardDescription(parsed, shotType)
          : fields.description === shot.description && isLegacyDescription(shot)
            ? fields.description
            : formatStoryboardDescription({ 主体描述: fields.description.trim() }, shotType)
      await onSave({ ...fields, shotType, description })
    } catch (e: any) {
      setError(e?.message ?? '保存失败')
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      onContextMenu={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
      <div
        className="w-[440px] max-w-[92vw] rounded-xl border border-white/[0.08] bg-ink-950/95 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-100">
            编辑镜 {String(shot.number).padStart(3, '0')}
            <span className="ml-2 font-mono text-[10px] text-zinc-500">{shot.timeRange}</span>
          </div>
          <button onClick={onCancel} className="btn-ghost !p-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <LabeledSelect
            label="景别"
            value={fields.shotType}
            options={STORYBOARD_SHOT_TYPES}
            onChange={(e) => {
              const shotType = e.target.value
              setFields((current) => {
                const parts = parseStoryboardDescriptionParts(current.description)
                return {
                  ...current,
                  shotType,
                  description: parts && STORYBOARD_SHOT_TYPES.some((value) => value === shotType)
                    ? formatStoryboardDescription(parts, shotType)
                    : current.description,
                }
              })
            }}
          />
          <LabeledInput label="角度" value={fields.angle} onChange={set('angle')} />
          <LabeledInput label="运镜" value={fields.cameraMove} onChange={set('cameraMove')} />
        </div>
        <LabeledTextarea
          label={isLegacyDescription(shot) ? '旧版画面描述（修改后升级为七段式）' : '提示词描述'}
          rows={9}
          value={fields.description}
          onChange={set('description')}
        />
        <LabeledTextarea label="台词" rows={2} value={fields.dialogue} onChange={set('dialogue')} />
        <LabeledTextarea label="音效" rows={2} value={fields.sound} onChange={set('sound')} />

        {error && <div className="mt-2 text-[11px] text-red-400">{error}</div>}

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost text-xs" disabled={saving}>
            取消
          </button>
          <button onClick={handleSave} className="btn-primary flex items-center gap-1.5 text-xs" disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <input value={value} onChange={onChange} className="input-field text-xs" spellCheck={false} />
    </label>
  )
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <select value={value} onChange={onChange} className="input-field text-xs">
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function LabeledTextarea({
  label,
  rows,
  value,
  onChange,
}: {
  label: string
  rows: number
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}) {
  return (
    <label className="mt-2 block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <textarea value={value} onChange={onChange} rows={rows} className="input-field resize-y text-xs" spellCheck={false} />
    </label>
  )
}

function ShotCard({
  shot,
  framePath,
  isActive,
  failed,
  loading,
  error,
  onClick,
  onReanalyze,
  onContextMenu,
  onCopyContextMenu,
}: {
  shot: StoryboardShot
  framePath: string
  isActive: boolean
  failed: boolean
  loading: boolean
  error?: string
  onClick: () => void
  onReanalyze?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onCopyContextMenu?: (e: React.MouseEvent, target: StoryboardCopyTarget) => void
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const structuredDescription = isStructuredStoryboardDescription(shot.description)
  const legacyDescription = isLegacyDescription(shot)
  const metaText = [shot.shotType, shot.angle, shot.cameraMove].filter(Boolean).join(' · ')
  const allText = formatStoryboardShotForClipboard(shot)

  useEffect(() => {
    if (!copiedField) return
    const timeout = window.setTimeout(() => setCopiedField(null), 1200)
    return () => window.clearTimeout(timeout)
  }, [copiedField])

  const copyField = async (e: React.MouseEvent, field: string, text: string) => {
    e.stopPropagation()
    if (await copyTextToClipboard(text)) setCopiedField(field)
    else window.alert('复制失败，请重试')
  }

  const openCopyMenu = (
    e: React.MouseEvent,
    label: string,
    text: string
  ) => {
    if (!text) return
    onCopyContextMenu?.(e, { label, text })
  }

  useEffect(() => {
    if (!framePath) {
      setImgSrc(null)
      setImgError(true)
      return
    }

    // framePath 变化（含按 index 复用卡片实例时）要先清掉上一轮的错误态，
    // 否则曾失败过的卡片即便新图加载成功也会一直显示「无图片」。
    setImgError(false)
    setImgSrc(null)

    let cancelled = false
    const mediaUrl = api().getMediaUrl(framePath)

    fetch(mediaUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl
        setImgSrc(objectUrl)
      })
      .catch(() => {
        if (cancelled) return
        setImgError(true)
      })

    return () => {
      cancelled = true
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [framePath])

  return (
    <motion.div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'scene-card flex cursor-pointer gap-3 px-3 py-3',
        isActive && 'active',
        failed && 'border-red-500/30 bg-red-500/[0.04]'
      )}
      whileHover={{ x: 2 }}
      transition={{ duration: 0.15 }}
    >
      {/* 缩略图 */}
      <div className="shrink-0">
        <div className="relative overflow-hidden rounded-lg border border-white/[0.06] bg-black/30"
             style={{ width: 120, height: 80 }}
        >
          {imgSrc && !imgError ? (
            <img
              src={imgSrc}
              alt={`镜${shot.number}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
              无图片
            </div>
          )}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          )}
        </div>
        <div className="mt-1 text-center font-mono text-[10px] text-amber-400">
          差异 {shot.sceneScore?.toFixed(3) ?? '0.000'}
        </div>
      </div>

      {/* 文字信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-accent">
            #{String(shot.number).padStart(3, '0')}
          </span>
          <span
            className="timecode"
            onContextMenu={(e) => openCopyMenu(e, '复制时间码', shot.timeRange)}
          >
            {shot.timeRange}
          </span>
          {shot.userEdited && (
            <span
              className="shrink-0 rounded border border-amber-400/20 bg-amber-400/[0.06] px-1 py-0.5 text-[9px] text-amber-300"
              title="此镜内容经过人工编辑；移动切点时会保留，点击“重新识别”才会覆盖"
            >
              人工内容
            </span>
          )}
          <span
            className="ml-auto min-w-0 truncate text-[10px] text-zinc-500"
            onContextMenu={(e) => openCopyMenu(e, '复制景别 / 角度 / 运镜', metaText)}
          >
            {metaText}
          </span>
          <InlineCopyButton
            copied={copiedField === 'all'}
            title="复制此镜全部文字"
            onClick={(e) => void copyField(e, 'all', allText)}
          />
          {onReanalyze && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (!loading) onReanalyze()
              }}
              disabled={loading}
              title={
                shot.userEdited
                  ? '重新调用 AI 识别这一镜，并覆盖当前人工内容'
                  : '复用当前截图，重新调用 AI 识别这一镜'
              }
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors',
                loading
                  ? 'cursor-default border-white/[0.06] text-zinc-500'
                  : failed
                    ? 'border-red-400/30 text-red-300 hover:bg-red-500/10'
                    : 'border-white/[0.08] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
              )}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {loading ? '识别中' : '重新识别'}
            </button>
          )}
        </div>
        {!!shot.description && (
          <div
            className="mt-1"
            onContextMenu={(e) =>
              openCopyMenu(
                e,
                structuredDescription ? '复制七段式提示词描述' : '复制画面描述',
                shot.description
              )
            }
          >
            {!failed && !isPendingShot(shot) && (
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">
                  {legacyDescription ? '旧版画面描述' : '提示词描述'}
                </span>
                <InlineCopyButton
                  copied={copiedField === 'description'}
                  title={structuredDescription ? '复制七段式提示词描述' : '复制画面描述'}
                  onClick={(e) => void copyField(e, 'description', shot.description)}
                />
              </div>
            )}
            <div
              className={cn(
                'whitespace-pre-line text-[11px] leading-relaxed',
                structuredDescription ? 'font-mono text-zinc-300' : 'line-clamp-2 text-[12px]',
                failed && 'text-red-300/90'
              )}
            >
              {shot.description}
            </div>
          </div>
        )}
        {shot.dialogue && (
          <div
            className="mt-0.5 flex items-center gap-1 text-[11px] text-film-300"
            onContextMenu={(e) => openCopyMenu(e, '复制台词', shot.dialogue)}
          >
            <span className="min-w-0 flex-1 truncate">台词：{shot.dialogue}</span>
            <InlineCopyButton
              copied={copiedField === 'dialogue'}
              title="复制台词"
              onClick={(e) => void copyField(e, 'dialogue', shot.dialogue)}
            />
          </div>
        )}
        {shot.sound && (
          <div
            className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500"
            onContextMenu={(e) => openCopyMenu(e, '复制音效', shot.sound)}
          >
            <span className="min-w-0 flex-1 truncate">🔊 {shot.sound}</span>
            <InlineCopyButton
              copied={copiedField === 'sound'}
              title="复制音效"
              onClick={(e) => void copyField(e, 'sound', shot.sound)}
            />
          </div>
        )}
        {error && !loading && (
          <div className="mt-0.5 truncate text-[10.5px] text-red-400" title={error}>
            重新识别失败：{error}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function InlineCopyButton({
  copied,
  title,
  onClick,
}: {
  copied: boolean
  title: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? '已复制' : title}
      title={copied ? '已复制' : title}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
        copied
          ? 'bg-emerald-400/10 text-emerald-300'
          : 'text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300'
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function findActiveShotIndex(shots: StoryboardShot[], currentTime: number): number {
  if (shots.length === 0) return -1
  let lo = 0
  let hi = shots.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (shots[mid].startSec <= currentTime) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
