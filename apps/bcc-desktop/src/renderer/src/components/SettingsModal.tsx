import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye,
  EyeOff,
  Key,
  Cpu,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Clapperboard,
  X,
  FileText,
  Plus,
  Trash2,
  Pencil,
  Settings2,
  Info,
  GraduationCap,
  Github,
  BookHeart,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { LogoIcon } from './LogoIcon'
import type { AppConfig, CustomProvider } from '@shared/types'
import { STORYBOARD_DEFAULT_ANALYSIS_PROMPT } from '@shared/defaults'
import { BUILTIN_MASTERS } from '@shared/masters-meta'
import { BUILTIN_MODEL_PRESETS, PROVIDER_TEMPLATES, type ModelPresetMap, type ProviderTemplate } from '@shared/model-presets'


type Tab = 'api' | 'feature' | 'masters' | 'about'

interface ProviderFormState {
  id: string | null
  name: string
  api_key: string
  base_url: string
  model: string
  script_input: 'video' | 'frames'
}

export function SettingsModal() {
  const { config, settingsOpen, dispatch } = useStore()
  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [tab, setTab] = useState<Tab>('api')
  const [showKey, setShowKey] = useState<'gemini' | 'kimi' | 'minimax' | 'openai' | 'anthropic' | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [testingGemini, setTestingGemini] = useState(false)
  const [testingKimi, setTestingKimi] = useState(false)
  const [testingMinimax, setTestingMinimax] = useState(false)
  const [testingOpenai, setTestingOpenai] = useState(false)
  const [testingAnthropic, setTestingAnthropic] = useState(false)
  const [geminiTestResult, setGeminiTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [kimiTestResult, setKimiTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [minimaxTestResult, setMinimaxTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [openaiTestResult, setOpenaiTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [anthropicTestResult, setAnthropicTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [customGeminiModel, setCustomGeminiModel] = useState(false)
  const [customKimiModel, setCustomKimiModel] = useState(false)
  const [customMinimaxModel, setCustomMinimaxModel] = useState(false)
  const [customOpenaiModel, setCustomOpenaiModel] = useState(false)
  const [customAnthropicModel, setCustomAnthropicModel] = useState(false)
  // 内置默认 + 数据目录 models.json 合并后的下拉预设；设置页每次打开都重读（免重启即可生效）
  const [modelPresets, setModelPresets] = useState<ModelPresetMap>(BUILTIN_MODEL_PRESETS)

  const [providerForm, setProviderForm] = useState<ProviderFormState | null>(null)
  const [showProviderKey, setShowProviderKey] = useState(false)
  const [testingCustomId, setTestingCustomId] = useState<string | null>(null)
  const [customTestResult, setCustomTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null)

  // 设置页打开时重读模型预设（拾取用户手动改过的 models.json，无需重启）
  useEffect(() => {
    if (!settingsOpen) return
    api().getModelPresets().then(setModelPresets).catch(() => setModelPresets(BUILTIN_MODEL_PRESETS))
  }, [settingsOpen])

  useEffect(() => {
    if (config) {
      setDraft(JSON.parse(JSON.stringify(config)))
    }
    if (settingsOpen) {
      setGeminiTestResult(null)
      setKimiTestResult(null)
      setMinimaxTestResult(null)
      setOpenaiTestResult(null)
      setAnthropicTestResult(null)
      setProviderForm(null)
      setCustomTestResult(null)
    }
  }, [config, settingsOpen])

  // 「自定义模型」开关单独跟 presets 重算：presets 从 models.json 异步返回，
  // 不能挂在上面的 effect 里 —— 否则 presets 到达时会重置 draft，覆盖用户刚输入的内容
  useEffect(() => {
    if (!config) return
    setCustomGeminiModel(!modelPresets.gemini.some((m) => m.value === config.gemini.model))
    setCustomKimiModel(!modelPresets.kimi.some((m) => m.value === config.kimi.model))
    setCustomMinimaxModel(!modelPresets.minimax.some((m) => m.value === config.minimax?.model))
    setCustomOpenaiModel(!modelPresets.openai.some((m) => m.value === config.openai?.model))
    setCustomAnthropicModel(!modelPresets.anthropic.some((m) => m.value === config.anthropic?.model))
  }, [config, modelPresets])

  const close = () => dispatch({ type: 'CLOSE_SETTINGS' })

  const updateGemini = (key: keyof AppConfig['gemini'], value: string) => {
    if (!draft) return
    setDraft({ ...draft, gemini: { ...draft.gemini, [key]: value } })
    setSavedAt(null)
    setGeminiTestResult(null)
  }

  const updateKimi = (key: keyof AppConfig['kimi'], value: string) => {
    if (!draft) return
    setDraft({ ...draft, kimi: { ...draft.kimi, [key]: value } })
    setSavedAt(null)
    setKimiTestResult(null)
  }

  const updateMinimax = (key: keyof AppConfig['minimax'], value: string) => {
    if (!draft) return
    setDraft({ ...draft, minimax: { ...draft.minimax, [key]: value } })
    setSavedAt(null)
    setMinimaxTestResult(null)
  }

  const updateOpenai = (key: keyof AppConfig['openai'], value: string) => {
    if (!draft) return
    setDraft({ ...draft, openai: { ...draft.openai, [key]: value } })
    setSavedAt(null)
    setOpenaiTestResult(null)
  }

  const updateAnthropic = (key: keyof AppConfig['anthropic'], value: string) => {
    if (!draft) return
    setDraft({ ...draft, anthropic: { ...draft.anthropic, [key]: value } })
    setSavedAt(null)
    setAnthropicTestResult(null)
  }

  const setStoryboard = (patch: Partial<AppConfig['storyboard']>) => {
    if (!draft) return
    setDraft({ ...draft, storyboard: { ...draft.storyboard, ...patch } })
    setSavedAt(null)
  }

  // 自定义供应商
  const openNewProviderForm = (template?: ProviderTemplate) => {
    setProviderForm({ id: null, name: template?.name ?? '', api_key: '', base_url: template?.base_url ?? '', model: template?.model ?? '', script_input: template?.script_input ?? 'video' })
    setShowProviderKey(false)
    setCustomTestResult(null)
  }

  const openEditProviderForm = (p: CustomProvider) => {
    setProviderForm({ id: p.id, name: p.name, api_key: p.api_key, base_url: p.base_url, model: p.model, script_input: p.script_input ?? 'video' })
    setShowProviderKey(false)
    setCustomTestResult(null)
  }

  const saveProviderForm = () => {
    if (!draft || !providerForm || !providerForm.name.trim()) return
    const { id, name, api_key, base_url, model, script_input } = providerForm
    if (id === null) {
      const newId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36)
      setDraft({ ...draft, custom_providers: [...draft.custom_providers, { id: newId, name: name.trim(), api_key, base_url, model, script_input }] })
    } else {
      setDraft({
        ...draft,
        custom_providers: draft.custom_providers.map((p) => p.id === id ? { id, name: name.trim(), api_key, base_url, model, script_input } : p),
      })
    }
    setProviderForm(null)
    setSavedAt(null)
  }

  const deleteProvider = (id: string) => {
    if (!draft) return
    setDraft({
      ...draft,
      custom_providers: draft.custom_providers.filter((p) => p.id !== id),
      script_provider: draft.script_provider === id ? 'gemini' : draft.script_provider,
      storyboard_provider: draft.storyboard_provider === id ? 'gemini' : draft.storyboard_provider,
      research: {
        ...draft.research,
        synthesis_provider: draft.research.synthesis_provider === id ? null : draft.research.synthesis_provider,
      },
    })
    setSavedAt(null)
    if (customTestResult?.id === id) setCustomTestResult(null)
  }

  const testCustomProvider = async (p: CustomProvider) => {
    setTestingCustomId(p.id)
    setCustomTestResult(null)
    try {
      const result = await api().testCustomProviderConnection(p)
      setCustomTestResult({ id: p.id, ok: result.ok, message: result.message })
    } catch (e: any) {
      setCustomTestResult({ id: p.id, ok: false, message: e?.message ?? String(e) })
    } finally {
      setTestingCustomId(null)
    }
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    try {
      await api().setConfig(draft)
      dispatch({ type: 'SET_CONFIG', config: draft })
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 3000)
    } catch (e: any) {
      setGeminiTestResult({ ok: false, message: '保存失败: ' + (e?.message ?? String(e)) })
    } finally {
      setSaving(false)
    }
  }

  const handleTestGemini = async () => {
    if (!draft) return
    setTestingGemini(true)
    setGeminiTestResult(null)
    try {
      setGeminiTestResult(await api().testConnection(draft))
    } catch (e: any) {
      setGeminiTestResult({ ok: false, message: e?.message ?? String(e) })
    } finally {
      setTestingGemini(false)
    }
  }

  const handleTestKimi = async () => {
    if (!draft) return
    setTestingKimi(true)
    setKimiTestResult(null)
    try {
      setKimiTestResult(await api().testKimiConnection(draft.kimi))
    } catch (e: any) {
      setKimiTestResult({ ok: false, message: e?.message ?? String(e) })
    } finally {
      setTestingKimi(false)
    }
  }

  const handleTestMinimax = async () => {
    if (!draft) return
    setTestingMinimax(true)
    setMinimaxTestResult(null)
    try {
      setMinimaxTestResult(await api().testMinimaxConnection(draft.minimax))
    } catch (e: any) {
      setMinimaxTestResult({ ok: false, message: e?.message ?? String(e) })
    } finally {
      setTestingMinimax(false)
    }
  }

  const handleTestOpenai = async () => {
    if (!draft) return
    setTestingOpenai(true)
    setOpenaiTestResult(null)
    try {
      setOpenaiTestResult(await api().testOpenAIConnection(draft.openai))
    } catch (e: any) {
      setOpenaiTestResult({ ok: false, message: e?.message ?? String(e) })
    } finally {
      setTestingOpenai(false)
    }
  }

  const handleTestAnthropic = async () => {
    if (!draft) return
    setTestingAnthropic(true)
    setAnthropicTestResult(null)
    try {
      setAnthropicTestResult(await api().testAnthropicConnection(draft.anthropic))
    } catch (e: any) {
      setAnthropicTestResult({ ok: false, message: e?.message ?? String(e) })
    } finally {
      setTestingAnthropic(false)
    }
  }

  return (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-[min(720px,90vh)] w-[min(720px,92vw)] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-950/95 shadow-2xl"
          >
            {/* 标题栏 */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-6 py-3">
              <div>
                <h2 className="text-xl font-light tracking-tight text-zinc-100">
                  <span className="font-medium">设置</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-zinc-500">配置 API 与功能参数</p>
              </div>
              <button onClick={close} className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 主体：左侧边栏 + 右侧内容 */}
            <div className="flex min-h-0 flex-1">
              {/* 侧边栏 */}
              <div className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-white/[0.05] p-2">
                <SidebarItem
                  icon={<Key className="h-4 w-4" />}
                  label="API 配置"
                  active={tab === 'api'}
                  onClick={() => setTab('api')}
                />
                <SidebarItem
                  icon={<Settings2 className="h-4 w-4" />}
                  label="功能配置"
                  active={tab === 'feature'}
                  onClick={() => setTab('feature')}
                />
                <div className="flex-1" />
                <SidebarItem
                  icon={<GraduationCap className="h-4 w-4" />}
                  label="编剧大师"
                  active={tab === 'masters'}
                  onClick={() => setTab('masters')}
                />
                <SidebarItem
                  icon={<Info className="h-4 w-4" />}
                  label="关于"
                  active={tab === 'about'}
                  onClick={() => setTab('about')}
                />
              </div>

              {/* 内容区 */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {tab === 'about' ? (
                  <AboutContent />
                ) : tab === 'masters' ? (
                  <MastersTab />
                ) : !draft ? (
                  <div className="flex h-full items-center justify-center text-zinc-500">加载中...</div>
                ) : tab === 'api' ? (
                  <ApiTab
                    draft={draft!}
                    modelPresets={modelPresets}
                    showKey={showKey}
                    setShowKey={setShowKey}
                    customGeminiModel={customGeminiModel}
                    setCustomGeminiModel={setCustomGeminiModel}
                    customKimiModel={customKimiModel}
                    setCustomKimiModel={setCustomKimiModel}
                    customMinimaxModel={customMinimaxModel}
                    setCustomMinimaxModel={setCustomMinimaxModel}
                    customOpenaiModel={customOpenaiModel}
                    setCustomOpenaiModel={setCustomOpenaiModel}
                    customAnthropicModel={customAnthropicModel}
                    setCustomAnthropicModel={setCustomAnthropicModel}
                    testingGemini={testingGemini}
                    testingKimi={testingKimi}
                    testingMinimax={testingMinimax}
                    testingOpenai={testingOpenai}
                    testingAnthropic={testingAnthropic}
                    geminiTestResult={geminiTestResult}
                    kimiTestResult={kimiTestResult}
                    minimaxTestResult={minimaxTestResult}
                    openaiTestResult={openaiTestResult}
                    anthropicTestResult={anthropicTestResult}
                    onTestGemini={handleTestGemini}
                    onTestKimi={handleTestKimi}
                    onTestMinimax={handleTestMinimax}
                    onTestOpenai={handleTestOpenai}
                    onTestAnthropic={handleTestAnthropic}
                    onUpdateGemini={updateGemini}
                    onUpdateKimi={updateKimi}
                    onUpdateMinimax={updateMinimax}
                    onUpdateOpenai={updateOpenai}
                    onUpdateAnthropic={updateAnthropic}
                    providerForm={providerForm}
                    showProviderKey={showProviderKey}
                    setShowProviderKey={setShowProviderKey}
                    testingCustomId={testingCustomId}
                    customTestResult={customTestResult}
                    onProviderFormChange={setProviderForm}
                    onOpenNewProviderForm={openNewProviderForm}
                    onOpenEditProviderForm={openEditProviderForm}
                    onSaveProviderForm={saveProviderForm}
                    onCancelProviderForm={() => setProviderForm(null)}
                    onDeleteProvider={deleteProvider}
                    onTestCustomProvider={testCustomProvider}
                  />
                ) : (
                  <FeatureTab
                    draft={draft!}
                    onScriptProvider={(v) => {
                      setDraft({ ...draft!, script_provider: v })
                      setSavedAt(null)
                    }}
                    onScriptMaster={(v) => {
                      setDraft({ ...draft!, script_master: v })
                      setSavedAt(null)
                    }}
                    onStoryboardProvider={(v) => {
                      setDraft({ ...draft!, storyboard_provider: v })
                      setSavedAt(null)
                    }}
                    onStoryboardMaster={(v) => {
                      setDraft({ ...draft!, storyboard_master: v })
                      setSavedAt(null)
                    }}
                    onStoryboard={setStoryboard}
                  />
                )}
              </div>
            </div>

            {/* 底部按钮（编剧大师/关于为纯展示页，无可保存内容） */}
            {tab !== 'about' && tab !== 'masters' && (
              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-white/[0.05] bg-ink-950/80 px-6 py-3 backdrop-blur-md">
                <button
                  onClick={handleSave}
                  disabled={saving || !draft}
                  className="btn-primary flex items-center gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : savedAt ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {savedAt ? '已保存' : '保存'}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ---------- API 配置 Tab ----------

function ApiTab({
  draft,
  modelPresets,
  showKey,
  setShowKey,
  customGeminiModel,
  setCustomGeminiModel,
  customKimiModel,
  setCustomKimiModel,
  customMinimaxModel,
  setCustomMinimaxModel,
  customOpenaiModel,
  setCustomOpenaiModel,
  customAnthropicModel,
  setCustomAnthropicModel,
  testingGemini,
  testingKimi,
  testingMinimax,
  testingOpenai,
  testingAnthropic,
  geminiTestResult,
  kimiTestResult,
  minimaxTestResult,
  openaiTestResult,
  anthropicTestResult,
  onTestGemini,
  onTestKimi,
  onTestMinimax,
  onTestOpenai,
  onTestAnthropic,
  onUpdateGemini,
  onUpdateKimi,
  onUpdateMinimax,
  onUpdateOpenai,
  onUpdateAnthropic,
  providerForm,
  showProviderKey,
  setShowProviderKey,
  testingCustomId,
  customTestResult,
  onProviderFormChange,
  onOpenNewProviderForm,
  onOpenEditProviderForm,
  onSaveProviderForm,
  onCancelProviderForm,
  onDeleteProvider,
  onTestCustomProvider,
}: {
  draft: AppConfig
  modelPresets: ModelPresetMap
  showKey: 'gemini' | 'kimi' | 'minimax' | 'openai' | 'anthropic' | null
  setShowKey: (v: 'gemini' | 'kimi' | 'minimax' | 'openai' | 'anthropic' | null) => void
  customGeminiModel: boolean
  setCustomGeminiModel: (v: boolean) => void
  customKimiModel: boolean
  setCustomKimiModel: (v: boolean) => void
  customMinimaxModel: boolean
  setCustomMinimaxModel: (v: boolean) => void
  customOpenaiModel: boolean
  setCustomOpenaiModel: (v: boolean) => void
  customAnthropicModel: boolean
  setCustomAnthropicModel: (v: boolean) => void
  testingGemini: boolean
  testingKimi: boolean
  testingMinimax: boolean
  testingOpenai: boolean
  testingAnthropic: boolean
  geminiTestResult: { ok: boolean; message: string } | null
  kimiTestResult: { ok: boolean; message: string } | null
  minimaxTestResult: { ok: boolean; message: string } | null
  openaiTestResult: { ok: boolean; message: string } | null
  anthropicTestResult: { ok: boolean; message: string } | null
  onTestGemini: () => void
  onTestKimi: () => void
  onTestMinimax: () => void
  onTestOpenai: () => void
  onTestAnthropic: () => void
  onUpdateGemini: (key: keyof AppConfig['gemini'], value: string) => void
  onUpdateKimi: (key: keyof AppConfig['kimi'], value: string) => void
  onUpdateMinimax: (key: keyof AppConfig['minimax'], value: string) => void
  onUpdateOpenai: (key: keyof AppConfig['openai'], value: string) => void
  onUpdateAnthropic: (key: keyof AppConfig['anthropic'], value: string) => void
  providerForm: ProviderFormState | null
  showProviderKey: boolean
  setShowProviderKey: (v: boolean) => void
  testingCustomId: string | null
  customTestResult: { id: string; ok: boolean; message: string } | null
  onProviderFormChange: (f: ProviderFormState) => void
  onOpenNewProviderForm: (template?: ProviderTemplate) => void
  onOpenEditProviderForm: (p: CustomProvider) => void
  onSaveProviderForm: () => void
  onCancelProviderForm: () => void
  onDeleteProvider: (id: string) => void
  onTestCustomProvider: (p: CustomProvider) => void
}) {
  return (
    <div className="space-y-5">
      {/* Gemini */}
      <Section title="Gemini" icon={<Key className="h-4 w-4" />}>
        <Field label="API Key" hint="aistudio.google.com/apikey">
          <div className="relative">
            <input
              type={showKey === 'gemini' ? 'text' : 'password'}
              value={draft.gemini.api_key}
              onChange={(e) => onUpdateGemini('api_key', e.target.value)}
              placeholder="AIzaSy..."
              className="input-field pr-10 font-mono"
              spellCheck={false}
            />
            <button
              onClick={() => setShowKey(showKey === 'gemini' ? null : 'gemini')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:text-zinc-200"
              type="button" tabIndex={-1}
            >
              {showKey === 'gemini' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <Field label="模型">
          <div className="space-y-2">
            {!customGeminiModel && modelPresets.gemini.map((m) => (
              <ModelRadio
                key={m.value}
                checked={draft.gemini.model === m.value}
                label={m.label}
                desc={m.desc}
                value={m.value}
                onChange={() => onUpdateGemini('model', m.value)}
              />
            ))}
            <button onClick={() => setCustomGeminiModel(!customGeminiModel)} className="text-xs text-zinc-500 hover:text-zinc-200" type="button">
              {customGeminiModel ? '↑ 选择预设' : '+ 自定义模型名'}
            </button>
            {customGeminiModel && (
              <input type="text" value={draft.gemini.model} onChange={(e) => onUpdateGemini('model', e.target.value)} placeholder="gemini-..." className="input-field font-mono" />
            )}
          </div>
        </Field>

        <Field label="处理分辨率" hint="高分辨率细节更好但消耗 token 多">
          <div className="grid grid-cols-2 gap-2">
            <ResolutionCard active={draft.gemini.video_resolution === 'low'} onClick={() => onUpdateGemini('video_resolution', 'low')} label="低分辨率" desc="省 token · 适合长视频" badge="推荐" />
            <ResolutionCard active={draft.gemini.video_resolution === 'high'} onClick={() => onUpdateGemini('video_resolution', 'high')} label="高分辨率" desc="细节清晰 · 短视频" />
          </div>
        </Field>

        <Field label="代理 (HTTP/HTTPS)" hint="留空跟随系统代理">
          <input
            type="text"
            value={draft.gemini.proxy}
            onChange={(e) => onUpdateGemini('proxy', e.target.value)}
            placeholder="留空跟随系统代理"
            className="input-field font-mono"
            spellCheck={false}
          />
        </Field>

        <div className="flex items-center gap-3">
          <button onClick={onTestGemini} disabled={testingGemini || !draft.gemini.api_key} className="btn-ghost flex items-center gap-1.5">
            {testingGemini ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            测试连接
          </button>
          <TestResult result={geminiTestResult} />
        </div>
      </Section>

      {/* Kimi */}
      <Section title="Kimi" icon={<Key className="h-4 w-4" />}>
        <Field label="API Key" hint="platform.kimi.com">
          <div className="relative">
            <input
              type={showKey === 'kimi' ? 'text' : 'password'}
              value={draft.kimi.api_key}
              onChange={(e) => onUpdateKimi('api_key', e.target.value)}
              placeholder="sk-..."
              className="input-field pr-10 font-mono"
              spellCheck={false}
            />
            <button
              onClick={() => setShowKey(showKey === 'kimi' ? null : 'kimi')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:text-zinc-200"
              type="button" tabIndex={-1}
            >
              {showKey === 'kimi' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <Field label="模型">
          <div className="space-y-2">
            {!customKimiModel && modelPresets.kimi.map((m) => (
              <ModelRadio key={m.value} checked={draft.kimi.model === m.value} label={m.label} desc={m.desc} value={m.value} onChange={() => onUpdateKimi('model', m.value)} />
            ))}
            <button onClick={() => setCustomKimiModel(!customKimiModel)} className="text-xs text-zinc-500 hover:text-zinc-200" type="button">
              {customKimiModel ? '↑ 选择预设' : '+ 自定义模型名'}
            </button>
            {customKimiModel && (
              <input type="text" value={draft.kimi.model} onChange={(e) => onUpdateKimi('model', e.target.value)} placeholder="kimi-..." className="input-field font-mono" />
            )}
          </div>
        </Field>

        <div className="flex items-center gap-3">
          <button onClick={onTestKimi} disabled={testingKimi || !draft.kimi.api_key} className="btn-ghost flex items-center gap-1.5">
            {testingKimi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            测试连接
          </button>
          <TestResult result={kimiTestResult} />
        </div>
      </Section>

      {/* MiniMax */}
      <Section title="MiniMax" icon={<Key className="h-4 w-4" />}>
        <Field label="API Key" hint="platform.minimaxi.com">
          <div className="relative">
            <input
              type={showKey === 'minimax' ? 'text' : 'password'}
              value={draft.minimax.api_key}
              onChange={(e) => onUpdateMinimax('api_key', e.target.value)}
              placeholder="sk-..."
              className="input-field pr-10 font-mono"
              spellCheck={false}
            />
            <button
              onClick={() => setShowKey(showKey === 'minimax' ? null : 'minimax')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:text-zinc-200"
              type="button" tabIndex={-1}
            >
              {showKey === 'minimax' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <Field label="模型">
          <div className="space-y-2">
            {!customMinimaxModel && modelPresets.minimax.map((m) => (
              <ModelRadio key={m.value} checked={draft.minimax.model === m.value} label={m.label} desc={m.desc} value={m.value} onChange={() => onUpdateMinimax('model', m.value)} />
            ))}
            <button onClick={() => setCustomMinimaxModel(!customMinimaxModel)} className="text-xs text-zinc-500 hover:text-zinc-200" type="button">
              {customMinimaxModel ? '↑ 选择预设' : '+ 自定义模型名'}
            </button>
            {customMinimaxModel && (
              <input type="text" value={draft.minimax.model} onChange={(e) => onUpdateMinimax('model', e.target.value)} placeholder="MiniMax-..." className="input-field font-mono" />
            )}
          </div>
        </Field>

        <div className="flex items-center gap-3">
          <button onClick={onTestMinimax} disabled={testingMinimax || !draft.minimax.api_key} className="btn-ghost flex items-center gap-1.5">
            {testingMinimax ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            测试连接
          </button>
          <TestResult result={minimaxTestResult} />
        </div>
      </Section>

      {/* OpenAI (ChatGPT) */}
      <Section title="OpenAI (ChatGPT)" icon={<Key className="h-4 w-4" />}>
        <p className="text-[11px] text-zinc-500">
          官方 GPT API。剧本走关键帧多图分析（官方接口不收视频，无音频理解，台词以画面字幕为准）。
        </p>
        <Field label="API Key" hint="platform.openai.com/api-keys">
          <div className="relative">
            <input
              type={showKey === 'openai' ? 'text' : 'password'}
              value={draft.openai.api_key}
              onChange={(e) => onUpdateOpenai('api_key', e.target.value)}
              placeholder="sk-..."
              className="input-field pr-10 font-mono"
              spellCheck={false}
            />
            <button
              onClick={() => setShowKey(showKey === 'openai' ? null : 'openai')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:text-zinc-200"
              type="button" tabIndex={-1}
            >
              {showKey === 'openai' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <Field label="模型">
          <div className="space-y-2">
            {!customOpenaiModel && modelPresets.openai.map((m) => (
              <ModelRadio key={m.value} checked={draft.openai.model === m.value} label={m.label} desc={m.desc} value={m.value} onChange={() => onUpdateOpenai('model', m.value)} />
            ))}
            <button onClick={() => setCustomOpenaiModel(!customOpenaiModel)} className="text-xs text-zinc-500 hover:text-zinc-200" type="button">
              {customOpenaiModel ? '↑ 选择预设' : '+ 自定义模型名'}
            </button>
            {customOpenaiModel && (
              <input type="text" value={draft.openai.model} onChange={(e) => onUpdateOpenai('model', e.target.value)} placeholder="gpt-..." className="input-field font-mono" />
            )}
          </div>
        </Field>

        <div className="flex items-center gap-3">
          <button onClick={onTestOpenai} disabled={testingOpenai || !draft.openai.api_key} className="btn-ghost flex items-center gap-1.5">
            {testingOpenai ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            测试连接
          </button>
          <TestResult result={openaiTestResult} />
        </div>
      </Section>

      {/* Anthropic (Claude) */}
      <Section title="Anthropic (Claude)" icon={<Key className="h-4 w-4" />}>
        <p className="text-[11px] text-zinc-500">
          官方 Claude API。剧本走关键帧多图分析（官方接口不收视频，无音频理解，台词以画面字幕为准）；
          Fable 5 遇安全拒答会自动切 Opus 4.8 续答。
        </p>
        <Field label="API Key" hint="platform.claude.com">
          <div className="relative">
            <input
              type={showKey === 'anthropic' ? 'text' : 'password'}
              value={draft.anthropic.api_key}
              onChange={(e) => onUpdateAnthropic('api_key', e.target.value)}
              placeholder="sk-ant-..."
              className="input-field pr-10 font-mono"
              spellCheck={false}
            />
            <button
              onClick={() => setShowKey(showKey === 'anthropic' ? null : 'anthropic')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:text-zinc-200"
              type="button" tabIndex={-1}
            >
              {showKey === 'anthropic' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <Field label="模型">
          <div className="space-y-2">
            {!customAnthropicModel && modelPresets.anthropic.map((m) => (
              <ModelRadio key={m.value} checked={draft.anthropic.model === m.value} label={m.label} desc={m.desc} value={m.value} onChange={() => onUpdateAnthropic('model', m.value)} />
            ))}
            <button onClick={() => setCustomAnthropicModel(!customAnthropicModel)} className="text-xs text-zinc-500 hover:text-zinc-200" type="button">
              {customAnthropicModel ? '↑ 选择预设' : '+ 自定义模型名'}
            </button>
            {customAnthropicModel && (
              <input type="text" value={draft.anthropic.model} onChange={(e) => onUpdateAnthropic('model', e.target.value)} placeholder="claude-..." className="input-field font-mono" />
            )}
          </div>
        </Field>

        <div className="flex items-center gap-3">
          <button onClick={onTestAnthropic} disabled={testingAnthropic || !draft.anthropic.api_key} className="btn-ghost flex items-center gap-1.5">
            {testingAnthropic ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            测试连接
          </button>
          <TestResult result={anthropicTestResult} />
        </div>
      </Section>

      {/* 自定义供应商 */}
      <Section title="自定义供应商" icon={<Cpu className="h-4 w-4" />}>
        <p className="text-[11px] text-zinc-500">
          支持 OpenAI 兼容接口，可用于剧本、分镜和风格研究。DeepSeek 等仅支持图像输入的模型，请选择「关键帧图片」。
        </p>
        <div className="space-y-2">
          {draft.custom_providers.map((p) =>
            providerForm?.id === p.id ? (
              <ProviderFormCard
                key={p.id}
                form={providerForm}
                showKey={showProviderKey}
                onToggleKey={() => setShowProviderKey(!showProviderKey)}
                onChange={onProviderFormChange}
                onSave={onSaveProviderForm}
                onCancel={onCancelProviderForm}
              />
            ) : (
              <ProviderViewCard
                key={p.id}
                provider={p}
                testing={testingCustomId === p.id}
                testResult={customTestResult?.id === p.id ? customTestResult : null}
                onEdit={() => onOpenEditProviderForm(p)}
                onDelete={() => onDeleteProvider(p.id)}
                onTest={() => onTestCustomProvider(p)}
              />
            )
          )}
          {providerForm?.id === null && (
            <ProviderFormCard
              form={providerForm}
              showKey={showProviderKey}
              onToggleKey={() => setShowProviderKey(!showProviderKey)}
              onChange={onProviderFormChange}
              onSave={onSaveProviderForm}
              onCancel={onCancelProviderForm}
            />
          )}
          {!providerForm && PROVIDER_TEMPLATES.map((template) => (
            <button key={template.id} onClick={() => onOpenNewProviderForm(template)} className="flex items-center gap-1 text-xs text-accent hover:text-zinc-200" type="button">
              <Plus className="h-3.5 w-3.5" />
              添加 {template.name}
            </button>
          ))}
          {!providerForm && (
            <button onClick={() => onOpenNewProviderForm()} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200" type="button">
              <Plus className="h-3.5 w-3.5" />
              添加供应商
            </button>
          )}
        </div>
      </Section>
    </div>
  )
}

// ---------- 功能配置 Tab ----------

function FeatureTab({
  draft,
  onScriptProvider,
  onScriptMaster,
  onStoryboardProvider,
  onStoryboardMaster,
  onStoryboard,
}: {
  draft: AppConfig
  onScriptProvider: (v: string) => void
  onScriptMaster: (v: string) => void
  onStoryboardProvider: (v: string) => void
  onStoryboardMaster: (v: string) => void
  onStoryboard: (patch: Partial<AppConfig['storyboard']>) => void
}) {
  const masterOptions = (noun: string) => [
    { id: 'default', label: '默认', desc: `标准${noun}分析` },
    ...BUILTIN_MASTERS.map((m) => ({ id: m.id, label: m.name, desc: m.description })),
  ]
  const scriptProviderOptions = [
    { id: 'gemini', label: 'Gemini', desc: '直接上传视频，支持音频理解' },
    { id: 'kimi', label: 'Kimi', desc: '提取关键帧多图分析' },
    { id: 'minimax', label: 'MiniMax-M3', desc: '上传视频理解，推理较慢但便宜' },
    { id: 'openai', label: 'OpenAI (ChatGPT)', desc: '关键帧多图分析，无音频理解' },
    { id: 'anthropic', label: 'Anthropic (Claude)', desc: '关键帧多图分析，推理最强，无音频理解' },
    ...draft.custom_providers.map((p) => ({ id: p.id, label: p.name, desc: `${p.model} · ${p.script_input === 'frames' ? '关键帧图片分析' : '视频直传'}` })),
  ]
  const storyboardProviderOptions = [
    { id: 'gemini', label: 'Gemini', desc: '速度快，成本低' },
    { id: 'kimi', label: 'Kimi', desc: '图像理解强' },
    { id: 'minimax', label: 'MiniMax-M3', desc: '原生多模态，图像理解' },
    { id: 'openai', label: 'OpenAI (ChatGPT)', desc: 'GPT 多模态，图像理解强' },
    { id: 'anthropic', label: 'Anthropic (Claude)', desc: 'Claude 多模态，视觉推理最强' },
    ...draft.custom_providers.map((p) => ({ id: p.id, label: p.name, desc: p.model })),
  ]

  return (
    <div className="space-y-5">
      {/* 生成剧本 */}
      <Section title="生成剧本" icon={<FileText className="h-4 w-4" />}>
        <Field label="使用 API">
          <ProviderList
            value={draft.script_provider}
            onChange={onScriptProvider}
            options={scriptProviderOptions}
          />
        </Field>

        <Field label="剧本大师" hint="生成剧本时注入该大师的创作方法论；剧本页可对单次生成临时切换">
          <ProviderList
            value={draft.script_master || 'default'}
            onChange={(v) => onScriptMaster(v === 'default' ? '' : v)}
            options={masterOptions('剧本')}
          />
        </Field>
      </Section>

      {/* 分镜表 */}
      <Section title="分镜表" icon={<Clapperboard className="h-4 w-4" />}>
        <Field label="图像分析器">
          <ProviderList
            value={draft.storyboard_provider}
            onChange={onStoryboardProvider}
            options={storyboardProviderOptions}
          />
          {draft.custom_providers.length === 0 && (
            <p className="mt-1.5 text-[11px] text-zinc-600">可在「API 配置 → 自定义供应商」中添加更多模型</p>
          )}
        </Field>

        <Field label="分镜大师" hint="逐镜分析时注入该大师的创作方法论（与剧本大师各选各的）；切割工作台可对单次生成临时切换">
          <ProviderList
            value={draft.storyboard_master || 'default'}
            onChange={(v) => onStoryboardMaster(v === 'default' ? '' : v)}
            options={masterOptions('分镜')}
          />
        </Field>

        <Field label="切割方式">
          <ProviderList
            value={draft.storyboard.cut_method}
            onChange={(v) => onStoryboard({ cut_method: v as AppConfig['storyboard']['cut_method'] })}
            options={[
              { id: 'smart', label: '混合检测（推荐）', desc: '硬切/白闪/一镜到底锋面/叠化 四检测器融合，渐变转场更准' },
              { id: 'scene', label: '帧差值检测', desc: '经典单阈值法（ffmpeg 帧差），速度快，适合纯硬切素材' },
            ]}
          />
        </Field>

        {draft.storyboard.cut_method === 'scene' ? (
          <Field label="切点判定阈值" hint="每帧差异值 > 阈值即切点（0~1）· 看时间轴下方曲线调：放在「谷底之上、尖峰之下」">
            <div className="flex items-center gap-3">
              <input
                type="range" min={0.01} max={1} step={0.01}
                value={draft.storyboard.scene_threshold}
                onChange={(e) => onStoryboard({ scene_threshold: parseFloat(e.target.value) })}
                className="w-full accent-amber-500"
              />
              <input
                type="number" min={0.01} max={1} step={0.01}
                value={draft.storyboard.scene_threshold}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val)) onStoryboard({ scene_threshold: Math.max(0.01, Math.min(1, val)) })
                }}
                className="w-16 rounded-md border border-white/[0.08] bg-black/30 px-2 py-1 text-center font-mono text-sm text-zinc-300 outline-none focus:border-accent/50"
              />
            </div>
          </Field>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Field label="硬切最低帧差" hint="默认 5.5 · 调低更敏感">
              <input
                type="number" min={1} max={50} step={0.5}
                value={draft.storyboard.smart_hard_min}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) onStoryboard({ smart_hard_min: Math.max(1, Math.min(50, v)) })
                }}
                className="input-field font-mono"
              />
            </Field>
            <Field label="硬切相对倍率" hint="默认 8 · 排除运镜误报">
              <input
                type="number" min={2} max={50} step={0.5}
                value={draft.storyboard.smart_hard_ratio}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) onStoryboard({ smart_hard_ratio: Math.max(2, Math.min(50, v)) })
                }}
                className="input-field font-mono"
              />
            </Field>
            <Field label="最小切点间隔" hint="默认 0.3 秒；0.1~0.15 可拆动画连环快切">
              <input
                type="number" min={0.1} max={10} step={0.1}
                value={draft.storyboard.smart_min_gap}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) onStoryboard({ smart_min_gap: Math.max(0.1, Math.min(10, v)) })
                }}
                className="input-field font-mono"
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="最大分镜数" hint="默认 200">
            <input
              type="number" min={10} max={500}
              value={draft.storyboard.max_shots}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!isNaN(v)) onStoryboard({ max_shots: Math.max(10, Math.min(500, v)) })
              }}
              className="input-field font-mono"
            />
          </Field>
          <Field label="并发分析数" hint="默认 3，最大 10">
            <input
              type="number" min={1} max={10}
              value={draft.storyboard.concurrency}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!isNaN(v)) onStoryboard({ concurrency: Math.max(1, Math.min(10, v)) })
              }}
              className="input-field font-mono"
            />
          </Field>
        </div>

        <Field label="图像理解 Prompt" hint="留空使用默认；七段式输出契约会固定追加">
          <textarea
            value={draft.storyboard.prompt}
            onChange={(e) => onStoryboard({ prompt: e.target.value })}
            placeholder={STORYBOARD_DEFAULT_ANALYSIS_PROMPT}
            rows={8}
            className="input-field resize-y font-mono text-xs"
            spellCheck={false}
          />
        </Field>
      </Section>
    </div>
  )
}

// ---------- 关于 ----------

// ---------- 编剧大师 Tab ----------

/** 入驻编剧大师展示页：来自 gen-masters 清单（BUILTIN_MASTERS），选用入口在「功能配置」 */
function MastersTab() {
  return (
    <div className="space-y-5">
      <Section title="入驻编剧大师" icon={<GraduationCap className="h-4 w-4" />}>
        <p className="text-[11px] text-zinc-500">
          编剧大师提供独家创作方法论，选用后注入剧本 / 分镜分析以提升专业深度。
          在「功能配置 → 剧本大师 / 分镜大师」中选用。
        </p>
        <div className="space-y-2">
          {BUILTIN_MASTERS.map((m) => (
            <div
              key={m.id}
              title={m.promo}
              className="rounded-lg border border-white/[0.06] bg-black/20 p-3 transition-colors hover:border-accent/40 hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <GraduationCap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-zinc-100">{m.author}</span>
                    <span className="truncate text-[11px] text-zinc-500">大师包「{m.name}」</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">{m.description}</p>
                </div>
                {m.xiaohongshu && (
                  <button
                    type="button"
                    onClick={() => window.v2s.openExternal(m.xiaohongshu)}
                    className="btn-ghost flex shrink-0 items-center gap-1.5 !px-2.5 !py-1.5 text-[11px] text-red-300 hover:text-red-200"
                    title={m.promo}
                  >
                    <BookHeart className="h-3.5 w-3.5" />
                    小红书
                  </button>
                )}
                {m.github && (
                  <button
                    type="button"
                    onClick={() => window.v2s.openExternal(m.github)}
                    className="btn-ghost flex shrink-0 items-center gap-1.5 !px-2.5 !py-1.5 text-[11px]"
                    title={m.github}
                  >
                    <Github className="h-3.5 w-3.5" />
                    GitHub
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-zinc-600">更多大师入驻中…</p>
      </Section>
    </div>
  )
}

function AboutContent() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <LogoIcon className="h-16 w-16 opacity-90" />
      <h3 className="mt-4 text-lg font-light text-zinc-100">XLB Storyboard</h3>
      <p className="mt-1 text-xs text-zinc-500">包拆拆</p>
      <div className="mt-3 rounded-full border border-white/[0.06] bg-black/30 px-3 py-1">
        <span className="font-mono text-xs text-zinc-400">v{__APP_VERSION__}</span>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">视频转剧本/分镜工具</p>
      <button
        type="button"
        onClick={() => window.v2s.openExternal('https://xhslink.com/m/vX0zH462eU')}
        className="mt-4 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
      >
        有需求猛敲我 @玩AI的小笼包
      </button>
      <p className="mt-4 text-[11px] text-zinc-600">© 2026 玩AI的小笼包</p>
    </div>
  )
}

// ---------- 可复用子组件 ----------

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all',
        active ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
      )}
    >
      <span className={cn('shrink-0', active && 'text-accent')}>{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  )
}

function ProviderList({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: Array<{ id: string; label: string; desc?: string }>
}) {
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all',
              active ? 'border-accent/40 bg-accent/[0.04]' : 'border-white/[0.06] bg-black/20 hover:border-white/[0.10]'
            )}
          >
            <div className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
              active ? 'border-accent bg-accent' : 'border-zinc-600'
            )}>
              {active && <div className="h-1.5 w-1.5 rounded-full bg-ink-950" />}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-zinc-100">{opt.label}</span>
              {opt.desc && <span className="text-xs text-zinc-500">{opt.desc}</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function ProviderViewCard({ provider, testing, testResult, onEdit, onDelete, onTest }: {
  provider: CustomProvider
  testing: boolean
  testResult: { ok: boolean; message: string } | null
  onEdit: () => void
  onDelete: () => void
  onTest: () => void
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-100">{provider.name}</span>
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{provider.model}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{provider.base_url}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onTest} disabled={testing || !provider.api_key} className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40" title="测试连接" type="button">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          </button>
          <button onClick={onEdit} className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200" title="编辑" type="button">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-red-400" title="删除" type="button">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {testResult && (
        <div className={cn('mt-1.5 text-[11px]', testResult.ok ? 'text-emerald-400' : 'text-red-400')}>
          {testResult.ok ? <CheckCircle2 className="mr-1 inline h-3 w-3" /> : <AlertCircle className="mr-1 inline h-3 w-3" />}
          {testResult.message}
        </div>
      )}
    </div>
  )
}

function ProviderFormCard({ form, showKey, onToggleKey, onChange, onSave, onCancel }: {
  form: ProviderFormState
  showKey: boolean
  onToggleKey: () => void
  onChange: (f: ProviderFormState) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/[0.03] px-3 py-3">
      <div className="mb-2 text-xs font-medium text-zinc-400">{form.id === null ? '添加供应商' : '编辑供应商'}</div>
      <div className="space-y-2">
        <input type="text" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="名称（如 MiniMax M3）" className="input-field" autoFocus />
        <div className="relative">
          <input type={showKey ? 'text' : 'password'} value={form.api_key} onChange={(e) => onChange({ ...form, api_key: e.target.value })} placeholder="API Key" className="input-field pr-10 font-mono" spellCheck={false} />
          <button onClick={onToggleKey} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:text-zinc-200" type="button" tabIndex={-1}>
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <input type="text" value={form.base_url} onChange={(e) => onChange({ ...form, base_url: e.target.value })} placeholder="Base URL（如 https://api.minimax.io/v1）" className="input-field font-mono" spellCheck={false} />
        <input type="text" value={form.model} onChange={(e) => onChange({ ...form, model: e.target.value })} placeholder="模型名（如 MiniMax-M3）" className="input-field font-mono" />
        <Field label="拆剧本的输入方式">
          <select value={form.script_input} onChange={(e) => onChange({ ...form, script_input: e.target.value as 'video' | 'frames' })} className="input-field">
            <option value="video">整段视频（模型需支持视频输入）</option>
            <option value="frames">关键帧图片（DeepSeek 等图像模型，无音频）</option>
          </select>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onSave} disabled={!form.name.trim()} className="btn-primary flex items-center gap-1" type="button">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {form.id === null ? '添加' : '保存'}
        </button>
        <button onClick={onCancel} className="btn-ghost" type="button">取消</button>
      </div>
    </div>
  )
}

function TestResult({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null
  return (
    <span className={cn('text-xs', result.ok ? 'text-emerald-400' : 'text-red-400')}>
      {result.ok ? <CheckCircle2 className="mr-1 inline h-3 w-3" /> : <AlertCircle className="mr-1 inline h-3 w-3" />}
      {result.message}
    </span>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-400">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-zinc-300">{label}</span>
        {hint && <span className="text-[10px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function ModelRadio({ checked, label, desc, value, onChange }: { checked: boolean; label: string; desc: string; value: string; onChange: () => void }) {
  return (
    <button
      type="button" onClick={onChange}
      className={cn(
        'group flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all',
        checked ? 'border-accent/40 bg-accent/[0.04]' : 'border-white/[0.06] bg-black/20 hover:border-white/[0.12]'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-accent bg-accent' : 'border-zinc-600')}>
          {checked && <div className="h-1.5 w-1.5 rounded-full bg-ink-950" />}
        </div>
        <div>
          <div className="text-sm text-zinc-100">{label}</div>
          <div className="text-xs text-zinc-500">{desc}</div>
        </div>
      </div>
      <span className="font-mono text-[10px] text-zinc-600">{value}</span>
    </button>
  )
}

function ResolutionCard({ active, onClick, label, desc, badge }: { active: boolean; onClick: () => void; label: string; desc: string; badge?: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        'relative rounded-lg border px-4 py-3 text-left transition-all',
        active ? 'border-accent/40 bg-accent/[0.05]' : 'border-white/[0.06] bg-black/20 hover:border-white/[0.12]'
      )}
    >
      {badge && <span className="absolute right-2 top-2 rounded bg-accent/20 px-1.5 py-0.5 text-[9px] uppercase text-accent">{badge}</span>}
      <div className={cn('text-sm font-medium', active ? 'text-accent' : 'text-zinc-100')}>{label}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{desc}</div>
    </button>
  )
}
