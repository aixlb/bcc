import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AppConfig } from '@shared/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 判断某个 provider（gemini / kimi / 自定义供应商 id）是否已配置 API Key。
 * 剧本拆解、分镜拆解、风格研究的按钮应当基于「实际选用的 provider」是否有 key 来禁用，
 * 而不是一律检查 gemini.api_key —— 否则只配了 Kimi / 自定义供应商时会被误判为「未配置」。
 */
export function providerKeyConfigured(config: AppConfig | null | undefined, provider: string | undefined): boolean {
  if (!config) return false
  const p = provider ?? 'gemini'
  if (p === 'gemini') return !!config.gemini.api_key
  if (p === 'kimi') return !!config.kimi.api_key
  if (p === 'minimax') return !!config.minimax?.api_key
  if (p === 'openai') return !!config.openai?.api_key
  if (p === 'anthropic') return !!config.anthropic?.api_key
  const custom = config.custom_providers?.find((c) => c.id === p)
  return !!custom?.api_key
}

/** 某个 provider 的人类可读标签：显示名 + 实际模型，用于在执行前/执行中确认用对了 API。 */
export interface ProviderLabel {
  name: string
  model: string
}

/**
 * 把 provider id（gemini / kimi / 自定义供应商 id）解析成「显示名 + 模型」。
 * 用于在生成按钮旁、任务面板里展示「将使用 Gemini · gemini-3.5-flash」之类的提示，
 * 让用户在执行前就能确认调用的是预期的 API。
 */
export function resolveProviderLabel(
  config: AppConfig | null | undefined,
  provider: string | undefined
): ProviderLabel | null {
  if (!config) return null
  const p = provider ?? 'gemini'
  if (p === 'gemini') return { name: 'Gemini', model: config.gemini.model?.trim() || 'gemini-3.5-flash' }
  if (p === 'kimi') return { name: 'Kimi', model: config.kimi.model?.trim() || 'kimi-k3' }
  if (p === 'minimax') return { name: 'MiniMax', model: config.minimax?.model?.trim() || 'MiniMax-M3' }
  if (p === 'openai') return { name: 'OpenAI', model: config.openai?.model?.trim() || 'gpt-5.6' }
  if (p === 'anthropic') return { name: 'Claude', model: config.anthropic?.model?.trim() || 'claude-fable-5' }
  const custom = config.custom_providers?.find((c) => c.id === p)
  if (custom) return { name: custom.name?.trim() || '自定义供应商', model: custom.model?.trim() || '' }
  return null
}

/** 把 ProviderLabel 拼成一行文本，如 "Gemini · gemini-3.5-flash"。 */
export function formatProviderLabel(label: ProviderLabel | null | undefined): string {
  if (!label) return ''
  return label.model ? `${label.name} · ${label.model}` : label.name
}

export function formatHMS(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatMs(ms: number): string {
  return formatHMS(Math.floor(ms / 1000))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p
}

export function formatTokens(n: number | undefined): string {
  if (n == null || !isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
