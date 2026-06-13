// @ts-check
/**
 * Production server entry for the standalone web app — and the exact same entry
 * the Electron shell boots as a child process. It binds the built TanStack
 * Start `fetch` handler to a real HTTP port (via srvx) and serves the static
 * client assets in front of it.
 *
 *   pnpm --filter @dth/web build   # produces dist/client + dist/server/server.js
 *   node server/index.js           # serves it on $PORT (default 4330)
 *
 * Honors $PORT, $HOST and $DTH_DATA_DIR (see src/server/paths.ts).
 */
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { serve } from 'srvx'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', 'dist')
const clientDir = join(distDir, 'client')
const serverEntry = join(distDir, 'server', 'server.js')

const port = Number(process.env.PORT) || 4330
const hostname = process.env.HOST || '127.0.0.1'

/** The built SSR handler — a web-standard `{ fetch }` object. */
const app = /** @type {{ fetch: (request: Request) => Response | Promise<Response> }} */ (
  (await import(pathToFileURL(serverEntry).href)).default
)

/** @type {Record<string, string>} */
const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Serve a file out of dist/client if (and only if) the path maps to a real
 * file there. Anything else returns null so the SSR handler takes over —
 * routes like `/`, `/settings`, `/api/...` and `/_serverFn/...` are never files.
 * @param {string} pathname
 * @returns {Promise<Response | null>}
 */
async function serveStatic(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.([/\\]|$))+/, '')
  const filePath = join(clientDir, rel)
  if (filePath !== clientDir && !filePath.startsWith(clientDir + sep)) return null
  try {
    if (!(await stat(filePath)).isFile()) return null
  } catch {
    return null
  }
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const body = await readFile(filePath)
  return new Response(body, {
    headers: {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    },
  })
}

serve({
  port,
  hostname,
  async fetch(request) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await serveStatic(new URL(request.url).pathname)
      if (asset) return asset
    }
    return app.fetch(request)
  },
})

console.log(`[dth-web] listening on http://${hostname}:${port}`)
