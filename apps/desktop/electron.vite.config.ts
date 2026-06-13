import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * Main + preload only. There is no renderer build: the renderer IS the web app,
 * which the main process loads from its own dev server (dev) or its own bundled
 * production server (packaged). electron-vite auto-detects src/main/index.ts and
 * src/preload/index.ts → out/main/index.js and out/preload/index.js.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
})
