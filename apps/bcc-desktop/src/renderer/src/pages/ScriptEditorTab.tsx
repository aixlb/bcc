import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { History, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { ScriptScene, ScriptResult, ScriptVersionsInfo } from '@shared/types'
import { api } from '../lib/api'
import { cn, formatHMS } from '../lib/utils'
import { DropdownSelect } from '../components/DropdownSelect'

interface Props {
  /** 顶层项目 id；提供时才启用版本切换与场景编辑（导入预览等场景不传则纯只读） */
  projectId?: string
  result: ScriptResult
  currentTime: number
  activeSceneIdx: number
  onSceneClick: (sec: number) => void
  /** 用当前配置的剧本 API 重新生成整份剧本（存为新版本，旧版本保留可切换） */
  onRegenerate?: () => void
  /** 重新生成将使用的 API 标签（右键菜单提示） */
  regenerateProviderLabel?: string
  /** 「剧本大师」选择下拉（父级持有状态），展示在版本栏「重新生成」旁 */
  masterSelect?: React.ReactNode
}

export function ScriptEditorTab({
  projectId,
  result,
  activeSceneIdx,
  onSceneClick,
  onRegenerate,
  regenerateProviderLabel,
  masterSelect,
}: Props) {
  const [versions, setVersions] = useState<ScriptVersionsInfo | null>(null)
  const [switching, setSwitching] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; sceneIdx?: number } | null>(null)
  const [modal, setModal] = useState<
    | { mode: 'edit'; sceneIdx: number }
    | { mode: 'insert'; afterIdx: number }
    | null
  >(null)

  // 加载版本清单；PROJECT_UPDATED 会带来新的 result 对象，顺带触发重取
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    api()
      .listScriptVersions(projectId)
      .then((info) => {
        if (!cancelled) setVersions(info)
      })
      .catch(() => {
        if (!cancelled) setVersions(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, result])

  // 关闭右键菜单
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

  // 剧本内容被外部更新（版本切换/重新生成完成）时关闭编辑弹窗和菜单：
  // 场景的 charStart/charEnd 是针对旧文本的，继续保存会把替换切错位置
  const scriptText = result?.script
  useEffect(() => {
    setModal(null)
    setMenu(null)
  }, [scriptText])

  if (!result) return null

  const canEdit = !!projectId

  const handleSwitchVersion = async (versionId: string) => {
    if (!projectId || !versions || versionId === versions.activeId) return
    setSwitching(true)
    try {
      await api().switchScriptVersion(projectId, versionId)
      // 内容经 PROJECT_UPDATED 自动重载
    } catch (e) {
      console.error('switchScriptVersion failed', e)
    } finally {
      setSwitching(false)
    }
  }

  const handleDeleteVersion = async () => {
    if (!projectId || !versions) return
    const active = versions.versions.find((v) => v.id === versions.activeId)
    if (!active) return
    const label = versionLabel(versions, active.id)
    if (!window.confirm(`删除当前版本「${label}」？${versions.versions.length === 1 ? '这是最后一个版本，删除后项目将没有剧本。' : '将自动切到最近的剩余版本。'}`)) {
      return
    }
    try {
      await api().deleteScriptVersion(projectId, active.id)
    } catch (e) {
      console.error('deleteScriptVersion failed', e)
    }
  }

  /** 用整文切片替换的方式落盘场景级增删改 */
  const saveText = async (newText: string) => {
    if (!projectId) return
    await api().saveProjectScript(projectId, newText)
  }

  const handleEditSave = async (sceneIdx: number, newBody: string) => {
    const scene = result.scenes[sceneIdx]
    if (!scene) return
    const replacement = newBody.endsWith('\n') ? newBody : newBody + '\n'
    await saveText(spliceText(result.script, scene.charStart, scene.charEnd, replacement))
  }

  const handleInsertSave = async (afterIdx: number, newBody: string) => {
    const scene = result.scenes[afterIdx]
    if (!scene) return
    const insertion = (newBody.endsWith('\n') ? newBody : newBody + '\n') + '\n'
    const at = Math.min(scene.charEnd, result.script.length)
    await saveText(result.script.slice(0, at) + insertion + result.script.slice(at))
  }

  const handleDeleteScene = async (sceneIdx: number) => {
    const scene = result.scenes[sceneIdx]
    if (!scene) return
    if (result.scenes.length <= 1) {
      window.alert('至少要保留一个场景。要清空剧本请删除整个版本。')
      return
    }
    if (!window.confirm(`删除场景「${scene.heading}」？此操作会同时更新当前版本文件。`)) return
    await saveText(spliceText(result.script, scene.charStart, scene.charEnd, ''))
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onContextMenu={
        canEdit && (onRegenerate || result.scenes.length > 0)
          ? (e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY })
            }
          : undefined
      }
    >
      {/* 版本栏 */}
      {canEdit && versions && versions.versions.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.05] px-4 py-1.5">
          <History className="h-3 w-3 shrink-0 text-zinc-500" />
          <DropdownSelect
            value={versions.activeId}
            disabled={switching}
            onChange={(id) => void handleSwitchVersion(id)}
            options={[...versions.versions]
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((v) => ({ id: v.id, label: versionLabel(versions, v.id) }))}
            header="剧本版本"
            buttonTitle="切换剧本版本（重新生成会保留旧版本）"
            buttonClassName="max-w-[320px] !py-1 text-[11px]"
          />
          {switching && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
          <button
            onClick={handleDeleteVersion}
            className="btn-ghost !p-1 text-zinc-500 hover:text-red-300"
            title="删除当前版本"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          {onRegenerate && (
            <div className="ml-auto flex items-center gap-1.5">
              {masterSelect}
              <button
                onClick={onRegenerate}
                className="btn-ghost flex items-center gap-1 !px-2 !py-1 text-[11px]"
                title={
                  regenerateProviderLabel
                    ? `用 ${regenerateProviderLabel} 重新生成（存为新版本）`
                    : '重新生成（存为新版本）'
                }
              >
                <Sparkles className="h-3 w-3" />
                重新生成
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-6">
        {result.scenes.length === 0 ? (
          <NoScenesView script={result.script} />
        ) : (
          <div className="space-y-2">
            {result.scenes.map((scene, i) => (
              <SceneCard
                key={i}
                scene={scene}
                index={i}
                isActive={i === activeSceneIdx}
                onClick={() => onSceneClick(scene.startSec)}
                onContextMenu={
                  canEdit
                    ? (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setMenu({ x: e.clientX, y: e.clientY, sceneIdx: i })
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {menu && canEdit && (
        <div
          className="fixed z-50 min-w-[188px] overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/95 py-1 shadow-2xl backdrop-blur-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.sceneIdx != null && result.scenes[menu.sceneIdx] && (
            <>
              <div className="border-b border-white/[0.06] px-3 py-1.5 text-[10px] text-zinc-500">
                {formatHMS(result.scenes[menu.sceneIdx].startSec)} ·{' '}
                {result.scenes[menu.sceneIdx].heading.slice(0, 18)}
              </div>
              <ScriptMenuItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="编辑场景…"
                onClick={() => {
                  setModal({ mode: 'edit', sceneIdx: menu.sceneIdx! })
                  setMenu(null)
                }}
              />
              <ScriptMenuItem
                icon={<Plus className="h-3.5 w-3.5" />}
                label="在此后插入场景…"
                onClick={() => {
                  setModal({ mode: 'insert', afterIdx: menu.sceneIdx! })
                  setMenu(null)
                }}
              />
              <ScriptMenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="删除场景"
                danger
                onClick={() => {
                  const idx = menu.sceneIdx!
                  setMenu(null)
                  void handleDeleteScene(idx)
                }}
              />
              {onRegenerate && <div className="my-1 border-t border-white/[0.06]" />}
            </>
          )}
          {onRegenerate && (
            <ScriptMenuItem
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={
                regenerateProviderLabel ? `重新生成剧本（${regenerateProviderLabel}）` : '重新生成剧本'
              }
              onClick={() => {
                setMenu(null)
                onRegenerate()
              }}
            />
          )}
        </div>
      )}

      {modal?.mode === 'edit' && result.scenes[modal.sceneIdx] && (
        <SceneTextModal
          title={`编辑场景 · ${formatHMS(result.scenes[modal.sceneIdx].startSec)}`}
          initialText={result.scenes[modal.sceneIdx].body}
          onCancel={() => setModal(null)}
          onSave={async (text) => {
            await handleEditSave(modal.sceneIdx, text)
            setModal(null)
          }}
        />
      )}
      {modal?.mode === 'insert' && result.scenes[modal.afterIdx] && (
        <SceneTextModal
          title="插入新场景"
          initialText={insertTemplate(result.scenes, modal.afterIdx)}
          hint="首行需以 [HH:MM:SS] 时间戳开头才能被识别为场景"
          onCancel={() => setModal(null)}
          onSave={async (text) => {
            await handleInsertSave(modal.afterIdx, text)
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

/** 版本下拉的显示文本：v序号 · API · 日期时间 */
function versionLabel(info: ScriptVersionsInfo, versionId: string): string {
  const sorted = [...info.versions].sort((a, b) => a.createdAt - b.createdAt)
  const idx = sorted.findIndex((v) => v.id === versionId)
  const v = sorted[idx]
  if (!v) return versionId
  const time = new Date(v.createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `v${idx + 1} · ${v.providerLabel} · ${time}`
}

/** 插入场景的初始模板：时间戳取所在场景与下一场景的中点（无下一场则 +5s） */
function insertTemplate(scenes: ScriptScene[], afterIdx: number): string {
  const cur = scenes[afterIdx]
  const next = scenes[afterIdx + 1]
  const t = next ? Math.floor((cur.startSec + next.startSec) / 2) : cur.startSec + 5
  return `[${formatHMS(t)}] 新场景标题\n△ 画面：\n`
}

function spliceText(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(Math.min(end, text.length))
}

function ScriptMenuItem({
  icon,
  label,
  onClick,
  danger,
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

/** 弹窗表单：编辑/插入场景的原文文本 */
function SceneTextModal({
  title,
  initialText,
  hint,
  onCancel,
  onSave,
}: {
  title: string
  initialText: string
  hint?: string
  onCancel: () => void
  onSave: (text: string) => Promise<void>
}) {
  const [text, setText] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!text.trim()) {
      setError('内容不能为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(text)
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
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="w-[560px] max-w-[94vw] rounded-xl border border-white/[0.08] bg-ink-950/95 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-100">{title}</div>
          <button onClick={onCancel} className="btn-ghost !p-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {hint && <div className="mb-2 text-[11px] text-zinc-500">{hint}</div>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          autoFocus
          className="input-field w-full resize-y font-script text-[13px] leading-relaxed"
          spellCheck={false}
        />
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

function SceneCard({
  scene,
  index,
  isActive,
  onClick,
  onContextMenu,
}: {
  scene: ScriptScene
  index: number
  isActive: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const lines = scene.body.split('\n')
  const headingLine = lines[0]
  const bodyLines = lines.slice(1).filter((l) => l.trim().length > 0)

  return (
    <motion.div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn('scene-card group px-4 py-3', isActive && 'active')}
      whileHover={{ x: 2 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-baseline gap-3">
        <span className="timecode shrink-0">{formatHMS(scene.startSec)}</span>
        <div className="min-w-0 flex-1">
          <div className="font-script text-[14px] font-medium leading-tight text-zinc-100">
            {stripTimecodePrefix(headingLine)}
          </div>
          {bodyLines.length > 0 && (
            <div className="mt-2 space-y-0.5 font-script text-[12.5px] leading-relaxed text-zinc-400">
              {bodyLines.map((line, i) => (
                <BodyLine key={i} line={line} />
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-zinc-700">
          #{String(index + 1).padStart(2, '0')}
        </span>
      </div>
    </motion.div>
  )
}

function BodyLine({ line }: { line: string }) {
  const trimmed = line.trim()
  if (trimmed.startsWith('△')) {
    return <div className="text-zinc-500">{trimmed}</div>
  }
  if (trimmed.startsWith('人物：')) {
    return <div className="text-zinc-500 text-[11px]">{trimmed}</div>
  }
  if (trimmed.startsWith('【字幕') || trimmed.startsWith('【闪回')) {
    return <div className="text-film-300">{trimmed}</div>
  }
  const dialogueMatch = trimmed.match(/^([^：]+?)([vV][oO]|[oO][sS])?：(.*)$/)
  if (dialogueMatch) {
    const character = dialogueMatch[1]
    const tag = dialogueMatch[2]?.toLowerCase()
    const content = dialogueMatch[3]
    return (
      <div>
        <span className="text-accent">{character}</span>
        {tag && <span className="text-zinc-600 text-[10px]"> ({tag})</span>}
        <span className="text-zinc-600">：</span>
        <span className="text-zinc-200">{content}</span>
      </div>
    )
  }
  return <div>{trimmed}</div>
}

function NoScenesView({ script }: { script: string }) {
  return (
    <div>
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-4 py-2 text-xs text-amber-200">
        ⚠ AI 没有在输出中包含 [HH:MM:SS] 时间戳，无法启用同步播放。已显示原始文本。
      </div>
      <pre className="whitespace-pre-wrap break-words font-script text-[13px] leading-relaxed text-zinc-300">
        {script}
      </pre>
    </div>
  )
}

function stripTimecodePrefix(line: string): string {
  // 与 parse-script 的宽松匹配保持一致：去掉行首各种括号/格式包裹的时间戳
  return line.replace(
    /^[\s>#*\-•　]*[[【(（]?\s*\d{1,2}:\d{1,2}(?::\d{1,2})?\s*[\]】)）]?[\s:：、.]*/,
    ''
  )
}
