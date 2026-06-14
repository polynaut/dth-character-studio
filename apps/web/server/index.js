// @ts-check
/**
 * Production server entry for the standalone web app — and the run-from-source
 * path the Electron shell can boot when node_modules is present. It dynamic-
 * imports the built TanStack Start `fetch` handler and serves it via the shared
 * core in serve-app.js.
 *
 *   pnpm --filter @dth/web build   # produces dist/client + dist/server/server.js
 *   node server/index.js           # serves it on $PORT (default 4330)
 *
 * Honors $PORT, $HOST and $DTH_DATA_DIR (see src/server/paths.ts). The packaged
 * Electron app instead forks the flat esbuild bundle (dist/standalone/server.mjs,
 * see standalone.js) so it needs no node_modules on disk.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { startServer } from './serve-app.js'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', 'dist')
const serverEntry = join(distDir, 'server', 'server.js')

/** The built SSR handler — a web-standard `{ fetch }` object. */
const app = /** @type {{ fetch: (request: Request) => Response | Promise<Response> }} */ (
  (await import(pathToFileURL(serverEntry).href)).default
)

startServer({ app, clientDir: join(distDir, 'client') })
