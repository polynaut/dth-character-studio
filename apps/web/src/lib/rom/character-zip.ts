import { z } from 'zod'

import { EXPORTS_FOLDER, LEGACY_EXPORTS_FOLDER } from '#/lib/scene-subfolder.ts'
import { avatarFileName, avatarSourceMaster, avatarSourceName, parseAvatarName } from './avatar-names'
import { normalizeSceneKey } from './execute-jobs.ts'
import { HOUDINI_JOB_FILE, HOUDINI_RESULT_FILE } from './houdini-jobs.ts'
import { characterFolderName } from './library'
import { join, relativeInside } from './storage/fs'

/**
 * Whole-character export/import archives (`<Name>_<date>.dcsc.zip`) — the PURE
 * half: the manifest schema, the zip naming, what an export excludes, and the
 * path-repoint transforms an import runs over the character's meta files. The
 * filesystem/native half lives in `api/character-zip.ts`; the zip itself is
 * packed/inflated in Rust (`apps/desktop/src/character_zip.rs`).
 *
 * Zip layout (fixed): `manifest.json` at the root, the character folder under
 * `character/`, the `.dcsmeta/characters/<folder>` files under `meta/`, the
 * avatar images under `images/`.
 */

export const CHARACTER_ZIP_FORMAT = 'dcs-character'
/** Bumped when the LAYOUT changes shape (the character definition inside keeps
 *  its own `schemaVersion` + migration path — an old zip imports fine). */
export const CHARACTER_ZIP_FORMAT_VERSION = 1
/** The dedicated double extension — the `.dcsp.zip` convention's character
 *  sibling. Plain `.zip` at the end on purpose: any archive tool opens it. */
export const CHARACTER_ZIP_SUFFIX = '.dcsc.zip'

/** The zip-internal folder prefixes (mirrored by the Rust packer's `ZipRoot`s). */
export const ZIP_CHARACTER_PREFIX = 'character'
export const ZIP_META_PREFIX = 'meta'
export const ZIP_IMAGES_PREFIX = 'images'

export const characterZipManifestSchema = z.object({
  format: z.literal(CHARACTER_ZIP_FORMAT),
  formatVersion: z.number().int().min(1),
  studioVersion: z.string().default(''),
  exportedAt: z.string().default(''),
  characterId: z.string().min(1),
  characterName: z.string().min(1),
  /** The definition's BARE filename inside `character/` — never a path. */
  definitionFile: z
    .string()
    .min(1)
    .regex(/\.json$/i)
    .refine((name) => !/[\\/]/.test(name), 'definitionFile must be a bare filename'),
  /** Absolute path of the character folder AT EXPORT TIME — what the import
   *  repoints every stored in-folder path away from. */
  sourceFolder: z.string().default(''),
  sourceProjectName: z.string().default(''),
  includes: z
    .object({
      dazExports: z.boolean().default(false),
      houdiniExports: z.boolean().default(false),
    })
    .default({ dazExports: false, houdiniExports: false }),
})

export type CharacterZipManifest = z.infer<typeof characterZipManifestSchema>

/**
 * The zip's file name: `<FolderName>_<yyyy-mm-dd>.dcsc.zip`, with the usual
 * ` (2)` suffix on the STEM for a retry against a taken name.
 */
export function characterZipFileName(name: string, date: Date, attempt = 1): string {
  const stamp = date.toISOString().slice(0, 10)
  const suffix = attempt > 1 ? ` (${attempt})` : ''
  return `${characterFolderName(name)}_${stamp}${suffix}${CHARACTER_ZIP_SUFFIX}`
}

/**
 * What an export prunes from the character folder. Always: the transient
 * Houdini job/result transport files (per-run state that must not resurrect on
 * import). The generated export trees ride the two toggles:
 *
 *  - "Daz exports" = the Daz→Houdini intermediate (`daz-export`, plus the
 *    pre-v29 `dth-exports` an unmigrated character can still carry) — pruned by
 *    directory NAME at any depth, since the legacy tree's location varies.
 *  - "Houdini exports" = the FINAL export folder (the project's `exportSubdir`)
 *    — pruned by its root-relative path, because its name (`export`) is far too
 *    generic to match at any depth.
 */
export function characterZipExclusions(opts: {
  exportSubdir: string
  includeDazExports: boolean
  includeHoudiniExports: boolean
}): { excludeRel: Array<string>; excludeDirNames: Array<string> } {
  const excludeRel = [HOUDINI_JOB_FILE, HOUDINI_RESULT_FILE]
  const excludeDirNames: Array<string> = []
  if (!opts.includeDazExports) excludeDirNames.push(EXPORTS_FOLDER, LEGACY_EXPORTS_FOLDER)
  if (!opts.includeHoudiniExports && opts.exportSubdir.trim()) {
    excludeRel.push(opts.exportSubdir.trim())
  }
  return { excludeRel, excludeDirNames }
}

/**
 * An avatar filename re-keyed from one character id to another — for the rare
 * import where the zip's id is already taken (a copy imported into its own
 * project) and the character gets a different one. Handles the current
 * `<id>--<kind>-<ts>.<ext>` scheme, its `.src` sibling, and the legacy
 * `<id>.<ext>` / `<id>-<ts>.<ext>` prefixes; anything else is returned as-is.
 */
export function rekeyAvatarFileName(fileName: string, fromId: string, toId: string): string {
  if (fromId === toId || !fromId) return fileName
  const master = avatarSourceMaster(fileName)
  if (master) {
    const rekeyed = rekeyAvatarFileName(master, fromId, toId)
    return rekeyed === master ? fileName : avatarSourceName(rekeyed)
  }
  const parsed = parseAvatarName(fileName)
  if (parsed?.id === fromId) return avatarFileName(toId, parsed.kind, parsed.ts, parsed.ext)
  if (fileName.startsWith(`${fromId}.`) || fileName.startsWith(`${fromId}-`)) {
    return `${toId}${fileName.slice(fromId.length)}`
  }
  return fileName
}

/** A path repointed from one folder to another IF it lived inside it —
 *  otherwise returned untouched (the same rule as `repointCharacterPaths`). */
export function repointPath(p: string, fromFolder: string, toFolder: string): string {
  if (!p || !fromFolder || !toFolder) return p
  const rel = relativeInside(fromFolder, p)
  return rel ? join(toFolder, rel) : p
}

// --- Meta-file repointers -----------------------------------------------------
// The character's `.dcsmeta` files key/record ABSOLUTE paths, so an import to a
// new folder (or machine) must rewrite them or the records point at a location
// that no longer exists. Each transform takes the stored file's TEXT and
// returns the fixed text, or null when nothing changed / the file didn't parse
// (tolerant: a garbled record is left alone, exactly like its readers treat it).

function repointedJson(
  text: string,
  transform: (raw: Record<string, unknown>) => boolean,
): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const changed = transform(raw as Record<string, unknown>)
  return changed ? `${JSON.stringify(raw, null, 2)}\n` : null
}

/** `.dth_export_folders.json`: the recorded `exportDir` is the character's
 *  absolute export root. */
export function repointExportFoldersRecordText(
  text: string,
  fromFolder: string,
  toFolder: string,
): string | null {
  return repointedJson(text, (raw) => {
    if (typeof raw.exportDir !== 'string') return false
    const next = repointPath(raw.exportDir, fromFolder, toFolder)
    if (next === raw.exportDir) return false
    raw.exportDir = next
    return true
  })
}

/** `.dth_execute_stamps.json`: `scenes` is keyed by the normalized ABSOLUTE
 *  scene path ({@link normalizeSceneKey}). */
export function repointExecuteStampsText(
  text: string,
  fromFolder: string,
  toFolder: string,
): string | null {
  return repointedJson(text, (raw) => {
    const scenes = raw.scenes
    if (typeof scenes !== 'object' || scenes === null) return false
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(scenes as Record<string, unknown>)) {
      const repointed = normalizeSceneKey(repointPath(key, fromFolder, toFolder))
      if (repointed !== key) changed = true
      next[repointed] = value
    }
    if (changed) raw.scenes = next
    return changed
  })
}

/** `.last_rom_run.json`: each per-scene run records the scene's absolute path. */
export function repointRomRunLogText(
  text: string,
  fromFolder: string,
  toFolder: string,
): string | null {
  return repointedJson(text, (raw) => {
    if (!Array.isArray(raw.runs)) return false
    let changed = false
    for (const run of raw.runs) {
      if (typeof run !== 'object' || run === null) continue
      const record = run as Record<string, unknown>
      if (typeof record.scene !== 'string') continue
      const next = repointPath(record.scene, fromFolder, toFolder)
      if (next !== record.scene) {
        record.scene = next
        changed = true
      }
    }
    return changed
  })
}

/** `products.json`: each stored scan records its scene's absolute path. */
export function repointProductScansText(
  text: string,
  fromFolder: string,
  toFolder: string,
): string | null {
  return repointedJson(text, (raw) => {
    if (!Array.isArray(raw.scans)) return false
    let changed = false
    for (const scan of raw.scans) {
      if (typeof scan !== 'object' || scan === null) continue
      const record = scan as Record<string, unknown>
      if (typeof record.scenePath !== 'string') continue
      const next = repointPath(record.scenePath, fromFolder, toFolder)
      if (next !== record.scenePath) {
        record.scenePath = next
        changed = true
      }
    }
    return changed
  })
}
