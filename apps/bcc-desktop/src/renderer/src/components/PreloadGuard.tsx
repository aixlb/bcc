import { useState, useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * 检查 window.v2s 是否就绪（preload 是否成功加载）。
 * 如果没有，显示明确的错误界面而不是让组件树崩溃。
 */
export function PreloadGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.v2s)

  useEffect(() => {
    if (ready) return
    // 给 contextBridge 一点时间（有些场景下 preload 还没注入完）
    const interval = setInterval(() => {
      if (window.v2s) {
        setReady(true)
        clearInterval(interval)
      }
    }, 100)
    const timeout = setTimeout(() => clearInterval(interval), 5000)
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [ready])

  if (ready) return <>{children}</>

  return (
    <div className="flex h-full items-center justify-center bg-ink-950 p-8">
      <div className="glass-panel max-w-lg rounded-xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-full bg-red-500/10 p-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <h2 className="text-lg font-medium text-zinc-100">Preload 脚本未加载</h2>
        </div>
        <p className="mb-3 text-sm text-zinc-400">
          <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-xs text-amber-300">
            window.v2s
          </code>{' '}
          未定义，说明 Electron 主进程没能加载 preload 脚本。所有 IPC 调用都会失败。
        </p>
        <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3 text-xs text-zinc-500">
          <div className="mb-1 font-medium text-zinc-300">常见原因：</div>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              main 进程引用的 preload 路径与实际产物扩展名不匹配（.js vs .mjs）
            </li>
            <li>preload 编译失败（看终端 vite 输出）</li>
            <li>contextIsolation 配置错误</li>
          </ul>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={() => location.reload()}
            className="btn-ghost flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      </div>
    </div>
  )
}
