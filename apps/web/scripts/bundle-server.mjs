// @ts-check
/**
 * Bundle the production SSR server + every npm dependency it pulls in
 * (react, react-dom/server, @tanstack/*, srvx, …) into a single self-contained
 * file: dist/standalone/server.mjs.
 *
 * Why: pnpm's symlinked node_modules don't copy cleanly into an Electron
 * resources/ folder, so the packaged app can't rely on them at runtime. A flat
 * esbuild bundle sidesteps the whole problem. Run after `vite build` (it reads
 * dist/server/server.js).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [join(root, 'server', 'standalone.js')],
  outfile: join(root, 'dist', 'standalone', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'bundle', // inline node_modules deps rather than leaving them external
  legalComments: 'none',
  logLevel: 'info',
  // Some bundled CJS deps call require()/__dirname; provide them in ESM output.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
})

console.log('[bundle-server] wrote dist/standalone/server.mjs')
