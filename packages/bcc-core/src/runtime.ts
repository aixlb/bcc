/**
 * 框架无关运行时上下文：数据根目录与系统代理解析器的注入点。
 *
 * 这是 core/services 与宿主（Electron GUI / 纯 Node CLI / 测试）之间的唯一接缝。
 * 适配层在启动时注入实现，service 层不再直接 import electron：
 *   - GUI：注入 electron 的数据根解析 + session.resolveProxy 代理解析
 *   - CLI：注入智能优先级数据根 + 环境变量代理（resolver 留空，回退 HTTPS_PROXY）
 *   - 测试：直接 setDataRoot(临时目录)，proxy 不注入
 */

/** 宿主提供的进度接收端；Electron 的 WebContents 可直接满足该接口。 */
export interface ProgressTarget {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

let cachedDataRoot: string | null = null
let dataRootResolver: (() => string) | null = null

/**
 * 注入「惰性」数据根解析器：首次 getDataRoot() 时求值并缓存。
 * 供 GUI 注入 electron 的 app 路径解析（app 在 whenReady 后才可靠）。
 */
export function setDataRootResolver(resolver: () => string): void {
  dataRootResolver = resolver
  cachedDataRoot = null
}

/** 直接注入数据根（CLI 算好后注入 / 测试指向临时目录）。 */
export function setDataRoot(root: string): void {
  cachedDataRoot = root
}

/** 当前数据根（配置 / 项目 / 分镜 / 研究 / 日志都从这里派生）。须在任何 storage/config 调用前注入。 */
export function getDataRoot(): string {
  if (cachedDataRoot) return cachedDataRoot
  if (dataRootResolver) {
    cachedDataRoot = dataRootResolver()
    return cachedDataRoot
  }
  throw new Error('dataRoot 未初始化：请先调用 setDataRoot() 或 setDataRootResolver()')
}

/** 仅供测试：重置缓存与注入，避免用例间相互污染。 */
export function __resetRuntime(): void {
  cachedDataRoot = null
  dataRootResolver = null
  proxyResolver = null
}

/**
 * 系统代理解析器：输入目标 url，返回 undici 可识别的代理 URI（如 http://host:port）或 null（直连）。
 * GUI 注入基于 Electron session.resolveProxy 的实现（读 PAC/WPAD/IE）；CLI 不注入。
 */
export type ProxyResolver = (url: string) => Promise<string | null>

let proxyResolver: ProxyResolver | null = null

export function setProxyResolver(resolver: ProxyResolver | null): void {
  proxyResolver = resolver
}

export function getProxyResolver(): ProxyResolver | null {
  return proxyResolver
}
