import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FinishReason } from '@google/genai'
import type { AppConfig } from '@shared/types'
import { PROVIDER_TEMPLATES } from '@shared/model-presets'
import { GeminiService } from '@core/services/gemini.js'
import { createAnalyzer } from '@core/services/storyboard-analyzer.js'
import { createSynthesizer } from '@core/services/synthesizer.js'
import { resolveAnalyzerConfig } from '@core/services/storyboard-manager.js'
import { resolveSynthesizerConfig } from '@core/pipelines/research.js'
import { ChatGPTService } from '@core/services/chatgpt.js'
import { runScript } from '@core/pipelines/script.js'
import { setDataRoot, __resetRuntime } from '@core/runtime.js'
import type { VideoInfo } from '@core/services/video.js'

const google = vi.hoisted(() => ({ generate: vi.fn(), stream: vi.fn(), upload: vi.fn(), delete: vi.fn() }))
vi.mock('@google/genai', async (original) => ({
  ...await original<typeof import('@google/genai')>(),
  GoogleGenAI: class {
    models = { generateContent: google.generate, generateContentStream: google.stream }
    files = { upload: google.upload, delete: google.delete }
  },
}))
vi.mock('@core/services/video.js', async (original) => ({
  ...await original<typeof import('@core/services/video.js')>(),
  compressIfNeeded: async (file: string) => ({ outputPath: file, compressed: false, outputMB: 0.001, originalMB: 0.001 }),
}))
vi.mock('@core/services/storyboard.js', async (original) => ({
  ...await original<typeof import('@core/services/storyboard.js')>(),
  extractFrame: async (_video: string, time: number, dir: string) => {
    const file = path.join(dir, `${time}.jpg`)
    await fs.writeFile(file, 'jpeg')
    return file
  },
}))

const SCRIPT = '[00:00:00] 1-1 教室 日/内\n△ 学生抬头。\n【画面未见对白】'
let dir: string
let video: string
let frame: string
let info: VideoInfo

function textStream(text: string) {
  return (async function* () { yield { text, candidates: [{ finishReason: FinishReason.STOP }] } })()
}

beforeEach(async () => {
  vi.clearAllMocks()
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-model-support-'))
  video = path.join(dir, 'clip.mp4')
  frame = path.join(dir, 'frame.jpg')
  await fs.writeFile(video, 'video')
  await fs.writeFile(frame, 'jpeg')
  setDataRoot(path.join(dir, 'data'))
  info = { path: video, durationSec: 4, sizeBytes: 5, width: 320, height: 180, fps: 25, bitrateBps: 1000, videoCodec: 'h264', audioCodec: '', format: 'mp4' }
  google.upload.mockResolvedValue({ name: 'files/clip', uri: 'https://example.com/clip', mimeType: 'video/mp4', state: 'ACTIVE' })
  google.delete.mockResolvedValue({})
  google.stream.mockImplementation(async () => textStream(SCRIPT))
  google.generate.mockResolvedValue({ text: '{"shotType":"中景","description":"学生抬头"}', candidates: [{ finishReason: FinishReason.STOP }] })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  __resetRuntime()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('新增模型的实际请求通道', () => {
  it('Gemini 4 继续通过正式视频、图片和风格合成接口传递正确模型 ID', async () => {
    const model = 'gemini-4-argon'
    const service = new GeminiService({ api_key: 'test-key', model, proxy: '', video_resolution: 'low' })
    expect(await service.generateScript(video, info)).toBe(SCRIPT)
    const scriptRequest = google.stream.mock.calls[0][0]
    expect(scriptRequest.model).toBe(model)
    expect(scriptRequest.contents[0].parts[1].fileData.mimeType).toBe('video/mp4')
    expect(scriptRequest.config.temperature).toBeUndefined()
    expect(scriptRequest.config.cachedContent).toBeUndefined()

    const config = { provider: 'gemini' as const, apiKey: 'test-key', baseUrl: '', model }
    await createAnalyzer(config).analyze(frame, '识别分镜')
    expect(google.generate.mock.calls[0][0].model).toBe(model)
    await createSynthesizer(config).synthesize({ systemPrompt: 'system', userText: '研究风格', images: [frame], onChunk: () => {} })
    expect(google.stream.mock.calls[1][0].model).toBe(model)
  })

  it.each(['frames', undefined] as const)('自定义供应商的剧本输入 %s 正确路由，旧配置继续直传视频', async (input) => {
    const template = PROVIDER_TEMPLATES.find((entry) => entry.id === 'deepseek')!
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '分析画面。' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: SCRIPT }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const config = {
      script_provider: template.id,
      script_master: '',
      custom_providers: [{ ...template, api_key: 'test-key', script_input: input }],
    } as AppConfig
    expect((await runScript({ videoPath: video, config, probeVideo: async () => info })).script).toBe(SCRIPT)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions')
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe('deepseek-flash')
    const content = body.messages.find((message: { role: string }) => message.role === 'user').content
    expect(content.some((part: { type: string }) => part.type === 'image_url')).toBe(input === 'frames')
    expect(content.some((part: { type: string }) => part.type === 'video_url')).toBe(input !== 'frames')
    if (input === 'frames') {
      expect(content[0].text).toContain('没有音频')
      expect(content[0].text).toContain('【画面未见对白】')
    }
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
  })

  it.each(['kimi', 'deepseek'])('%s 的分镜与风格合成沿用配置中的端点、图片与模型参数', async (provider) => {
    const template = PROVIDER_TEMPLATES.find((entry) => entry.id === 'deepseek')!
    const model = provider === 'kimi' ? 'kimi-k3.1-pro' : 'deepseek-flash'
    const baseUrl = provider === 'kimi' ? 'https://api.moonshot.cn/v1' : template.base_url
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      return body.stream
        ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '# 风格指南' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"shotType":"中景","description":"学生抬头"}' }, finish_reason: 'stop' }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const config = {
      storyboard_provider: provider,
      research: { synthesis_provider: null },
      kimi: { api_key: 'test-key', model, base_url: '' },
      custom_providers: [{ ...template, api_key: 'test-key' }],
    } as AppConfig
    expect((await createAnalyzer(resolveAnalyzerConfig(config)).analyze(frame, '识别分镜')).shotType).toBe('中景')
    expect(await createSynthesizer(resolveSynthesizerConfig(config)).synthesize({ systemPrompt: 'system', userText: '研究风格', images: [frame], onChunk: () => {} })).toBe('# 风格指南')
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(`${baseUrl}/chat/completions`)
      const body = JSON.parse(String(init.body))
      expect(body.model).toBe(model)
      expect(body.reasoning_effort).toBe(provider === 'kimi' ? 'max' : undefined)
      expect(body.messages.find((message: { role: string }) => message.role === 'user').content).toContainEqual(expect.objectContaining({ type: 'image_url' }))
    }
  })

  it.each(['model', 'base_url'])('关键帧供应商未填 %s 时不能回退到 OpenAI 官方模型或地址', (field) => {
    const template = PROVIDER_TEMPLATES.find((entry) => entry.id === 'deepseek')!
    expect(() => new ChatGPTService({ ...template, api_key: 'test-key', [field]: '' }, template.name)).toThrow(/未配置/)
  })
})
