/**
 * Pure helpers for the user-owned character library (no Tauri imports, so they
 * unit-test cleanly — mirrors ./image).
 *
 * Each character lives in its own folder inside the library, named after the
 * character (`<library>/<Name>/`), holding the definition `<Name>.json` plus its
 * generated artifacts. A "custom path" relocates that folder into subfolders of
 * the library. Discovery is a recursive scan (no registry), so a folder's
 * location simply *is* the character's location.
 */

// Characters Windows forbids in a path segment, plus control chars.
const ILLEGAL_SEGMENT_CHARS = /[\\/:*?"<>|\x00-\x1f]/
// Same set minus the slash, for stripping when deriving a name from free text.
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Filesystem-safe folder/file base name for a character, preserving case and
 * spaces. Strips path-illegal characters, collapses whitespace, trims trailing
 * dots/spaces (Windows rejects those), avoids reserved device names, and falls
 * back to 'Character' when nothing usable remains. Distinct from
 * `characterSlug` (which strips everything and names the generated `<slug>_*`
 * files).
 */
export function characterFolderName(name: string): string {
  let base = (name ?? '')
    .replace(ILLEGAL_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '') // no trailing dot/space
    .trim()
  if (!base) return 'Character'
  if (WIN_RESERVED.test(base)) base = `${base}_`
  return base
}

/** Definition filename for a character: `<folder name>.json`. */
export function definitionFileName(name: string): string {
  return `${characterFolderName(name)}.json`
}

/**
 * Validate + normalise a user-entered folder path relative to the library root.
 * Returns a clean '/'-separated relative path. Throws on anything that could
 * escape the library (absolute paths, drive letters, `..` segments) or that
 * contains a path-illegal character.
 */
export function normalizeRelPath(relPath: string): string {
  const raw = (relPath ?? '').trim()
  if (!raw) throw new Error('Path is empty.')
  if (/^([a-zA-Z]:|[\\/])/.test(raw)) {
    throw new Error('Use a path relative to the library folder, not an absolute path.')
  }
  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
  if (segments.length === 0) throw new Error('Path is empty.')
  for (const segment of segments) {
    if (segment === '..') throw new Error('Path cannot step outside the library folder ("..").')
    if (ILLEGAL_SEGMENT_CHARS.test(segment)) {
      throw new Error(`Illegal character in path segment: "${segment}"`)
    }
    if (/[. ]$/.test(segment)) {
      throw new Error(`Path segment cannot end with a dot or space: "${segment}"`)
    }
  }
  return segments.join('/')
}
