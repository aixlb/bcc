/**
 * 分镜图片理解默认 Prompt 的兼容出口。
 *
 * 唯一编辑源位于 shared/defaults，供主进程、渲染端设置页和 CLI 共用，
 * 避免这里残留另一份输出契约。
 */
export {
  STORYBOARD_DEFAULT_ANALYSIS_PROMPT,
  STORYBOARD_DEFAULT_PROMPT,
  STORYBOARD_OUTPUT_CONTRACT,
} from '@shared/defaults.js'
