import { exists, mkdir, readDir, remove, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs'

// Shared path + filesystem primitives used across the storage modules.
// THE single copy of join/basename/dirname — api/core.ts re-exports them
// (joinPath/basename/dirname) and lib/path.ts re-exports dirname as dirOf, so
// the three parallel implementations that used to drift are gone.

/**
 * Join path segments with '/', normalising any '\' to '/'. A consistent
 * forward-slash path matters for the Tauri fs *scope* check: a not-yet-existing
 * path can't be canonicalised, so the raw string is matched against the `**`
 * scope — and a mixed-separator string (e.g. `X:\proj/New`) fails to match.
 */
export function join(...parts: Array<string>): string {
  return parts
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

/**
 * If `child` lives inside `parent`, return its path relative to `parent`
 * ('/'-joined); otherwise null. Separator-agnostic and case-insensitive (matches
 * Windows semantics), so it works regardless of how either path was stored.
 */
export function relativeInside(parent: string, child: string): string | null {
  const segs = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean)
  const p = segs(parent)
  const c = segs(child)
  if (c.length <= p.length) return null
  for (let i = 0; i < p.length; i++) {
    if (c[i].toLowerCase() !== p[i].toLowerCase()) return null
  }
  return c.slice(p.length).join('/')
}

/** Last path segment (folder or file name). */
export function basename(p: string): string {
  return p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? p
}

/** Everything but the last path segment ('/'-joined). The result is
 *  forward-slashed deliberately: the api layer joins it onward with `join`
 *  (which normalises anyway) and compares against '/'-joined paths — the old
 *  storage copy that kept backslashes was the one divergence between the three
 *  parallel dirname implementations. */
export function dirname(p: string): string {
  const norm = p.replace(/[\\/]+$/g, '')
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return idx >= 0 ? norm.slice(0, idx).replace(/\\/g, '/') : norm
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory
  } catch {
    return false
  }
}

/**
 * Whether `path` already exists — or can't be confirmed absent. Tauri's `exists`
 * *throws* (rather than returning false) for a path it can't canonicalize for
 * the fs scope check, e.g. a locked / delete-pending folder on a network share.
 * Treat that as taken so callers skip the name instead of crashing.
 */
export async function isTaken(path: string): Promise<boolean> {
  try {
    return await exists(path)
  } catch {
    return true
  }
}

/**
 * First folder name under `parent` that isn't taken (`Name`, `Name (2)`, …).
 * A pre-existing folder — including one that's locked / mid-delete and so can't
 * even be probed — just bumps the numeric suffix. Capped so a wholly
 * inaccessible parent fails loudly instead of spinning forever.
 */
export async function uniqueFolder(parent: string, baseName: string): Promise<string> {
  for (let i = 1; i <= 9999; i++) {
    const candidate = i === 1 ? baseName : `${baseName} (${i})`
    const abs = join(parent, candidate)
    if (!(await isTaken(abs))) return abs
  }
  throw new Error(`Could not find a free folder name for "${baseName}" in ${parent}.`)
}

/**
 * Recursively collect file paths (relative to `root`, '/'-separated). `skipDir`,
 * when given, prunes a subtree by directory name — the character scan uses it to
 * skip the app's own non-definition folders (`.dcsmeta` with its up-to-100MB
 * media, `.assets`), which otherwise get fully walked (one readDir IPC per
 * directory) on every project-page navigation, badly on a network share.
 */
export async function walkFiles(
  root: string,
  rel = '',
  skipDir?: (name: string) => boolean,
): Promise<Array<string>> {
  const here = rel ? join(root, rel) : root
  let listing: Awaited<ReturnType<typeof readDir>>
  try {
    listing = await readDir(here)
  } catch (err) {
    // A locked, permission-restricted, or delete-pending folder (common on
    // network shares — e.g. a directory whose delete is still pending because a
    // handle stays open) makes readDir throw. Tauri even reports it as a
    // "forbidden path" because it can't canonicalize the path for its scope
    // check. Skip the subtree so one unreadable folder can't blank the whole
    // library overview.
    console.warn(`Skipping unreadable folder ${here}: ${String(err)}`)
    return []
  }
  const out: Array<string> = []
  for (const entry of listing) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      if (skipDir?.(entry.name)) continue
      out.push(...(await walkFiles(root, childRel, skipDir)))
    } else out.push(childRel)
  }
  return out
}

/**
 * STRICT variant of {@link walkFiles}: any unreadable directory ABORTS the walk
 * (the readDir error propagates) instead of being skipped. Use it when the
 * caller needs a COMPLETE listing to act safely — e.g. the note-media GC builds
 * its "still referenced" set from every notes file; a silently skipped subtree
 * would make referenced media look orphaned and get deleted.
 */
export async function walkFilesStrict(
  root: string,
  rel = '',
  skipDir?: (name: string) => boolean,
): Promise<Array<string>> {
  const here = rel ? join(root, rel) : root
  const listing = await readDir(here)
  const out: Array<string> = []
  for (const entry of listing) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      if (skipDir?.(entry.name)) continue
      out.push(...(await walkFilesStrict(root, childRel, skipDir)))
    } else out.push(childRel)
  }
  return out
}

/**
 * Durably replace a text file: write the content to a temp file in the SAME
 * directory, then rename it over the target — a crash or lost network share
 * mid-write can no longer leave a half-written (torn) file where a good one
 * stood. `std::fs::rename` (what the Tauri fs plugin calls) replaces an
 * existing file on Windows too; if that still fails (target locked by a sync
 * tool / AV scan), retry via remove+rename and, as the last resort, fall back
 * to a plain write so the save itself is never lost. The temp name ends in
 * `.tmp` (never `.json`), so the character scan can't pick a temp file up.
 */
export async function writeTextFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}.tmp`
  await writeTextFile(tmp, content)
  try {
    await rename(tmp, path)
  } catch {
    try {
      if (await exists(path)) await remove(path)
      await rename(tmp, path)
    } catch {
      // Non-atomic fallback — if even this write throws, the error surfaces to
      // the caller and the temp file (with the full payload) is left behind.
      await writeTextFile(path, content)
      try {
        await remove(tmp)
      } catch {
        // a stray .tmp file is harmless
      }
    }
  }
}

/** Writes files into a folder, creating it if missing. */
export async function writeFilesToFolder(
  folder: string,
  files: Array<{ fileName: string; content: string }>,
): Promise<void> {
  await mkdir(folder, { recursive: true })
  await Promise.all(files.map((file) => writeTextFile(join(folder, file.fileName), file.content)))
}

/** Remove the named files from a folder if present (no error when missing). */
export async function removeFilesFromFolder(
  folder: string,
  fileNames: Array<string>,
): Promise<void> {
  for (const name of fileNames) {
    const path = join(folder, name)
    if (await exists(path)) await remove(path)
  }
}
