/**
 * 自绘下拉选择，替代原生 <select>：原生弹出列表走系统样式，暗色主题下发白看不清。
 * 面板样式与场景右键菜单一致（bg-ink-950/95 + 细边 + 毛玻璃），点击任意处 / Esc 收起。
 */
import { useEffect, useState } from 'react'
import { Check, ChevronDown, GraduationCap } from 'lucide-react'
import { cn } from '../lib/utils'
import { BUILTIN_MASTERS } from '@shared/masters-meta'

export interface DropdownSelectOption {
  id: string
  label: string
  /** 选项悬停提示 */
  title?: string
}

export function DropdownSelect({
  value,
  options,
  onChange,
  icon,
  header,
  buttonTitle,
  buttonClassName,
  disabled,
  active,
  align = 'left',
}: {
  value: string
  options: DropdownSelectOption[]
  onChange: (id: string) => void
  /** 按钮左侧图标 */
  icon?: React.ReactNode
  /** 面板顶部说明行 */
  header?: string
  buttonTitle?: string
  buttonClassName?: string
  disabled?: boolean
  /** 按钮文字高亮（如已选非默认项） */
  active?: boolean
  /** 面板与按钮的对齐边 */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)

  // 与场景右键菜单同款关闭逻辑：点击任意处 / Esc 收起
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.id === value) ?? options[0]

  return (
    <div className="relative min-w-0">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={disabled}
        title={buttonTitle}
        className={cn(
          'btn-ghost flex items-center gap-1 text-xs !px-2 !py-1.5 disabled:opacity-50',
          buttonClassName
        )}
      >
        {icon}
        <span className={cn('min-w-0 truncate', active && 'text-accent')}>{current?.label ?? ''}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-full z-50 mt-1 max-h-64 min-w-[176px] overflow-y-auto rounded-lg border border-white/[0.08] bg-ink-950/95 py-1 shadow-2xl backdrop-blur-md',
            align === 'right' ? 'right-0' : 'left-0'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {header && (
            <div className="border-b border-white/[0.06] px-3 py-1.5 text-[10px] text-zinc-500">
              {header}
            </div>
          )}
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setOpen(false)
                if (o.id !== value) onChange(o.id)
              }}
              title={o.title}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                o.id === value
                  ? 'bg-accent/[0.06] text-accent'
                  : 'text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100'
              )}
            >
              <Check
                className={cn('h-3.5 w-3.5 shrink-0', o.id === value ? 'text-accent' : 'opacity-0')}
              />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 「大师」选择下拉：默认 + 内置大师（山之音…）。
 * kind 只决定文案——剧本页选剧本大师、切割工作台选分镜大师，两者独立生效。
 */
export function MasterSelect({
  value,
  onChange,
  kind,
  align = 'right',
}: {
  value: string
  onChange: (id: string) => void
  kind: 'script' | 'storyboard'
  align?: 'left' | 'right'
}) {
  const noun = kind === 'script' ? '剧本' : '分镜'
  return (
    <DropdownSelect
      value={value}
      onChange={onChange}
      options={[
        { id: '', label: '默认', title: `标准${noun}分析` },
        ...BUILTIN_MASTERS.map((m) => ({ id: m.id, label: m.name, title: m.description })),
      ]}
      icon={<GraduationCap className={cn('h-3.5 w-3.5', value && 'text-accent')} />}
      header={`${noun}大师 · 本次生成`}
      buttonTitle={`${noun}大师：生成${noun}时注入该大师的创作方法论。此处为本项目的临时选择，默认跟随设置`}
      active={!!value}
      align={align}
    />
  )
}
