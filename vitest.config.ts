import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 与源码一致的路径别名；service 层用 `./x.js` 指向 `.ts`，Vite 会自动回退解析。
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('packages/bcc-core/src/shared'),
      '@core': resolve('packages/bcc-core/src'),
      '@main': resolve('apps/bcc-desktop/src/main'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
