import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('apps/bcc-desktop/src/main'),
        '@shared': resolve('packages/bcc-core/src/shared'),
        '@core': resolve('packages/bcc-core/src'),
      },
    },
    build: {
      outDir: resolve('out/main'),
      rollupOptions: {
        input: resolve('apps/bcc-desktop/src/main/index.ts'),
        external: ['ffmpeg-static', 'ffprobe-static', 'fluent-ffmpeg'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('packages/bcc-core/src/shared'),
      },
    },
    build: {
      outDir: resolve('out/preload'),
      rollupOptions: {
        input: resolve('apps/bcc-desktop/src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: 'apps/bcc-desktop/src/renderer',
    resolve: {
      alias: {
        '@': resolve('apps/bcc-desktop/src/renderer/src'),
        '@shared': resolve('packages/bcc-core/src/shared'),
      },
    },
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      port: 5173,
    },
    build: {
      outDir: resolve('out/renderer'),
      rollupOptions: {
        input: resolve('apps/bcc-desktop/src/renderer/index.html'),
      },
    },
  },
})
