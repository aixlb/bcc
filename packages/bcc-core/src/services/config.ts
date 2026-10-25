import { DEFAULT_MODELS } from '@shared/model-presets'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import type { AnthropicConfig, AppConfig, CustomProvider, ResearchConfig, GeminiConfig, KimiConfig, MinimaxConfig, OpenAIConfig, StoryboardConfig } from '@shared/types'
import { getDataRoot } from './paths'

const DEFAULT_CONFIG: AppConfig = {
  gemini: {
    api_key: '',
    model: DEFAULT_MODELS.gemini,
    video_resolution: 'low',
    proxy: '',
  },
  kimi: {
    api_key: '',
    model: DEFAULT_MODELS.kimi,
    base_url: '',
  },
  minimax: {
    api_key: '',
    model: DEFAULT_MODELS.minimax,
    base_url: '',
  },
  openai: {
    api_key: '',
    model: DEFAULT_MODELS.openai,
    base_url: '',
  },
  anthropic: {
    api_key: '',
    model: DEFAULT_MODELS.anthropic,
    base_url: '',
  },
  custom_providers: [],
  script_provider: 'gemini',
  script_master: '',
  storyboard_provider: 'gemini',
  storyboard_master: '',
  storyboard: {
    prompt: '',
    // smart：四检测器混合（硬切/白闪/锋面/叠化），对渐变/一镜到底转场更准
    cut_method: 'smart',
    // scene 方式：每帧差异值判切（0~1）；按时间轴下方曲线微调（放在谷底之上、尖峰之下）
    scene_threshold: 0.3,
    // smart 方式用户参数（其余常量经真值标定内置）
    smart_hard_min: 5.5,
    smart_hard_ratio: 8,
    smart_min_gap: 0.3,
    max_shots: 200,
    concurrency: 3,
  },
  research: {
    video_concurrency: 2,
    synthesis_provider: null,
    mosaic_frames_per_video: 6,
    synthesis_prompt: '',
  },
}

function getConfigPath(): string {
  return path.join(path.dirname(getDataRoot()), 'config.yaml')
}

let cachedConfig: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig

  const configPath = getConfigPath()
  try {
    const raw = await fs.readFile(configPath, 'utf-8')
    const parsed = yaml.load(raw) as Record<string, unknown> | null
    cachedConfig = mergeConfig(parsed)
  } catch (err: any) {
    // 配置读取失败绝不能阻塞启动（否则连窗口都建不出来）。一律退回内存默认值；
    // 首次（ENOENT）尝试落盘，但落盘失败也只记日志、用默认值继续，下次保存设置时再写。
    cachedConfig = deepClone(DEFAULT_CONFIG)
    if (err?.code === 'ENOENT') {
      try {
        await saveConfig(cachedConfig)
      } catch (saveErr) {
        console.error('[config] 初始化默认配置落盘失败，先用内存默认值继续:', saveErr)
      }
    } else {
      console.error('[config] 读取配置失败，改用默认值继续:', err)
    }
  }
  return cachedConfig
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigPath()
  const merged = mergeConfig(config as unknown as Record<string, unknown>)
  const yamlStr = yaml.dump(merged, { indent: 2, lineWidth: 120 })
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, yamlStr, 'utf-8')
  cachedConfig = merged
  applyProxy(merged.gemini)
}

/** 仅供测试：清空已缓存配置，强制下次 loadConfig 重新读盘。 */
export function __resetConfigCache(): void {
  cachedConfig = null
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    throw new Error('Config not loaded yet — call loadConfig() first')
  }
  return cachedConfig
}

export function getConfigFilePath(): string {
  return getConfigPath()
}

export function applyProxy(gemini: GeminiConfig): void {
  const proxy = gemini.proxy?.trim() || ''
  if (proxy) {
    process.env.HTTP_PROXY = proxy
    process.env.HTTPS_PROXY = proxy
    process.env.http_proxy = proxy
    process.env.https_proxy = proxy
  } else {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
  }
}

export const applyProxyEnv = applyProxy

function mergeConfig(partial: Record<string, unknown> | null | undefined): AppConfig {
  const p = (partial ?? {}) as Record<string, unknown>

  const gemini: GeminiConfig = {
    ...DEFAULT_CONFIG.gemini,
    ...(p.gemini as Partial<GeminiConfig> ?? {}),
  }

  const kimi: KimiConfig = {
    ...DEFAULT_CONFIG.kimi,
    ...(p.kimi as Partial<KimiConfig> ?? {}),
  }

  const minimax: MinimaxConfig = {
    ...DEFAULT_CONFIG.minimax,
    ...(p.minimax as Partial<MinimaxConfig> ?? {}),
  }

  const openai: OpenAIConfig = {
    ...DEFAULT_CONFIG.openai,
    ...(p.openai as Partial<OpenAIConfig> ?? {}),
  }

  const anthropic: AnthropicConfig = {
    ...DEFAULT_CONFIG.anthropic,
    ...(p.anthropic as Partial<AnthropicConfig> ?? {}),
  }

  const customProviders: CustomProvider[] = Array.isArray(p.custom_providers)
    ? (p.custom_providers as CustomProvider[])
    : []

  const storyboardRaw = (p.storyboard as Record<string, unknown> | undefined) ?? {}
  const storyboard: StoryboardConfig = {
    prompt: (storyboardRaw.prompt as string) ?? DEFAULT_CONFIG.storyboard.prompt,
    cut_method: storyboardRaw.cut_method === 'scene' ? 'scene' : DEFAULT_CONFIG.storyboard.cut_method,
    scene_threshold:
      typeof storyboardRaw.scene_threshold === 'number'
        ? Math.max(0.01, Math.min(1, storyboardRaw.scene_threshold as number))
        : DEFAULT_CONFIG.storyboard.scene_threshold,
    smart_hard_min:
      typeof storyboardRaw.smart_hard_min === 'number'
        ? Math.max(1, Math.min(50, storyboardRaw.smart_hard_min as number))
        : DEFAULT_CONFIG.storyboard.smart_hard_min,
    smart_hard_ratio:
      typeof storyboardRaw.smart_hard_ratio === 'number'
        ? Math.max(2, Math.min(50, storyboardRaw.smart_hard_ratio as number))
        : DEFAULT_CONFIG.storyboard.smart_hard_ratio,
    smart_min_gap:
      typeof storyboardRaw.smart_min_gap === 'number'
        ? Math.max(0.1, Math.min(10, storyboardRaw.smart_min_gap as number))
        : DEFAULT_CONFIG.storyboard.smart_min_gap,
    max_shots: (storyboardRaw.max_shots as number) ?? DEFAULT_CONFIG.storyboard.max_shots,
    concurrency: (storyboardRaw.concurrency as number) ?? DEFAULT_CONFIG.storyboard.concurrency,
  }

  // 兼容旧配置：0.2.0 前该段叫 distillation，读时回退老键（saveConfig 会以 research 写回）
  const researchRaw = ((p.research ?? p.distillation) as Record<string, unknown> | undefined) ?? {}
  const research: ResearchConfig = {
    video_concurrency:
      typeof researchRaw.video_concurrency === 'number'
        ? Math.max(1, Math.min(4, researchRaw.video_concurrency as number))
        : DEFAULT_CONFIG.research.video_concurrency,
    synthesis_provider:
      (researchRaw.synthesis_provider as string | null) ?? DEFAULT_CONFIG.research.synthesis_provider,
    mosaic_frames_per_video:
      typeof researchRaw.mosaic_frames_per_video === 'number'
        ? Math.max(1, Math.min(12, researchRaw.mosaic_frames_per_video as number))
        : DEFAULT_CONFIG.research.mosaic_frames_per_video,
    synthesis_prompt: (researchRaw.synthesis_prompt as string) ?? DEFAULT_CONFIG.research.synthesis_prompt,
  }

  const script_provider = (p.script_provider as AppConfig['script_provider']) ?? DEFAULT_CONFIG.script_provider
  const script_master = typeof p.script_master === 'string' ? p.script_master : DEFAULT_CONFIG.script_master
  const storyboard_provider = (p.storyboard_provider as string) ?? DEFAULT_CONFIG.storyboard_provider
  const storyboard_master =
    typeof p.storyboard_master === 'string' ? p.storyboard_master : DEFAULT_CONFIG.storyboard_master

  return {
    gemini,
    kimi,
    minimax,
    openai,
    anthropic,
    custom_providers: customProviders,
    script_provider,
    script_master,
    storyboard_provider,
    storyboard_master,
    storyboard,
    research,
  }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}
