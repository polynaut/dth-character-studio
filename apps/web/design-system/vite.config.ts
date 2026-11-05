import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// fixtures.ts reads files with node:fs, so the seed is built on the Node side.
const seedEndpoint = (): Plugin => ({
  name: 'dth-ds-seed',
  configureServer(server) {
    server.middlewares.use('/__seed', (req, res) => {
      const opts = new URL(req.url ?? '', 'http://x').searchParams.get('opts') ?? '{}'
      server
        .ssrLoadModule('/@fs' + here('../smoke/fixtures.ts'))
        .then((m) => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(m.buildSeed(JSON.parse(opts))))
        })
        .catch((e: unknown) => {
          res.statusCode = 500
          res.end(e instanceof Error ? e.stack : String(e))
        })
    })
  },
})

export default defineConfig({
  root: here('.'),
  publicDir: here('../public'),
  plugins: [tailwindcss(), viteReact(), seedEndpoint()],
  server: { port: 4334, strictPort: true, fs: { allow: [here('../../..')] } },
})
