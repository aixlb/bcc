import { afterEach, describe, expect, it, vi } from 'vitest'
import { KimiService } from '@core/services/kimi.js'

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function service(model = 'kimi-k3'): KimiService {
  return new KimiService({ api_key: 'test-key', model, base_url: 'https://api.moonshot.cn/v1' })
}

type StreamChat = (
  prompt: string,
  fileId: string,
  callbacks: {
    onToken?: (accumulated: string, delta: string, tokensUsed?: number) => void
    onStatus?: (status: string, message: string) => void
  }
) => Promise<string>

function streamChatOf(instance: KimiService): StreamChat {
  return (instance as unknown as { streamChat: StreamChat }).streamChat.bind(instance)
}

afterEach(() => vi.unstubAllGlobals())

describe('Kimi K3 剧本流式响应', () => {
  it.each(['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'])('%s 沿用视频和 Partial Mode，并携带集中配置的推理参数', async (model) => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: '教室 日/内' }, finish_reason: 'stop' }] },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    expect(await streamChatOf(service(model))('生成剧本', 'file-1', {})).toContain('教室')
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe(model)
    expect(body.reasoning_effort).toBe('max')
    expect(body.messages[1].content[0].video_url.url).toBe('ms://file-1')
    expect(body.messages.at(-1).partial).toBe(true)
  })

  it('不设置应用级输出上限，并只把最终正文拼成带时间戳的剧本', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { choices: [{ delta: { reasoning_content: '先分析场景。' }, finish_reason: null }] },
        { choices: [{ delta: { content: '教室 日/内\n人物：学生' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 1234 } },
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    const statuses: string[] = []

    const result = await streamChatOf(service())('生成剧本', 'file-1', {
      onStatus: (_status, message) => statuses.push(message),
    })

    expect(result).toBe('[00:00:00] 1-1 教室 日/内\n人物：学生')
    expect(result).not.toContain('先分析场景')
    expect(statuses).toContain('Kimi 深度思考中，完成后将开始输出剧本...')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const requestBody = JSON.parse(String(request.body))
    expect(requestBody.max_completion_tokens).toBeUndefined()
    expect(requestBody.max_tokens).toBeUndefined()
    expect(requestBody.reasoning_effort).toBe('max')
    expect(requestBody.messages.at(-1)).toEqual({
      role: 'assistant', content: '[00:00:00] 1-1 ', partial: true,
    })
  })

  it('思考耗尽额度时明确报错，不把空剧本当成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { reasoning_content: '持续分析……' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
    ])))

    await expect(streamChatOf(service())('生成剧本', 'file-1', {})).rejects.toThrow(
      '深度思考占满了服务端输出额度'
    )
  })

  it('K2.7 不携带 K3 专属 reasoning_effort', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: '场景 日/外' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    await streamChatOf(service('kimi-k2.7-code'))('生成剧本', 'file-1', {})
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body)).reasoning_effort).toBeUndefined()
  })
})
