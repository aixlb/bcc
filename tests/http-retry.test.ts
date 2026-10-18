import { describe, it, expect, vi } from 'vitest'
import { fetchWithOverloadRetry, isRetryableStatus, sleepWithAbort } from '@core/services/http-retry.js'

describe('isRetryableStatus', () => {
  it('429/5xx/529 可重试，业务 4xx 不可', () => {
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(529)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
  })
})

describe('fetchWithOverloadRetry', () => {
  it('429 过载自动重试直至成功，等待时上报状态', async () => {
    const overloaded = () =>
      new Response('{"error":{"type":"engine_overloaded_error"}}', { status: 429 })
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const waits: string[] = []

    const resp = await fetchWithOverloadRetry({
      label: 'Kimi API',
      doFetch,
      baseDelayMs: 1,
      onWait: (m) => waits.push(m),
    })

    expect(resp.ok).toBe(true)
    expect(doFetch).toHaveBeenCalledTimes(3)
    expect(waits).toHaveLength(2)
    expect(waits[0]).toContain('自动重试 (1/4)')
  })

  it('业务错误（401）不重试，立刻按原格式抛错', async () => {
    const doFetch = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    await expect(
      fetchWithOverloadRetry({ label: 'Kimi API', doFetch, baseDelayMs: 1 })
    ).rejects.toThrow('Kimi API 401: unauthorized')
    expect(doFetch).toHaveBeenCalledTimes(1)
  })

  it('重试耗尽后抛出最后一次错误', async () => {
    const doFetch = vi.fn(async () => new Response('overloaded', { status: 429 }))
    await expect(
      fetchWithOverloadRetry({ label: 'MiniMax API', doFetch, retries: 2, baseDelayMs: 1 })
    ).rejects.toThrow('MiniMax API 429: overloaded')
    expect(doFetch).toHaveBeenCalledTimes(3) // 首次 + 2 次重试
  })

  it('等待期间取消：立刻以 AbortError 结束', async () => {
    const controller = new AbortController()
    const doFetch = vi.fn(async () => new Response('overloaded', { status: 429 }))
    const p = fetchWithOverloadRetry({
      label: 'X API',
      doFetch,
      signal: controller.signal,
      baseDelayMs: 60_000, // 长等待，靠 abort 打断
    })
    setTimeout(() => controller.abort(), 20)
    await expect(p).rejects.toThrow(/Cancelled|abort/i)
  })
})

describe('sleepWithAbort', () => {
  it('正常等待后 resolve', async () => {
    await expect(sleepWithAbort(5)).resolves.toBeUndefined()
  })

  it('已中止的 signal 立刻 reject', async () => {
    const c = new AbortController()
    c.abort()
    await expect(sleepWithAbort(1000, c.signal)).rejects.toThrow()
  })
})
