import { isTauri } from '@tauri-apps/api/core'
import { sep } from '@tauri-apps/api/path'

// Resolved once, lazily: the OS path separator (`\` on Windows, `/` elsewhere).
// `sep()` reads Tauri's injected metadata synchronously — but outside the Tauri
// runtime (e.g. `pnpm dev:web` in a plain browser) it isn't available, so we
// fall back to `/`.
let cachedSep: string | null = null
function osSep(): string {
  if (cachedSep == null) cachedSep = isTauri() ? sep() : '/'
  return cachedSep
}

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
  return path.replace(/[/\\]/g, osSep())
}
