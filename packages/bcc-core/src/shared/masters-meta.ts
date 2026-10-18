/**
 * 本文件由 scripts/gen-masters.mjs 生成（源：methods/ 大师清单），不要手改。
 * 改动 methods/ 或大师清单后运行：npm run gen:masters
 */

/** 剧本大师元数据（GUI 下拉 / CLI --master 校验 / 设置页「编剧大师」展示用） */
export interface ScriptMasterMeta {
  id: string
  name: string
  description: string
  /** 入驻作者展示名，如 '@山音' */
  author: string
  /** 作者 GitHub 主页/仓库 */
  github: string
  /** 作者小红书主页 */
  xiaohongshu: string
  /** 悬停推广文案 */
  promo: string
}

/** 内置剧本大师（'' 或 'default' = 默认，不在此列） */
export const BUILTIN_MASTERS: ScriptMasterMeta[] = [
  {
    "id": "shanzhiyin",
    "name": "山之音",
    "description": "导演方法论：叙事目的分析 / 节奏规划 / 镜头设计",
    "author": "@山音",
    "github": "https://github.com/Shanyin-ai/shanyin-screenwriting-master",
    "xiaohongshu": "https://www.xiaohongshu.com/user/profile/61920f2f000000001000b970",
    "promo": "联系山音，可以购买专业级的剧本解析方案！"
  }
]
