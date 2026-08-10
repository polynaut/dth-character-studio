import { isTauri } from '@tauri-apps/api/core'
import { sep } from '@tauri-apps/api/path'

import { stripTrailingSeparators } from './path-trim.ts'

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
  return stripTrailingSeparators(path.replace(/[\\/]+/g, '/'))
}

// The linear trims live in a LEAF module (no imports) so the storage layer can
// use them too — this file imports storage, so re-homing them here would be a
// cycle. Re-exported for the many callers that already reach for `lib/path.ts`.
export { stripTrailingDotsAndSpaces, stripTrailingSeparators, trimSeparators } from './path-trim.ts'

/** {@link normalizePath} plus lower-casing, for case-insensitive path compares
 *  (Windows semantics). */
export function normalizePathLower(path: string): string {
  return normalizePath(path).toLowerCase()
}

/**
 * Whether a path still contains a parent-traversal (`..`) segment after
 * {@link normalizePath}. Destructive code that judges containment with a plain
 * prefix compare MUST refuse such paths outright: normalization collapses
 * separators but never resolves dot segments, so `a/b/../../victim` passes a
 * `startsWith('a/')` test while pointing outside `a/`. Stored paths from the
 * app's own pickers are always resolved — a surviving `..` only ever comes from
 * hand-edited or hostile data, exactly what the refusal is for.
 */
export function hasParentTraversal(path: string): boolean {
  return normalizePath(path).split('/').includes('..')
}

/**
 * The extra-scene list with `primary` removed (case-/separator-insensitively). A
 * scene is linked to a character at most once, so when a path becomes the PRIMARY it
 * must drop out of the extras. Without this, relinking the primary to an
 * already-linked scene leaves it in BOTH lists — the scene then shows as two cards
 * and its duplicated path collides the scene-footer's per-path React `key` and
 * `view-transition-name`.
 */
export function extrasWithoutPrimary(extraScenes: Array<string>, primary: string): Array<string> {
  const key = normalizePathLower(primary)
  return extraScenes.filter((scene) => normalizePathLower(scene) !== key)
}

/**
 * Where a native Browse dialog should OPEN — the one rule every picker in the
 * app uses: the folder (or file) the field ALREADY holds, and failing that the
 * closest thing that makes sense, which each caller supplies in preference
 * order. `undefined` means "nothing sensible", leaving it to the OS — which is
 * what every dialog did unconditionally before: browsing for the Houdini
 * documents folder opened at nowhere even though the field named the exact
 * path, and re-picking a linked scene started from scratch every time.
 *
 * Pass a FILE path where one is known (`pickHipPath` and friends): the native
 * dialog opens at its folder with that file preselected, which beats the folder
 * alone.
 *
 * Candidates are tried in order and blanks are skipped, so a call reads as its
 * own fallback chain: `browseStart(value, characterFolder, dazLibrary)`.
 */
export function browseStart(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const value = (candidate ?? '').trim()
    if (!value) continue
    // normalizePath collapses separator runs, which would strip a UNC
    // `\\server\share` prefix down to rootless `/server/share` — the dialog
    // plugin rebuilds the path via PathBuf components, turning that into a
    // drive-relative `\server\share` whose SetFolder silently fails. Same
    // preservation rule as displayPath: keep the leading double separator.
    const normalized = normalizePath(value)
    return /^[\\/]{2}/.test(value) ? `/${normalized}` : normalized
  }
  return undefined
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
  const parent = normalizePath(path).replace(/\/[^/]*$/, '')
  // A bare drive letter is DRIVE-RELATIVE on Windows (`D:` = "the current
  // directory on D:", wherever that is) — hand back the actual root instead.
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent
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

/**
 * Middle-ellipsis a DISPLAY path down to at most `max` characters: the path's
 * start stays visible and the file name at the end always survives whole
 * (truncated from its own start only when it alone exceeds the budget). A path
 * that FITS is returned untouched; once truncation kicks in, `maxHead` caps
 * the shown start (e.g. 8 → "D:\Unrea…\Name"), keeping the budget for the
 * file name. Meant for fixed-width monospace chips (e.g. the Unreal cards),
 * where a constant character budget makes every chip the same width.
 */
export function middleTruncatePath(
  path: string,
  max: number,
  maxHead: number = Number.POSITIVE_INFINITY,
): string {
  if (path.length <= max) return path
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  const tail = cut >= 0 ? path.slice(cut) : path
  if (tail.length >= max - 1) return `…${tail.slice(-(max - 1))}`
  const head = Math.min(max - 1 - tail.length, maxHead)
  return `${path.slice(0, head)}…${tail}`
}
