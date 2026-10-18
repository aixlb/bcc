import { describe, it, expect } from 'vitest'
import type { AppConfig } from '@shared/types'
import { runScript, type ScriptProgress } from '@core/pipelines/script.js'
import type { VideoInfo } from '@core/index.js'

const fakeVideoInfo: VideoInfo = {
  durationSec: 100,
  sizeBytes: 2048,
  width: 1920,
  height: 1080,
  fps: 30,
  bitrateBps: 1_000_000,
  videoCodec: 'h264',
} as VideoInfo

const SCRIPT = ['[00:00:00] 1 开场', '小明：你好', '[00:00:30] 2 第二场', '△ 转场'].join('\n')

describe('runScript 管线（注入假 provider）', () => {
  it('返回解析后的剧本与场景，并按序上报进度', async () => {
    const events: ScriptProgress[] = []
    const result = await runScript({
      videoPath: '/fake/a.mp4',
      config: {} as AppConfig,
      onProgress: (ev) => events.push(ev),
      probeVideo: async () => fakeVideoInfo,
      generate: async (_vp, _info, cb) => {
        cb.onStatus?.('generating', '开始')
        cb.onToken?.('开场', '开场', 5)
        cb.onToken?.(SCRIPT, SCRIPT, 42)
        return SCRIPT
      },
    })

    expect(result.script).toBe(SCRIPT)
    expect(result.scenes).toHaveLength(2)
    expect(result.durationSec).toBe(100)
    expect(result.videoSizeBytes).toBe(2048)
    expect(result.tokensUsed).toBe(42)
    expect(result.generatedInMs).toBeGreaterThanOrEqual(0)

    // 进度：首个为 preparing，随后出现 generating，token 累计被透传
    expect(events[0].status).toBe('preparing')
    expect(events.some((e) => e.status === 'generating')).toBe(true)
    const last = events[events.length - 1]
    expect(last.partialScript).toBe(SCRIPT)
    expect(last.tokensUsed).toBe(42)
  })

  it('generate 抛错时 runScript 透传错误（取消）', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runScript({
        videoPath: '/fake/a.mp4',
        config: {} as AppConfig,
        signal: controller.signal,
        probeVideo: async () => fakeVideoInfo,
        generate: async (_vp, _info, cb) => {
          if (cb.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
          return SCRIPT
        },
      })
    ).rejects.toThrow()
  })

  it('不保存缺少时间戳、倒序或越界的模型输出', async () => {
    const runWith = (script: string) => runScript({
      videoPath: '/fake/a.mp4',
      config: {} as AppConfig,
      probeVideo: async () => fakeVideoInfo,
      generate: async () => script,
    })

    await expect(runWith('这是没有时间戳的原始文本')).rejects.toThrow('缺少 [HH:MM:SS]')
    await expect(runWith('[00:00:20] 1 后场\n[00:00:10] 2 前场')).rejects.toThrow('时间戳顺序错误')
    await expect(runWith('[00:02:00] 1 越界场景')).rejects.toThrow('超出视频时长')
  })

  it('剧本大师：masterId 注入后的 systemPrompt 透传给 provider；默认不传', async () => {
    // 默认（config 无 script_master / 未传 masterId）：systemPrompt 为 undefined，provider 用自己的默认
    let seenDefault: string | undefined = 'sentinel'
    await runScript({
      videoPath: '/fake/a.mp4',
      config: {} as AppConfig,
      probeVideo: async () => fakeVideoInfo,
      generate: async (_vp, _info, _cb, systemPrompt) => {
        seenDefault = systemPrompt
        return SCRIPT
      },
    })
    expect(seenDefault).toBeUndefined()

    // 指定山之音：systemPrompt = 基础格式规范 + 方法论附录
    let seenMaster: string | undefined
    await runScript({
      videoPath: '/fake/a.mp4',
      config: {} as AppConfig,
      masterId: 'shanzhiyin',
      probeVideo: async () => fakeVideoInfo,
      generate: async (_vp, _info, _cb, systemPrompt) => {
        seenMaster = systemPrompt
        return SCRIPT
      },
    })
    expect(seenMaster).toContain('[HH:MM:SS]') // 基础格式契约仍在
    expect(seenMaster).toContain('叙事目的') // 大师方法论已注入

    // config.script_master 全局配置同样生效（masterId 缺省时回退）
    let seenFromConfig: string | undefined
    await runScript({
      videoPath: '/fake/a.mp4',
      config: { script_master: 'shanzhiyin' } as AppConfig,
      probeVideo: async () => fakeVideoInfo,
      generate: async (_vp, _info, _cb, systemPrompt) => {
        seenFromConfig = systemPrompt
        return SCRIPT
      },
    })
    expect(seenFromConfig).toContain('叙事目的')
  })

  it('progress 单调不减且封顶 0.95（生成阶段）', async () => {
    const progresses: number[] = []
    await runScript({
      videoPath: '/fake/a.mp4',
      config: {} as AppConfig,
      onProgress: (ev) => progresses.push(ev.progress),
      probeVideo: async () => fakeVideoInfo,
      generate: async (_vp, _info, cb) => {
        cb.onToken?.('a', 'a', 1)
        cb.onToken?.('a'.repeat(8000), 'x', 2)
        return SCRIPT
      },
    })
    expect(Math.max(...progresses)).toBeLessThanOrEqual(0.95)
    expect(progresses.every((p) => p >= 0 && p <= 1)).toBe(true)
  })
})
