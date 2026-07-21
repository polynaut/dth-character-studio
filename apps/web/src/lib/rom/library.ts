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
 * The notes file belonging to a character definition: `<Name>.json` →
 * `<Name>.notes.md`. Single source of the derivation — everything that renames,
 * moves or deletes a definition must take this file along, or the character's
 * notes are silently orphaned under the old name.
 */
export function notesPathFor(definitionPath: string): string {
  return definitionPath.replace(/\.json$/i, '.notes.md')
}

/**
 * The one validation + normalisation core behind {@link normalizeRelPath} and
 * {@link normalizeRelFolder} (they used to be near-identical twins). Returns a
 * clean '/'-separated relative path ('' for empty input). Throws on anything
 * that could escape the scope (absolute paths, drive letters, `..` segments)
 * or that contains a path-illegal character; `scopeLabel` names the scope in
 * the error messages ("library" / "project").
 */
function normalizeRel(relPath: string, scopeLabel: string): string {
  const raw = (relPath ?? '').trim()
  if (!raw) return ''
  if (/^([a-zA-Z]:|[\\/])/.test(raw)) {
    throw new Error(`Use a path relative to the ${scopeLabel} folder, not an absolute path.`)
  }
  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
  for (const segment of segments) {
    if (segment === '..') throw new Error(`Path cannot step outside the ${scopeLabel} folder ("..").`)
    if (ILLEGAL_SEGMENT_CHARS.test(segment)) {
      throw new Error(`Illegal character in path segment: "${segment}"`)
    }
    if (/[. ]$/.test(segment)) {
      throw new Error(`Path segment cannot end with a dot or space: "${segment}"`)
    }
  }
  return segments.join('/')
}

/**
 * Validate + normalise a user-entered file path relative to the library root
 * (the move-character "Path" field). Empty input throws — a file path must
 * name something.
 */
export function normalizeRelPath(relPath: string): string {
  const clean = normalizeRel(relPath, 'library')
  if (!clean) throw new Error('Path is empty.')
  return clean
}

/**
 * Validate + normalise a user-entered FOLDER path relative to the project root
 * (the create-form "Path" field and the per-project subdir settings). Returns
 * `''` for "the project root itself".
 */
export function normalizeRelFolder(relPath: string): string {
  return normalizeRel(relPath, 'project')
}
