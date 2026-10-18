import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamOpenAIChatCompletion } from '@core/services/openai-script.js'

function response(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI 兼容流完整性保护', () => {
  it('finish_reason=length 时拒绝返回已经产生的残缺正文', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      { choices: [{ delta: { content: '残缺剧本' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
    ])))

    await expect(streamOpenAIChatCompletion(
      { name: 'OpenAI', apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'gpt-5.6' },
      [{ role: 'user', content: '生成剧本' }],
      {},
      {}
    )).rejects.toThrow('内容被截断')
  })

  it('正常停止时返回正文并透传模型专属推理参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([
      { choices: [{ delta: { content: '[00:00:00] 1 开场' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const text = await streamOpenAIChatCompletion(
      { name: 'OpenAI', apiKey: 'key', baseUrl: 'https://api.example.com/v1', model: 'gpt-5.6' },
      [{ role: 'user', content: '生成剧本' }],
      {
        extraBody: { reasoning_effort: 'low' },
      },
      {}
    )

    expect(text).toBe('[00:00:00] 1 开场')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
    expect(body.reasoning_effort).toBe('low')
  })
})
