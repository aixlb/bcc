import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnalyzer } from '@core/services/storyboard-analyzer.js'
import { createSynthesizer } from '@core/services/synthesizer.js'
import { MinimaxService } from '@core/services/minimax.js'

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('正式生成请求不设置应用级输出 token 上限', () => {
  it('OpenAI 兼容分镜分析请求省略两种 token 上限字段', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcc-analyzer-test-'))
    const frame = path.join(dir, 'frame.jpg')
    await fs.writeFile(frame, 'jpeg')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"description":"画面"}' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const analyzer = createAnalyzer({
        provider: 'openai', apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'gpt-5.6',
      })
      await analyzer.analyze(frame, '分析画面')
      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
      expect(body.max_tokens).toBeUndefined()
      expect(body.max_completion_tokens).toBeUndefined()
      expect(body.reasoning_effort).toBe('low')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('OpenAI 兼容风格合成请求省略两种 token 上限字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: '# 风格指南' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const synthesizer = createSynthesizer({
      provider: 'openai', apiKey: 'key', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3',
    })
    await synthesizer.synthesize({ systemPrompt: 'system', userText: '研究风格', images: [], onChunk: () => {} })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.reasoning_effort).toBe('max')
  })

  it('MiniMax 正式剧本请求省略 max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: '[00:00:00] 1 开场' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const service = new MinimaxService({ api_key: 'key', model: 'MiniMax-M3', base_url: 'https://api.minimaxi.com/v1' })
    const streamChat = (service as unknown as {
      streamChat: (prompt: string, fileId: string, callbacks: object) => Promise<string>
    }).streamChat.bind(service)

    expect(await streamChat('生成剧本', 'file-1', {})).toBe('[00:00:00] 1 开场')
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBeUndefined()
  })
})
