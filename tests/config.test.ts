import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setDataRoot, __resetRuntime } from '@core/runtime.js'
import { loadConfig, saveConfig, getConfigFilePath, __resetConfigCache } from '@core/services/config.js'

/** 每个用例独立的临时 appDir：dataRoot=<dir>/data，config 在 <dir>/config.yaml */
function freshAppDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-cfg-'))
  __resetRuntime()
  __resetConfigCache()
  setDataRoot(path.join(dir, 'data'))
  return dir
}

describe('config 加载 / 保存 / 兼容', () => {
  it('缺省配置回退默认值并落盘', async () => {
    const dir = freshAppDir()
    const cfg = await loadConfig()
    expect(cfg.gemini.model).toBeTruthy()
    expect(cfg.kimi.model).toBe('kimi-k3')
    expect(cfg.openai.model).toBe('gpt-5.6')
    expect(cfg.script_provider).toBe('gemini')
    expect(cfg.script_master).toBe('')
    expect(cfg.storyboard_master).toBe('')
    expect(cfg.anthropic.model).toBe('claude-fable-5')
    expect(cfg.anthropic.api_key).toBe('')
    expect(cfg.research.video_concurrency).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(dir, 'config.yaml'))).toBe(true)
  })

  it('保存后重读一致（roundtrip）', async () => {
    const dir = freshAppDir()
    const cfg = await loadConfig()
    cfg.gemini.api_key = 'sk-roundtrip'
    cfg.storyboard.max_shots = 123
    cfg.script_master = 'shanzhiyin'
    cfg.storyboard_master = 'shanzhiyin'
    await saveConfig(cfg)
    __resetConfigCache()
    const reloaded = await loadConfig()
    expect(reloaded.gemini.api_key).toBe('sk-roundtrip')
    expect(reloaded.storyboard.max_shots).toBe(123)
    expect(reloaded.script_master).toBe('shanzhiyin')
    expect(reloaded.storyboard_master).toBe('shanzhiyin')
    expect(getConfigFilePath()).toBe(path.join(dir, 'config.yaml'))
  })

  it('向后兼容：旧键 distillation 读为 research', async () => {
    const dir = freshAppDir()
    const yaml = ['gemini:', '  api_key: "k"', 'distillation:', '  video_concurrency: 3', '  mosaic_frames_per_video: 8'].join('\n')
    fs.writeFileSync(path.join(dir, 'config.yaml'), yaml, 'utf-8')
    const cfg = await loadConfig()
    expect(cfg.research.video_concurrency).toBe(3)
    expect(cfg.research.mosaic_frames_per_video).toBe(8)
  })

  it('保存时以 research 键写出（不再写 distillation）', async () => {
    const dir = freshAppDir()
    const cfg = await loadConfig()
    await saveConfig(cfg)
    const written = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8')
    expect(written).toMatch(/\bresearch:/)
    expect(written).not.toMatch(/\bdistillation:/)
  })

  it('数值越界被裁剪', async () => {
    const dir = freshAppDir()
    const yaml = ['storyboard:', '  scene_threshold: 5', 'research:', '  video_concurrency: 99'].join('\n')
    fs.writeFileSync(path.join(dir, 'config.yaml'), yaml, 'utf-8')
    const cfg = await loadConfig()
    expect(cfg.storyboard.scene_threshold).toBeLessThanOrEqual(1)
    expect(cfg.storyboard.scene_threshold).toBeGreaterThan(0)
    expect(cfg.research.video_concurrency).toBeLessThanOrEqual(4)
  })
})
