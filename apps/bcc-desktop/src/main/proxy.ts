/**
 * Electron 系统代理解析器：基于 session.resolveProxy 读取 PAC / WPAD / IE 设置。
 * 在 main 启动时通过 setProxyResolver 注入给 core/runtime，供 gemini 的 installGlobalFetch 使用。
 * 纯 Node CLI 不注入此实现，gemini 会回退到环境变量（HTTPS_PROXY）。
 *
 * session.resolveProxy 返回 "DIRECT" / "PROXY host:port" / "HTTPS host:port" / "SOCKS5 ...; ..."，
 * 这里只取第一个 entry 并转成 undici ProxyAgent 可识别的 URL。
 */
import { session } from 'electron'

export async function electronProxyResolver(url: string): Promise<string | null> {
  try {
    const s = session.defaultSession
    if (!s) return null
    const result = await s.resolveProxy(url)
    const first = result.split(';')[0].trim()
    if (first === 'DIRECT' || !first) return null
    const [scheme, hostport] = first.split(/\s+/, 2)
    if (!hostport) return null
    switch (scheme.toUpperCase()) {
      case 'PROXY':
      case 'HTTP':
        return 'http://' + hostport
      case 'HTTPS':
        return 'https://' + hostport
      // SOCKS / SOCKS5：undici ProxyAgent 不支持，告知 fallback 直连
      default:
        console.warn('[proxy] 系统代理协议不被支持:', scheme)
        return null
    }
  } catch (err) {
    console.warn('[proxy] electronProxyResolver 失败:', err)
    return null
  }
}
