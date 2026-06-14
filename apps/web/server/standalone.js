// @ts-check
/**
 * Self-contained production server entry — the esbuild bundle target.
 *
 * Unlike `index.js` (which dynamic-imports the built SSR handler at runtime and
 * therefore needs node_modules on disk), this statically imports it so esbuild
 * pulls the SSR handler, its route chunks and every npm dependency into a single
 * `dist/standalone/server.mjs`. That bundle is what the packaged Electron app
 * ships and forks — no node_modules required.
 *
 *   node scripts/bundle-server.mjs   # produces dist/standalone/server.mjs
 *
 * The static client assets still load from disk: the bundle lives at
 * dist/standalone/server.mjs, so dist/client is `../client` relative to it, a
 * layout preserved when electron-builder copies it into resources/web/dist.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved at bundle time from this file's location (apps/web/server) —
// esbuild inlines the whole SSR handler and its dependency graph.
import app from '../dist/server/server.js'

import { startServer } from './serve-app.js'

const here = dirname(fileURLToPath(import.meta.url))
startServer({ app, clientDir: join(here, '..', 'client') })
