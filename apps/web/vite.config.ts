import { defineConfig } from 'vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Client-rendered SPA (no SSR) — the desktop app is a Tauri shell, and the
// standalone web build is a static bundle. File I/O lives in the Tauri plugins
// (see src/lib/rom/api.ts), not in a Node server.
const config = defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
  ],
})

export default config
