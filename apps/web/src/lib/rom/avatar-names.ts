/**
 * Pure naming logic for stored avatar files (no I/O — the fs lives in
 * api/avatars.ts). Avatars live in a project's `.dcsmeta/images` as
 * `<id>--<kind>-<ts>.<ext>`:
 *   - `id`   = the character id (a folder name; may contain single dashes/dots),
 *   - `kind` = `up` (a user upload cropped in the editor) or `sc` (a snapshot of
 *              a Daz scene's tip thumbnail — always re-derivable from the scene),
 *   - `ts`   = a millisecond timestamp making each write a NEW filename, so the
 *              stored reference changes whenever the image does (a fixed name
 *              would look unchanged and keep showing the cached old image).
 * The DOUBLE dash marks where the metadata suffix starts, so the id parses
 * cleanly even when it contains single dashes.
 *
 * Retention (see {@link avatarsToPrune}): the newest {@link AVATAR_UPLOAD_HISTORY}
 * uploads are kept as a rolling history the dialog offers for re-selection, so
 * switching to a scene avatar (or another upload) no longer discards the last
 * one; scene snapshots keep only the newest (they cost a scene read to rebuild,
 * never a user's original).
 */

/** How many past uploads to keep per character (the dialog's recent gallery). */
export const AVATAR_UPLOAD_HISTORY = 6

export type AvatarKind = 'up' | 'sc'

export interface ParsedAvatar {
  id: string
  kind: AvatarKind
  ts: number
  ext: string
}

const NAME_RE = /^(.+)--(up|sc)-(\d+)\.([a-z0-9]+)$/i

/** Build a stored avatar filename. */
export function avatarFileName(id: string, kind: AvatarKind, ts: number, ext: string): string {
  return `${id}--${kind}-${ts}.${ext}`
}

/** Parse a stored avatar filename, or null when it isn't one (external URLs,
 *  legacy `<id>-<ts>.<ext>` names, unrelated files). */
export function parseAvatarName(fileName: string): ParsedAvatar | null {
  const m = NAME_RE.exec(fileName)
  if (!m) return null
  return { id: m[1], kind: m[2].toLowerCase() as AvatarKind, ts: Number(m[3]), ext: m[4] }
}

/**
 * The character id a stored avatar filename belongs to — for relating a
 * character's variants (cache eviction, delete). Falls back to the legacy
 * `<id>-<ts>.<ext>` scheme, then to the name itself.
 */
export function avatarIdOf(fileName: string): string {
  return parseAvatarName(fileName)?.id ?? fileName.replace(/-\d+\.[^.]+$/, '')
}

/** A character's UPLOAD filenames, newest first (for the dialog gallery). */
export function uploadsNewestFirst(fileNames: Array<string>, id: string): Array<string> {
  return fileNames
    .map((name) => ({ name, p: parseAvatarName(name) }))
    .filter((e): e is { name: string; p: ParsedAvatar } => e.p?.kind === 'up' && e.p.id === id)
    .sort((a, b) => b.p.ts - a.p.ts)
    .map((e) => e.name)
}

/**
 * Which of a character's avatar files to DELETE after a write: keep the newest
 * {@link AVATAR_UPLOAD_HISTORY} uploads and the newest scene snapshot; prune the
 * rest — but NEVER `activeKeep` (the just-written / currently-referenced file),
 * and never files this scheme doesn't recognize (legacy names are left intact
 * rather than risk deleting a still-referenced avatar we can't classify).
 * `.src` siblings (see {@link avatarSourceName}) don't parse as avatars, so
 * they're invisible here — they're pruned in tandem with their master instead
 * (see api/avatars.ts), keeping the store bounded.
 */
export function avatarsToPrune(
  fileNames: Array<string>,
  id: string,
  activeKeep: string,
): Array<string> {
  const mine = fileNames
    .map((name) => ({ name, p: parseAvatarName(name) }))
    .filter((e): e is { name: string; p: ParsedAvatar } => e.p?.id === id)
  const keep = new Set<string>([activeKeep])
  for (const kind of ['up', 'sc'] as const) {
    const limit = kind === 'up' ? AVATAR_UPLOAD_HISTORY : 1
    mine
      .filter((e) => e.p.kind === kind)
      .sort((a, b) => b.p.ts - a.p.ts)
      .slice(0, limit)
      .forEach((e) => keep.add(e.name))
  }
  return mine.map((e) => e.name).filter((name) => !keep.has(name))
}

/**
 * The PRISTINE-SOURCE sibling of a stored master: `<name>.<ext>` →
 * `<name>.src.<ext>`. Written when an UPLOAD's master gets upscaled in place —
 * the upscale replaces the user's original and nothing else holds a copy — so
 * the master can always be re-derived by the CURRENT pipeline. Scene avatars
 * store no sibling: their pristine 256² tip always sits beside the linked/copied
 * scene. `.src` names deliberately do NOT parse as avatars
 * ({@link parseAvatarName} needs digits before the extension), so they never
 * show up in the gallery or the master-retention logic.
 */
export function avatarSourceName(masterName: string): string {
  return masterName.replace(/\.([a-z0-9]+)$/i, '.src.$1')
}

/** The master a `.src` sibling belongs to (`<name>.src.<ext>` → `<name>.<ext>`),
 *  or null when `fileName` isn't a source sibling. */
export function avatarSourceMaster(fileName: string): string | null {
  const m = /^(.+)\.src\.([a-z0-9]+)$/i.exec(fileName)
  return m ? `${m[1]}.${m[2]}` : null
}

/** The `.src` siblings to DELETE: every source file whose master is no longer in
 *  `fileNames` (pruned by {@link avatarsToPrune}, or gone earlier). Keeps each
 *  source exactly as long as its master lives. */
export function orphanedAvatarSources(fileNames: Array<string>): Array<string> {
  const present = new Set(fileNames)
  return fileNames.filter((name) => {
    const master = avatarSourceMaster(name)
    return master !== null && !present.has(master)
  })
}
