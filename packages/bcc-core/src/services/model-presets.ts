/**
 * 模型预设的读盘 + 合并：内置默认（@shared/model-presets）+ 数据目录下的 models.json。
 * 与 config.yaml 同目录，用户可手动编辑，免升级即可增删 GUI 模型下拉项。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  BUILTIN_MODEL_PRESETS,
  mergeModelPresets,
  type ModelPresetMap,
} from '@shared/model-presets'
import { getDataRoot } from './paths.js'

/** models.json 路径：与 config.yaml 同目录（dataRoot 的上一级）。 */
export function getModelPresetsFilePath(): string {
  return path.join(path.dirname(getDataRoot()), 'models.json')
}

/**
 * 读取并合并模型预设。任何读取 / 解析失败都只记日志并回退内置默认，绝不抛错
 * （下拉预设不能阻塞设置页；models.json 缺失是常态）。
 */
export async function loadModelPresets(): Promise<ModelPresetMap> {
  const file = getModelPresetsFilePath()
  try {
    const raw = await fs.readFile(file, 'utf-8')
    // Windows 编辑器常以 UTF-8 BOM 保存，而 JSON.parse 会直接拒绝 BOM
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Record<string, unknown> | null
    return mergeModelPresets(BUILTIN_MODEL_PRESETS, parsed)
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error('[model-presets] 读取 models.json 失败，改用内置预设:', err?.message ?? err)
    }
    return mergeModelPresets(BUILTIN_MODEL_PRESETS, null)
  }
}
