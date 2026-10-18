/**
 * 暴露在 window.v2s 上的 IPC API 类型声明
 */
import type { ResearchApi, V2sApi } from '@shared/api-types'

declare global {
  interface Window {
    v2s: V2sApi & { research: ResearchApi }
  }
}

export const api = (): V2sApi & { research: ResearchApi } => window.v2s
