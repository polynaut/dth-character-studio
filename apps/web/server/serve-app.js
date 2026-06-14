// @ts-check
/**
 * Shared production serving core — used by both `server/index.js` (run from
 * source, dynamic-imports the built SSR handler) and `server/standalone.js`
 * (the esbuild bundle entry, statically imports it). Keeping the srvx wiring,
 * the MIME table and the static-file logic here means there's exactly one copy.
 */
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'

import { serve } from 'srvx'

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
 * Serve a file out of `clientDir` if (and only if) the path maps to a real
 * file there. Anything else returns null so the SSR handler takes over —
 * routes like `/`, `/settings`, `/api/...` and `/_serverFn/...` are never files.
 * @param {string} clientDir
 * @param {string} pathname
 * @returns {Promise<Response | null>}
 */
async function serveStatic(clientDir, pathname) {
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

/**
 * Bind the built TanStack Start `fetch` handler to a real HTTP port, serving
 * the static client assets in front of it. Honors $PORT and $HOST.
 * @param {object} options
 * @param {{ fetch: (request: Request) => Response | Promise<Response> }} options.app The built SSR handler.
 * @param {string} options.clientDir Absolute path to the built `dist/client` assets.
 */
export function startServer({ app, clientDir }) {
  const port = Number(process.env.PORT) || 4330
  const hostname = process.env.HOST || '127.0.0.1'

  serve({
    port,
    hostname,
    async fetch(request) {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const asset = await serveStatic(clientDir, new URL(request.url).pathname)
        if (asset) return asset
      }
      return app.fetch(request)
    },
  })

  console.log(`[dth-web] listening on http://${hostname}:${port}`)
}
