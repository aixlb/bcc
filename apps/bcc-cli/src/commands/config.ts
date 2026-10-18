/**
 * bcc config —— API / 模型 / 代理等设置的读写与连接测试。
 *   bcc config list | get [key] | set <key> <value> | path | test [provider]
 * key 用点号路径，如 gemini.api_key / storyboard.scene_threshold / script_provider。
 */
import { parseArgs } from 'node:util'
import type { AppConfig } from '@shared/types'
import {
  getConfigFilePath,
  saveConfig,
  GeminiService,
  KimiService,
  MinimaxService,
  ChatGPTService,
  ClaudeService,
} from '@core/index.js'
import { bootstrap } from '../context.js'
import { UsageError } from '../output.js'

const SECRET_RE = /(api_key|secret|token)$/i

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function getPath(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, k) => (isPlainObject(acc) ? acc[k] : undefined), obj)
}

function setPath(obj: Record<string, unknown>, dotted: string, raw: string): void {
  const keys = dotted.split('.')
  const last = keys.pop()!
  let cur: Record<string, unknown> = obj
  for (const k of keys) {
    if (!isPlainObject(cur[k])) throw new UsageError(`无效配置路径: ${dotted}`)
    cur = cur[k] as Record<string, unknown>
  }
  if (!(last in cur)) throw new UsageError(`未知配置项: ${dotted}`)
  const prev = cur[last]
  // 按既有值类型强转
  if (typeof prev === 'number') {
    const n = Number(raw)
    if (Number.isNaN(n)) throw new UsageError(`${dotted} 需要数字，得到: ${raw}`)
    cur[last] = n
  } else if (typeof prev === 'boolean') {
    cur[last] = raw === 'true' || raw === '1'
  } else if (prev === null || prev === undefined) {
    cur[last] = raw === 'null' || raw === '' ? null : raw
  } else {
    cur[last] = raw
  }
}

function maskSecrets(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && SECRET_RE.test(key) && value) {
    return value.length <= 4 ? '****' : `****${value.slice(-4)}`
  }
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = maskSecrets(v, k)
    return out
  }
  return value
}

export async function runConfig(argv: string[]): Promise<void> {
  const action = argv[0]
  const rest = argv.slice(1)
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { 'data-dir': { type: 'string' }, json: { type: 'boolean' } },
  })

  if (!action || action === 'path') {
    const { config } = await bootstrap({ dataDir: values['data-dir'] })
    if (action === 'path') {
      process.stdout.write(getConfigFilePath() + '\n')
      return
    }
    // 无 action：等同 list
    printConfig(config, !!values.json)
    return
  }

  if (action === 'list' || action === 'get') {
    const { config } = await bootstrap({ dataDir: values['data-dir'] })
    if (action === 'get' && positionals[0]) {
      const v = getPath(config as unknown as Record<string, unknown>, positionals[0])
      if (v === undefined) throw new UsageError(`未知配置项: ${positionals[0]}`)
      const masked = maskSecrets(v, positionals[0].split('.').pop())
      process.stdout.write((typeof masked === 'object' ? JSON.stringify(masked, null, 2) : String(masked)) + '\n')
    } else {
      printConfig(config, !!values.json)
    }
    return
  }

  if (action === 'set') {
    const [key, value] = positionals
    if (!key || value === undefined) throw new UsageError('用法: bcc config set <key> <value>')
    const { config } = await bootstrap({ dataDir: values['data-dir'] })
    setPath(config as unknown as Record<string, unknown>, key, value)
    await saveConfig(config)
    process.stderr.write(`  -> 已更新 ${key}\n`)
    return
  }

  if (action === 'test') {
    const { config } = await bootstrap({ dataDir: values['data-dir'], network: true })
    await testConnections(config, positionals[0])
    return
  }

  throw new UsageError(`未知 config 子命令: ${action}（可用: list | get | set | path | test）`)
}

function printConfig(config: AppConfig, json: boolean): void {
  const masked = maskSecrets(config)
  if (json) {
    process.stdout.write(JSON.stringify(masked, null, 2) + '\n')
  } else {
    process.stdout.write(JSON.stringify(masked, null, 2) + '\n')
  }
}

type TestStatus = 'ok' | 'fail' | 'skip'

interface ProviderCandidate {
  id: string
  label: string
  hasKey: boolean
  custom: boolean
  run: () => Promise<{ ok: boolean; message: string }>
}

/**
 * 无参数：测试**所有已配置 API Key** 的模型（gemini / kimi / minimax + 自定义供应商）。
 * 带参数：只测指定供应商 id。内置三家并发测；自定义供应商暂无连接测试，标 SKIP。
 */
async function testConnections(config: AppConfig, only?: string): Promise<void> {
  const candidates: ProviderCandidate[] = [
    { id: 'gemini', label: `gemini · ${config.gemini.model || '默认'}`, hasKey: !!config.gemini.api_key, custom: false, run: () => new GeminiService(config.gemini).testConnection() },
    { id: 'kimi', label: `kimi · ${config.kimi.model || '默认'}`, hasKey: !!config.kimi.api_key, custom: false, run: () => new KimiService(config.kimi).testConnection() },
    { id: 'minimax', label: `minimax · ${config.minimax.model || '默认'}`, hasKey: !!config.minimax.api_key, custom: false, run: () => new MinimaxService(config.minimax).testConnection() },
    { id: 'openai', label: `openai · ${config.openai?.model || '默认'}`, hasKey: !!config.openai?.api_key, custom: false, run: () => new ChatGPTService(config.openai).testConnection() },
    { id: 'anthropic', label: `anthropic · ${config.anthropic?.model || '默认'}`, hasKey: !!config.anthropic?.api_key, custom: false, run: () => new ClaudeService(config.anthropic).testConnection() },
    ...(config.custom_providers ?? []).map((c) => ({
      id: c.id,
      label: `${c.name} · ${c.model}`,
      hasKey: !!c.api_key,
      custom: true,
      run: async () => ({ ok: false, message: '自定义供应商暂不支持自动连接测试' }),
    })),
  ]

  let targets: ProviderCandidate[]
  if (only) {
    targets = candidates.filter((c) => c.id === only)
    if (targets.length === 0) {
      throw new UsageError(`未知供应商: ${only}（可用: ${candidates.map((c) => c.id).join(', ')}）`)
    }
  } else {
    targets = candidates.filter((c) => c.hasKey)
    if (targets.length === 0) {
      process.stderr.write('没有任何已配置 API Key 的模型；先用 bcc config set <provider>.api_key <key> 配置\n')
      return
    }
    process.stderr.write(`测试 ${targets.length} 个已配置模型...\n`)
  }

  const results = await Promise.all(
    targets.map(async (t): Promise<{ label: string; status: TestStatus; message: string }> => {
      if (!t.hasKey) return { label: t.label, status: 'skip', message: '未配置 API Key' }
      if (t.custom) return { label: t.label, status: 'skip', message: '自定义供应商暂不支持自动连接测试' }
      try {
        const r = await t.run()
        return { label: t.label, status: r.ok ? 'ok' : 'fail', message: r.message }
      } catch (err: any) {
        return { label: t.label, status: 'fail', message: err?.message ?? String(err) }
      }
    })
  )

  const tag: Record<TestStatus, string> = { ok: 'OK  ', fail: 'FAIL', skip: 'SKIP' }
  let anyFail = false
  for (const r of results) {
    if (r.status === 'fail') anyFail = true
    process.stdout.write(`${tag[r.status]} ${r.label}: ${r.message}\n`)
  }
  if (anyFail) process.exitCode = 1
}
