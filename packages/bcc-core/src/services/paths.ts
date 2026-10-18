/**
 * 数据根 / 沙盒判定。
 * 数据根的实际解析已下沉到 core/runtime（由各宿主注入）；本文件保留 getDataRoot 的转出
 * 与 isSandboxed（仅读 process.mas，无 electron 依赖），让 services 层继续 import './paths.js'。
 */
export { getDataRoot } from '../runtime.js'

/** 是否运行在 Mac App Store 沙盒中（Electron 在 MAS 构建里会把 process.mas 置为 true）。仅读 process 属性。 */
export function isSandboxed(): boolean {
  return (process as unknown as { mas?: boolean }).mas === true
}
