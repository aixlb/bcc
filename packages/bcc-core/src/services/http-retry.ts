/**
 * 模型 API 的过载重试：429（engine_overloaded / rate limit）与 5xx 多为瞬时，
 * 指数退避重试能救回大多数请求——尤其是「大文件已上传、只差对话请求」的场景
 * （Kimi 传 100MB 视频要两分钟，对话一击 429 就整单报废太亏）。
 *
 * 只在拿到响应头阶段重试（resp.ok 之前）；一旦开始读 SSE 流就不再重试，
 * 避免已推给 UI 的 token 重复。
 */

/** 服务端过载/瞬时故障才重试；其余 4xx 是业务错误（key 无效、参数错），重试无意义 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529
}

/** 可中断的等待：signal 触发立刻以 AbortError 结束 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface FetchRetryOptions {
  /** 错误信息前缀，如 'Kimi API'（保持各供应商原有报错格式） */
  label: string
  /** 每次尝试发起一次全新请求 */
  doFetch: () => Promise<Response>
  signal?: AbortSignal
  /** 最大重试次数（不含首次），默认 4 */
  retries?: number
  /** 首次重试等待毫秒（之后每次翻倍 ±20% 抖动，上限 60s），默认 5000 */
  baseDelayMs?: number
  /** 等待重试时回调（报给 UI 任务卡） */
  onWait?: (message: string) => void
  logInfo?: (msg: string) => void
  logError?: (msg: string) => void
}

/**
 * 带过载重试的 fetch：返回已确认 resp.ok 的 Response；重试耗尽或不可重试状态时抛错
 * （错误格式与原实现一致：`${label} ${status}: ${body 前 300 字}`）。
 */
export async function fetchWithOverloadRetry(opts: FetchRetryOptions): Promise<Response> {
  const retries = opts.retries ?? 4
  const baseDelayMs = opts.baseDelayMs ?? 5000

  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const resp = await opts.doFetch()
    if (resp.ok) return resp

    const text = await resp.text().catch(() => '')
    opts.logError?.(`对话失败 HTTP ${resp.status}: ${text.slice(0, 2000)}`)
    if (attempt >= retries || !isRetryableStatus(resp.status)) {
      throw new Error(`${opts.label} ${resp.status}: ${text.slice(0, 300)}`)
    }

    // 优先尊重服务端 Retry-After（秒）；否则指数退避 + 抖动
    const retryAfterSec = parseFloat(resp.headers.get('retry-after') ?? '')
    const backoffMs = baseDelayMs * 2 ** attempt * (0.8 + Math.random() * 0.4)
    const delayMs = Math.min(
      60_000,
      Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : backoffMs
    )
    const msg = `服务端过载 (HTTP ${resp.status})，${Math.ceil(delayMs / 1000)}s 后自动重试 (${attempt + 1}/${retries})...`
    opts.logInfo?.(msg)
    opts.onWait?.(msg)
    await sleepWithAbort(delayMs, opts.signal)
  }
}
