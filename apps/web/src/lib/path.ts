import { isTauri } from '@tauri-apps/api/core'
import { sep } from '@tauri-apps/api/path'

// Resolved once, lazily: the OS path separator (`\` on Windows, `/` elsewhere).
// `sep()` reads Tauri's injected metadata synchronously — but outside the Tauri
// runtime (e.g. `pnpm dev:web` in a plain browser) it isn't available, so we
// fall back to `/`.
let cachedSep: string | null = null

/** The OS path separator (`\` on Windows, `/` elsewhere), resolved lazily. */
export function pathSeparator(): string {
  if (cachedSep == null) cachedSep = isTauri() ? sep() : '/'
  return cachedSep
}

/**
 * Canonicalize a path for comparison: collapse every run of `/` or `\` to a
 * single `/` and drop any trailing separator. Use it when comparing whether one
 * path sits inside another regardless of how each was stored (the frontend mixes
 * separators freely). Not for display — use {@link displayPath} for that.
 */
export function normalizePath(path: string): string {
  return path.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
}

/** {@link normalizePath} plus lower-casing, for case-insensitive path compares
 *  (Windows semantics). */
export function normalizePathLower(path: string): string {
  return normalizePath(path).toLowerCase()
}

/**
 * The parent directory of a path, {@link normalizePath}-normalized ('/'-joined,
 * runs collapsed, no trailing separator) — THE one copy of the
 * `normalizePath(p).replace(/\/[^/]*$/, '')` idiom that used to be inlined
 * across the scene/Houdini/export fields. Distinct from {@link dirOf}
 * (storage's dirname), which does not collapse separator runs — use `parentDir`
 * whenever the result is compared against other normalized paths.
 */
export function parentDir(path: string): string {
  return normalizePath(path).replace(/\/[^/]*$/, '')
}

/** Everything but the last path segment ('/'-joined) — e.g. the folder of a
 *  `.dcsp` file. A re-export of the single dirname implementation in
 *  storage/fs.ts (this, api/core's dirname and storage's dirname used to be
 *  three drifting copies). */
export { dirname as dirOf } from './rom/storage/fs'

/**
 * Normalize a filesystem path for display: rewrite every `/` or `\` to the
 * current OS separator. Backend paths come back with the OS separator, but
 * anywhere the frontend joins or splits them we end up with a wild mix — run
 * displayed paths through this so the UI is always consistent. Each separator
 * is replaced individually (runs are not collapsed) to preserve leading UNC
 * `\\server\share` prefixes on Windows.
 */
export function displayPath(path: string): string {
  if (!path) return path
  return path.replace(/[/\\]/g, pathSeparator())
}
