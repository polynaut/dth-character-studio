import { z } from 'zod'

import { fillSectionsFrom } from '#/lib/fill-sections.ts'
import { EXPORTS_FOLDER, LEGACY_EXPORTS_FOLDER } from '#/lib/scene-subfolder.ts'
import { avatarFileName, avatarSourceMaster, avatarSourceName, parseAvatarName } from './avatar-names'
import { normalizeSceneKey } from './execute-jobs.ts'
import {
  HOUDINI_CONSOLE_FILE,
  HOUDINI_JOB_FILE,
  HOUDINI_RESULT_FILE,
  HOUDINI_RUN_FILE,
} from './houdini-jobs.ts'
import { characterFolderName } from './library'
import { dirname, join, relativeInside } from './storage/fs'

import type { Character, RomSection } from '@dth/rom'

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
  // EVERY Houdini run file, not just the handoff pair: all four are
  // machine-local state about a run on THIS machine — absolute job/result/hip
  // paths, a console log, a queue of projects — and a zip is what gets handed
  // to someone else. The console log and the run plan were missed when each
  // landed; the set lives in `houdini-jobs.ts` now so the next one can't be.
  const excludeRel = [HOUDINI_JOB_FILE, HOUDINI_RESULT_FILE, HOUDINI_CONSOLE_FILE, HOUDINI_RUN_FILE]
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

const lowerKey = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()

/** A path repointed from one folder to another IF it lived inside it —
 *  otherwise returned untouched (the same rule as `repointCharacterPaths`). */
export function repointPath(p: string, fromFolder: string, toFolder: string): string {
  if (!p || !fromFolder || !toFolder) return p
  const rel = relativeInside(fromFolder, p)
  return rel ? join(toFolder, rel) : p
}

/**
 * What removing a DESELECTED zip scene may take with it: its own subfolder
 * (the sidecars and rom-animations live beside the file), or just the FILE
 * when that folder is shared — with the character folder itself, with the
 * scenes root (a legacy scene sitting directly there), or with a scene the
 * import KEEPS. The last one is the reason this is a function: two scenes in
 * one hand-arranged subfolder, one deselected, and removing "its" folder
 * would take the kept scene along — the primary included.
 *
 * Pure (all paths in destination space) so the decision is testable — the
 * same pattern as `defaultsRowsFor`.
 */
export function sceneWipeTarget(opts: {
  /** The deselected scene's destination path. */
  scene: string
  /** The restored character folder. */
  destFolder: string
  /** The scenes root (parent of the primary's subfolder), '' when unknown. */
  scenesRoot: string
  /** Destination paths of the scenes the import keeps. */
  keptScenes: ReadonlyArray<string>
}): string {
  const { scene, destFolder, scenesRoot, keptScenes } = opts
  const parent = dirname(scene)
  const shared =
    lowerKey(parent) === lowerKey(destFolder) ||
    (scenesRoot !== '' && lowerKey(parent) === lowerKey(scenesRoot)) ||
    keptScenes.some((kept) => lowerKey(dirname(kept)) === lowerKey(parent))
  return shared ? scene : parent
}

// --- The overwrite-import merge ----------------------------------------------

/** What the import wizard collected — the granular half of an overwrite
 *  import. Scene/Houdini paths are as the ZIP's definition stores them (the
 *  api layer repoints them to the destination before merging). */
export interface CharacterZipImportChoices {
  /** The character's name after the import (pre-filled with the zip's). */
  name: string
  /** ROM sections taken FROM THE ZIP; unchecked sections keep the target's
   *  config (RET rides with JCM — the caller resolves that, like Fill). */
  sections: Array<RomSection>
  /** The Fill wizard's "Also copy" extras, zip's when true / target's when not. */
  extras: { jcmRules: boolean; preserveMorphs: boolean; preserveNodeTransforms: boolean }
  /** Zip scenes to restore. Must include the zip's primary (when it has one);
   *  the target's existing scenes are always wiped. */
  scenes: Array<string>
  /** Zip Houdini projects to restore — `add` keeps the target's own projects
   *  beside them, `overwrite` replaces them. */
  houdini: { mode: 'add' | 'overwrite'; projects: Array<string> }
}

/**
 * Compose the definition an overwrite import writes — pure, so the wizard's
 * semantics are testable without a filesystem. ALL paths are in destination
 * space already: the api layer repoints the zip character, the target
 * character AND the choice lists to the destination folder first.
 *
 * The zip is the base (identity, frame-zero, advanced options, per-scene
 * records ride its scenes); the target contributes what the user chose to
 * keep: unchecked ROM sections, unchecked extras — plus its id and creation
 * stamp, because the character ENTITY persists through an overwrite. GEN's
 * scene-derived plumbing (enabled + preset assets) always follows the ZIP:
 * its primary scene is the character's primary scene after the import.
 */
export function mergeImportedCharacter(opts: {
  zip: Character
  target: Character
  choices: CharacterZipImportChoices
  /** Target Houdini projects preserved on disk in `add` mode (repointed, and
   *  already renamed where a zip project claimed the same file name). */
  keptHoudini: Array<string>
}): Character {
  const { zip, target, choices, keptHoudini } = opts
  const sceneKeys = new Set(choices.scenes.map(lowerKey))
  const houdiniKeys = new Set(choices.houdini.projects.map(lowerKey))
  const extraScenes = zip.extraScenes.filter((scene) => sceneKeys.has(lowerKey(scene)))
  const zipHoudini = zip.houdiniProjects.filter((hip) => houdiniKeys.has(lowerKey(hip)))
  const houdiniProjects =
    choices.houdini.mode === 'add'
      ? [
          ...keptHoudini,
          ...zipHoudini.filter(
            (hip) => !keptHoudini.some((kept) => lowerKey(kept) === lowerKey(hip)),
          ),
        ]
      : zipHoudini
  // Checked sections come from the zip, unchecked keep the target's config —
  // then GEN's plumbing is pinned to the zip's regardless (see the doc above;
  // fillSectionsFrom would keep the TARGET's, which is right for Fill and
  // exactly wrong here, where the scene owner is the zip).
  const sections = fillSectionsFrom(target.sections, zip.sections, choices.sections)
  sections.GEN = {
    ...sections.GEN,
    enabled: zip.sections.GEN.enabled,
    presetAssets: [...zip.sections.GEN.presetAssets],
  }
  return {
    ...zip,
    id: target.id,
    createdAt: target.createdAt,
    name: choices.name,
    sections,
    extraScenes,
    houdiniProjects,
    // Per-scene records (overrides + hair) belong to the scenes they key — the
    // deselected scenes' records go with them.
    sceneOverrides: zip.sceneOverrides.filter((o) => sceneKeys.has(lowerKey(o.scenePath))),
    imageScene: sceneKeys.has(lowerKey(zip.imageScene)) ? zip.imageScene : '',
    jcmMorphMods: choices.extras.jcmRules ? zip.jcmMorphMods : target.jcmMorphMods,
    preserveMorphs: choices.extras.preserveMorphs ? zip.preserveMorphs : target.preserveMorphs,
    preserveNodeTransforms: choices.extras.preserveNodeTransforms
      ? zip.preserveNodeTransforms
      : target.preserveNodeTransforms,
  }
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
