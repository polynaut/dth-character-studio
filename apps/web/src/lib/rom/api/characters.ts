import { exists, mkdir, readDir, readFile, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { withBusyCursor } from '../../busy-cursor.ts'

import { ROM_RUN_LOG_FILE } from '@dth/rom'
import { mergeRomRunLogs, parseRomRunLogText, unreadableRomRunLog } from '../run-log.ts'
import type { RomRunLog } from '../run-log.ts'
export type { RomRunFailedMorph, RomRunLog, RomRunSceneRun } from '../run-log.ts'

import { LAST_ROM_RUN_FILE } from '../character-internals.ts'
import * as storage from '../storage'
import { normalizeRelFolder } from '../library'
import {
  EXPORT_FOLDERS_FILE,
  migratedExportFolder,
  normalizeSceneKey,
  parseExportFoldersRecord,
} from '../execute-jobs.ts'
import {
  PRIMARY_SCENE_SUBFOLDER,
  characterExportRoot,
  deriveScenesRootRel,
} from '#/lib/scene-subfolder.ts'
import {
  characterSchema,
  defaultSections,
  genderSchema,
  genesisVersionSchema,
  newId,
  posesFromDazCsv,
  romSectionSchema,
} from '@dth/rom'
import { fillSectionsFrom, filledSections } from '#/lib/fill-sections.ts'
import { normalizePath, normalizePathLower, parentDir } from '#/lib/path.ts'
import {
  cacheCharacterLocation,
  characterLocationCache,
  charactersRoot,
  charScopeInput,
  charsRoot,
  dirname,
  fetchPoseAssets,
  getActiveProjectDir,
  boneIndexCache,
  invalidateCharacterLocations,
  joinPath,
  locateCharacter,
  morphIndexCache,
  projectIdInput,
  resolveProject,
} from './core'
import { copyTipImage, findTipImage, removeCharacterAvatars, writeAvatarBytes } from './avatars'
import { carryStoredProductsToMeta } from './products'
import { sceneWearables } from './generate'
import { seedSceneHair } from '#/lib/groom-detect.ts'
import { primarySceneDerivation } from '#/lib/scene-compat.ts'
import { avatarSourceName, parseAvatarName } from '../avatar-names'
import { assertMovable } from './move'
import { isExternalImage } from '../image'

import type { Character, GenesisVersion, ImportedPose, SceneOverride } from '@dth/rom'

// --- Characters (scoped to a project) -------------------------------------

/**
 * Characters + scan problems from ONE library walk — for the project page,
 * which wants both without paying for two scans (the loader is latency-critical
 * on cold network shares). Also primes the location cache like the scan always
 * does.
 */
export async function fetchCharactersWithProblems({ data }: { data: unknown }): Promise<{
  characters: Array<Character>
  problems: Array<storage.CharacterScanProblem>
}> {
  const { projectId } = projectIdInput.parse(data)
  const root = await charactersRoot(projectId)
  const scan = await storage.scanCharacterLibrary(root)
  for (const { character, location } of scan.entries) {
    cacheCharacterLocation(root, character.id, location)
  }
  return { characters: scan.entries.map((e) => e.character), problems: scan.problems }
}

/** A character tagged with the project it belongs to — for cross-project pickers
 *  like ROM prefill, which can copy from any project's character. */
export type CharacterWithProject = Character & { projectId: string; projectName: string }

export async function fetchAllCharacters(): Promise<Array<CharacterWithProject>> {
  // No global registry now — prefill candidates come from the recent projects.
  const recents = await storage.listRecents()
  const lists = await Promise.all(
    recents.map(async (recent) => {
      const dir = dirname(recent.path)
      try {
        const m = await storage.readManifest(dir)
        const root = m.charactersSubdir ? joinPath(dir, m.charactersSubdir) : dir
        return (await storage.listCharacters(root)).map((c) => ({
          ...c,
          projectId: dir,
          projectName: recent.name,
        }))
      } catch {
        return [] // an unreachable recent project just contributes no candidates
      }
    }),
  )
  return lists.flat()
}

export async function fetchCharacter({ data }: { data: unknown }): Promise<Character | null> {
  const { projectId, id } = charScopeInput.parse(data)
  const root = await charactersRoot(projectId)
  const location = await locateCharacter(root, id)
  if (!location) return null
  // Re-read just the located definition instead of re-parsing the whole library.
  const character = await storage.readCharacterAt(location.definitionAbs)
  if (character && character.id === id) return character
  // The file changed identity under us (replaced/moved externally) — drop the
  // stale location and let the full scan decide.
  characterLocationCache.delete(`${root}|${id}`)
  return storage.getCharacter(root, id)
}

const createInput = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  genesis: genesisVersionSchema,
  gender: genderSchema,
  /** Absolute path to the picked Daz scene (.duf) — its `.tip.png` becomes the avatar. */
  scenePath: z.string().optional(),
  /** Subfolder relative to the project root; '' stores in the project root. */
  relFolder: z.string().optional(),
  /** Copy ROM sections from this existing character (any project) — the Fill
   *  wizard's pick. */
  prefillFromId: z.string().optional(),
  /** Which of the source's sections to copy (the wizard's checkboxes);
   *  omitted = all of its filled sections. */
  prefillSections: z.array(romSectionSchema).optional(),
  /** The wizard's "Also copy" extras — wholesale copies of the source's
   *  non-section ROM tuning. Omitted = none. */
  prefillExtras: z
    .object({
      jcmRules: z.boolean().default(false),
      preserveMorphs: z.boolean().default(false),
      preserveNodeTransforms: z.boolean().default(false),
    })
    .optional(),
})

export async function createCharacter({ data }: { data: unknown }): Promise<Character> {
  const input = createInput.parse(data)
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const now = new Date().toISOString()
  const id = newId()
  // The stock defaults enable FAC in preset mode — only valid when the DTH
  // release ships a FAC-variant base ROM for this generation (it doesn't for
  // G8/G3). Start FAC disabled there; enabling it in the editor offers the
  // custom morph list. A prefilled FAC below replaces its default wholesale
  // (the wizard offers a same-generation character, already consistent).
  let sections = defaultSections()
  const catalog = await fetchPoseAssets()
  const facAvailable =
    catalog.error !== null ||
    catalog.assets.length === 0 || // catalog unknown — don't restrict
    catalog.assets.some(
      (a) =>
        (a.genesis === null || a.genesis === input.genesis) &&
        a.section === 'JCM' &&
        a.includesFac,
    )
  if (!facAvailable) {
    sections.FAC.enabled = false
    sections.FAC.mode = 'custom'
  }
  // ROM prefill (the Fill wizard): the picked sections replace their defaults
  // with the source character's config (the source may live in any project).
  // fillSectionsFrom keeps GEN's plumbing at the defaults — the primary-scene
  // derivation below decides its enabled state / GP-DK selection from the
  // actual scene, never from the source character. The "Also copy" extras are
  // wholesale copies of the source's non-section ROM tuning.
  const prefillExtras: Partial<Character> = {}
  if (input.prefillFromId) {
    const source = await storage.findCharacterAcrossProjects(input.prefillFromId)
    if (source) {
      const picked = input.prefillSections ?? filledSections(source.sections)
      sections = fillSectionsFrom(sections, source.sections, picked)
      const want = input.prefillExtras
      if (want?.jcmRules) prefillExtras.jcmMorphMods = source.jcmMorphMods
      if (want?.preserveMorphs) prefillExtras.preserveMorphs = source.preserveMorphs
      if (want?.preserveNodeTransforms)
        prefillExtras.preserveNodeTransforms = source.preserveNodeTransforms
    }
  }
  const base: Record<string, unknown> = {
    id,
    name: input.name,
    genesis: input.genesis,
    gender: input.gender,
    createdAt: now,
    updatedAt: now,
    sections,
    ...prefillExtras,
  }
  // The picked scene's tip thumbnail becomes the avatar, and we record the scene
  // path as read-only provenance shown in the editor.
  if (input.scenePath) {
    base.scenePath = input.scenePath
    // The primary scene DRIVES the scene-derived fields (one rule, shared with
    // the editor's relink flow): the GEN section's enabled state follows the
    // scene's GP/DK geograft (the editor's GEN toggle is not user-operable),
    // and the gender is read from the figure id / geograft — overriding the
    // dialog's best-effort value AND a ROM prefill (the new character's own
    // scene decides). An unreadable scene (browser mode) decides nothing.
    const scan = await sceneWearables({ data: { scenePath: input.scenePath } })
    const derived = primarySceneDerivation(scan, {
      genesis: input.genesis,
      gender: input.gender,
      sections,
    })
    if (derived.gender) base.gender = derived.gender
    if (derived.sections) base.sections = derived.sections
    // The primary scene's detected hair comes pre-selected (the one shared rule
    // — same heuristic as the editor's "Select all detected hair items" wand),
    // so the export excludes it from day one. The record rides on the scene
    // path, which the create flow repoints if it copies the scene in.
    // `base` is an untyped bag until the schema parse below; a ROM prefill can
    // have put overrides in it already.
    const existingOverrides = (base.sceneOverrides as Array<SceneOverride> | undefined) ?? []
    const seeded = seedSceneHair(input.scenePath, scan, existingOverrides)
    if (seeded) base.sceneOverrides = seeded
    const image = await copyTipImage(id, input.scenePath)
    if (image) {
      base.image = image
      // Remember the source scene so the avatar re-syncs when Daz rewrites the
      // scene's preview (every scene save does).
      base.imageScene = input.scenePath
    }
  }
  const character: Character = characterSchema.parse(base)
  const { character: created, location } = await storage.createCharacterAt(
    project,
    character,
    input.relFolder ?? '',
    lib,
  )
  // The create just resolved where the character lives — prime the cache so the
  // route's first read doesn't immediately re-walk the library it came from.
  cacheCharacterLocation(lib, created.id, location)
  // The empty Houdini folder — and the character's export directory, which starts
  // pointed at it — are seeded by storage.createCharacterAt itself: it's the only
  // place that knows the final (possibly auto-suffixed) folder, and doing it there
  // keeps the create to one definition write.
  //
  // A scene-LESS create (the user will save their scene from Daz afterwards)
  // seeds the Daz-scenes subfolder too — the whole point is giving them the
  // right folder to save into. The primary always lives in its own "primary"
  // subfolder below the scenes root now (lib/scene-subfolder.ts), so that's
  // what gets seeded. With a scene, the folder materializes when the scene is
  // copied in (or stays wherever a linked-in-place scene lives).
  if (!input.scenePath && location.relFolder) {
    try {
      const dazSub = normalizeRelFolder(project.dazSubdir)
      const primarySub = [dazSub, PRIMARY_SCENE_SUBFOLDER].filter(Boolean).join('/')
      await mkdir(joinPath(location.folderAbs, primarySub), { recursive: true })
    } catch {
      // a missing seed folder shouldn't fail character creation
    }
  }
  return created
}

/** One morph the ROM run couldn't apply (from the Daz-side run log). */
/**
 * The character's last ROM run log. A freshly Daz-written `dth_rom_run_log.json`
 * is ingested into the studio's own `.last_rom_run.json` and DELETED (throwaway
 * transport); otherwise the stored copy is returned. Both live in the
 * character's meta folder (`.dcsmeta/characters/<folder>`). Null when no run was
 * ever logged (or the report was dismissed). Defensive throughout — a malformed
 * file becomes an `unreadable` problem log rather than an exception.
 */
export async function fetchRomRunLog({ data }: { data: unknown }): Promise<RomRunLog | null> {
  // `ingest: false` (the route's hover-PRELOAD path) reads the stored copy only:
  // ingesting DELETES the Daz-written file, and merely hovering a character card
  // must never race Daz mid-write — a partial file would parse as "unreadable"
  // and the original would be gone. Real visits and the focus refetch ingest.
  const { projectId, id, ingest } = charScopeInput
    .extend({ ingest: z.boolean().default(true) })
    .parse(data)
  const project = await resolveProject(projectId)
  const location = await locateCharacter(charsRoot(project), id)
  if (!location) return null
  const folder = storage.characterMetaDir(project.path, location.relFolder, id)
  const dazPath = joinPath(folder, ROM_RUN_LOG_FILE)
  const storePath = joinPath(folder, LAST_ROM_RUN_FILE)
  try {
    if (ingest && (await exists(dazPath))) {
      const text = await readTextFile(dazPath)
      let log: RomRunLog
      try {
        log = parseRomRunLogText(text)
      } catch {
        // Parse failed — this can be a PARTIAL mid-write (a focus refetch can land
        // while Daz is still writing the file), not a genuinely corrupt log. Only
        // treat it as unreadable (store + delete) if the file is STABLE — identical
        // on a second read. If it changed, Daz is still writing: throw to fall back
        // to the stored copy and let the next refetch ingest the finished file,
        // instead of deleting a log Daz is about to complete.
        const stable = (await exists(dazPath)) && (await readTextFile(dazPath)) === text
        if (!stable) throw new Error('run log still being written')
        log = unreadableRomRunLog()
      }
      // MERGE per scene rather than replace. The studio can ingest mid-batch
      // (the user alt-tabs back while Daz still has scenes to run), which
      // DELETES the transport file — so the scenes that ran before that ingest
      // live only in the store, and the next ingest carries the rest. Replacing
      // would throw the first half of the batch away exactly when the user
      // looked, which is the worst possible moment.
      let stored: RomRunLog | null = null
      try {
        if (await exists(storePath)) stored = parseRomRunLogText(await readTextFile(storePath))
      } catch {
        // unreadable store — the fresh log stands on its own
      }
      const merged = stored ? mergeRomRunLogs(stored, log) : log
      // Atomic: a crash mid-write must not leave a torn store copy (which would
      // read back as "unreadable" forever after the transport file is deleted).
      await storage.writeTextFileAtomic(storePath, JSON.stringify(merged, null, 2))
      await remove(dazPath)
      return merged
    }
  } catch {
    // ingest failed (e.g. Daz still holds the file) — fall back to the store;
    // the next focus/load retries the ingest.
  }
  try {
    if (!(await exists(storePath))) return null
    return parseRomRunLogText(await readTextFile(storePath))
  } catch {
    return null
  }
}

/** Dismiss the last run report: drop the studio's stored copy (and any not-yet-
 *  ingested Daz file). Best-effort. */
export async function dismissRomRunLog({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  const project = await resolveProject(projectId)
  const location = await locateCharacter(charsRoot(project), id)
  if (!location) return
  const folder = storage.characterMetaDir(project.path, location.relFolder, id)
  for (const name of [LAST_ROM_RUN_FILE, ROM_RUN_LOG_FILE]) {
    try {
      const path = joinPath(folder, name)
      if (await exists(path)) await remove(path)
    } catch {
      // best-effort — a locked file just leaves the banner until the next run
    }
  }
}

const saveInput = z.object({ projectId: z.string().min(1), character: z.unknown() })

export async function saveCharacter({ data }: { data: unknown }): Promise<Character> {
  const { projectId, character } = saveInput.parse(data)
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const parsed = characterSchema.parse(character)
  await migrateExportRoot(project, parsed, lib)
  // Carry a pre-v30 definition's stored Daz products into the character's meta
  // folder BEFORE this save strips them (`parsed` above already dropped them —
  // the carry reads the raw JSON still on disk). Best-effort inside the helper;
  // no-op the moment a store exists.
  const before = await locateCharacter(lib, parsed.id)
  if (before) {
    await carryStoredProductsToMeta(project, before.relFolder, parsed.id, before.definitionAbs)
  }
  // The save resolves (and, on a rename, moves) the character's folder itself
  // and reports where it landed — prime the session cache with that POST-save
  // location instead of blanket-clearing it, which forced the save+generate
  // pair into a second full library walk on every save. The entry is keyed by
  // id, so a rename simply overwrites the stale old-path entry.
  const saved = await storage.saveCharacter(project, parsed, lib)
  cacheCharacterLocation(lib, saved.character.id, saved.location)
  return saved.character
}

/**
 * Carry a pre-v29 character's already-exported files into the fixed export root
 * before the save repoints `exportPath` at it — otherwise the migration would
 * silently strand them (often gigabytes) at the old, user-chosen location.
 *
 * Runs at most once per character, and needs no version flag to know: it fires
 * only while the STORED path still differs from the derived one, which the save
 * itself then fixes. Idempotent by construction.
 *
 * What moves is exactly what the studio recorded as its own export folders
 * ({@link EXPORT_FOLDERS_FILE}) — never the whole old directory, which for the
 * default layout WAS the character's Houdini folder and holds the user's
 * `.hiplc` files. Each recorded folder loses its dead v27
 * `<project>/dth-export/` prefix and keeps the rest, so nested scene subfolders
 * survive. Best-effort throughout: a failed move leaves the files where they
 * are (the Rust side never deletes a source without a complete copy), and the
 * save proceeds either way — a blocked migration must not block editing.
 */
async function migrateExportRoot(
  project: { path: string; dazSubdir?: string },
  character: Character,
  lib: string,
): Promise<void> {
  if (!isTauri()) return
  try {
    const oldRoot = character.exportPath.trim().replace(/\\/g, '/')
    if (!oldRoot) return
    const location = await locateCharacter(lib, character.id)
    if (!location?.relFolder) return
    // The SAME derivation the save below writes (scenesRootRelOf — the
    // character's own scenes root, project dazSubdir only as fallback). The
    // plain-dazSubdir spelling that used to sit here re-fired the trigger on
    // every save of a character with a RENAMED scenes folder — and moved its
    // exports into a resurrected `daz3d/dth-exports` each time.
    const newRoot = characterExportRoot(
      location.folderAbs,
      storage.scenesRootRelOf(character.scenePath, location.folderAbs, project.dazSubdir ?? ''),
    )
    if (!newRoot || normalizePathLower(newRoot) === normalizePathLower(oldRoot)) return

    // The record lives in the character's meta folder — but this save can be the
    // FIRST one after the v0.69 relocation, and the relocation itself only runs
    // on generation (which comes after this). So fall back to the old spot in
    // the character folder; missing it here would strand exactly the gigabytes
    // this function exists to carry.
    const metaRecord = joinPath(
      storage.characterMetaDir(project.path, location.relFolder, character.id),
      EXPORT_FOLDERS_FILE,
    )
    const legacyRecord = joinPath(location.folderAbs, EXPORT_FOLDERS_FILE)
    const recordPath = (await exists(metaRecord))
      ? metaRecord
      : (await exists(legacyRecord))
        ? legacyRecord
        : ''
    if (!recordPath) return
    const recorded = parseExportFoldersRecord(await readTextFile(recordPath))
    // A record written for a DIFFERENT export dir describes folders that aren't
    // at `oldRoot` — the same guard the housekeeping's delete side applies.
    if (!recorded || normalizePathLower(recorded.exportDir) !== normalizePathLower(oldRoot)) return

    const moves = recorded.folders
      .map((rel) => ({
        from: joinPath(oldRoot, rel),
        to: joinPath(newRoot, migratedExportFolder(rel)),
      }))
      .filter((m) => normalizePathLower(m.from) !== normalizePathLower(m.to))
    if (moves.length === 0) return

    const failures = z.array(z.string()).parse(await invoke('move_exports', { request: { moves } }))
    if (failures.length > 0) {
      console.warn(`Export migration left ${failures.length} folder(s) behind:\n${failures.join('\n')}`)
    }
    // The record still names the OLD dir + the old nesting. Drop it: the next
    // generation writes a fresh one for the layout that now exists, and a stale
    // record would aim the housekeeping's delete at the wrong tree.
    await remove(recordPath)
  } catch {
    // Never fail a save over the migration — the files stay where they are and
    // the next save retries (the trigger is still true until they move).
  }
}

const deleteCharacterInput = charScopeInput.extend({
  /** Preserve the character's Daz-scenes subfolder (settings.dazSubdir). */
  keepDaz: z.boolean().optional(),
  /** Preserve the character's Houdini subfolder (settings.houdiniSubdir) — it's
   *  seeded into new characters and can hold the user's own .hip project. */
  keepHoudini: z.boolean().optional(),
})

export async function deleteCharacter({ data }: { data: unknown }): Promise<void> {
  const { projectId, id, keepDaz, keepHoudini } = deleteCharacterInput.parse(data)
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  invalidateCharacterLocations()
  // Resolve the location ONCE and thread it through — the read (for the name,
  // which keys the generated script subfolder) and the delete used to each run
  // their own full library scan.
  const location = await storage.getCharacterPath(lib, id)
  const character = location ? await storage.readCharacterAt(location.definitionAbs) : null
  const settings = await storage.getSettings()
  // Resolve the keep flags to the configured subfolder names so the recursive
  // delete can spare them. The Houdini subfolder (seeded into new characters) can
  // hold the user's own .hip project, so it's kept on request too.
  const keepFolders: Array<string> = []
  if (keepDaz && project.dazSubdir) keepFolders.push(project.dazSubdir)
  if (keepHoudini && project.houdiniSubdir) keepFolders.push(project.houdiniSubdir)
  await storage.deleteCharacter(lib, id, { keepFolders, location: location ?? undefined })
  // "Keep Daz files" spares the whole Daz subfolder — which since schema v29
  // also contains the EXPORT root. Those are derived artifacts (regenerable
  // from the scenes, and gigabytes of them), so keeping the scenes must not
  // silently keep every .abc/.dth too: drop the export root explicitly.
  // Best-effort — an orphaned export folder is never worth failing a delete.
  if (keepDaz && location?.relFolder) {
    try {
      // Derived by the same rule the save uses (scenesRootRelOf) — a renamed
      // scenes folder moved the export root with it, and aiming this purge at
      // the project-default `daz3d/dth-exports` would silently keep gigabytes.
      const exportRoot = characterExportRoot(
        location.folderAbs,
        storage.scenesRootRelOf(character?.scenePath ?? '', location.folderAbs, project.dazSubdir ?? ''),
      )
      if (exportRoot && (await exists(exportRoot))) await remove(exportRoot, { recursive: true })
    } catch {
      // leave the exports behind rather than failing the delete
    }
  }
  // Remove the character's generated Daz script subfolder (derived artifact,
  // orphaned once the character is gone). Best-effort.
  if (character && settings.dazLibraryFolder) {
    try {
      const dir = storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name)
      if (await exists(dir)) await remove(dir, { recursive: true })
    } catch {
      // leave an orphaned script folder rather than failing the delete
    }
  }
  // The character's own folder in the project's meta folder (run log, Execute
  // stamps, export-folder record, PoseAsset CSVs) — pure app data, so it goes
  // whatever the keep flags say: those spare the user's Daz/Houdini files, and
  // none of these is one. Best-effort.
  if (location) {
    try {
      const metaDir = storage.characterMetaDir(project.path, location.relFolder, id)
      if (await exists(metaDir)) await remove(metaDir, { recursive: true })
    } catch {
      // leave the meta folder behind rather than failing the delete
    }
  }
  // Prune the character's app-data product-scan folder + its avatar image — both
  // are orphaned once the character is gone (housekeeping; best-effort).
  try {
    const scanDir = await storage.productScanDir(project.id, id)
    if (await exists(scanDir)) await remove(scanDir, { recursive: true })
  } catch {
    // an orphaned scan folder is harmless — the age-out sweep clears it later
  }
  try {
    await removeCharacterAvatars(project.path, id)
  } catch {
    // leave an orphaned avatar rather than failing the delete
  }
}

/**
 * Which keepable subfolders (the configured Daz / Houdini subdirs) actually exist
 * inside a character's folder — so the delete dialog only offers to keep what's
 * there. The Houdini flag gates the "keep Houdini files" toggle.
 */
export async function characterKeepFolders({
  data,
}: {
  data: unknown
}): Promise<{ daz: boolean; houdini: boolean }> {
  const { projectId, id } = charScopeInput.parse(data)
  const project = await resolveProject(projectId)
  const root = charsRoot(project)
  // Through the location cache — this runs on opening the delete dialog and
  // used to trigger its own full library scan.
  const location = await locateCharacter(root, id)
  const existing = location
    ? await storage.existingCharacterSubfolders(
        root,
        id,
        [project.dazSubdir, project.houdiniSubdir].filter(Boolean),
        location.folderAbs,
      )
    : []
  return {
    daz: !!project.dazSubdir && existing.includes(project.dazSubdir),
    houdini: !!project.houdiniSubdir && existing.includes(project.houdiniSubdir),
  }
}

const csvImportInput = z.object({ filePath: z.string().min(1) })

/**
 * Read a DAZ-exported morph CSV and parse it into poses (a cleaned name + the
 * `(node, prop, value)` morphs of each frame). Used by the per-section "Import
 * from CSV" action so users don't hand-enter long custom-morph lists.
 */
export async function importPosesFromCsv({ data }: { data: unknown }): Promise<Array<ImportedPose>> {
  const { filePath } = csvImportInput.parse(data)
  return posesFromDazCsv(await readTextFile(filePath))
}

/** One CSV the installed Scan_Frames.dsa wrote into the studio's scan folder. */
export interface ScanFrameCsv {
  /** Display name — the Daz scene the scan ran on (file name without .csv). */
  name: string
  path: string
  /** Modified time (ms since epoch); 0 when unavailable. */
  modifiedAt: number
}

/**
 * The keyframe-scan CSVs `Scan_Frames.dsa` has written (newest first) — the
 * "Import from CSV" picker lists these. Empty when no scan ran yet (the folder
 * doesn't exist) or outside the desktop app.
 */
export async function listScanFrameCsvs(): Promise<Array<ScanFrameCsv>> {
  try {
    const dir = await storage.scanFramesDir()
    const out: Array<ScanFrameCsv> = []
    for (const entry of await readDir(dir)) {
      if (entry.isDirectory || !/\.csv$/i.test(entry.name)) continue
      const path = joinPath(dir, entry.name)
      let modifiedAt = 0
      try {
        modifiedAt = (await stat(path)).mtime?.getTime() ?? 0
      } catch {
        // unreadable entry — keep it listed, just unsorted
      }
      out.push({ name: entry.name.replace(/\.csv$/i, ''), path, modifiedAt })
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
  } catch {
    return [] // no folder yet (no scan ran), or no native layer (browser build)
  }
}

/** Where a character's files live (absolute + library-relative), for the editor. */
export async function getCharacterPath({
  data,
}: {
  data: unknown
}): Promise<storage.CharacterLocation | null> {
  const { projectId, id } = charScopeInput.parse(data)
  return locateCharacter(await charactersRoot(projectId), id)
}

const moveInput = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  relPath: z.string().min(1),
})

/** Move/rename a character by its definition path relative to the project library. */
export async function moveCharacter({
  data,
}: {
  data: unknown
}): Promise<{ location: storage.CharacterLocation; character: Character }> {
  const { projectId, id, relPath } = moveInput.parse(data)
  const project = await resolveProject(projectId)
  const root = charsRoot(project)
  // The shared lock gate: refuse (with the file list) before touching disk if
  // the character folder has files open in Daz/Houdini.
  const loc = await locateCharacter(root, id)
  if (loc) await assertMovable(loc.folderAbs)
  invalidateCharacterLocations()
  const moved = await withBusyCursor(storage.moveCharacter(root, id, relPath))
  // The meta folder is keyed on the character's library-relative folder, so it
  // has to follow the move (the rename path in storage.saveCharacter does the
  // same). Best-effort inside the helper.
  if (loc) {
    await storage.moveCharacterMetaDir(project.path, loc.relFolder, moved.location.relFolder, id)
  }
  return moved
}

const moveScenesFolderInput = z.object({
  projectId: z.string().min(1),
  /** The editor's DRAFT character — this is what persists (with its paths
   *  repointed), so the flow composes with persistPatch like relinkScene. */
  character: z.unknown(),
  /** New scenes subfolder, relative to the character folder (e.g. "daz3d"). */
  newSubdir: z.string().min(1),
})

/**
 * Rename the character's Daz scenes folder (the primary scene's directory) to a
 * new subfolder relative to the character folder: physically moves the folder on
 * disk, then repoints every linked scene path underneath it and saves. The
 * scenes folder must live INSIDE the character folder — a scene linked from
 * elsewhere has no subfolder to edit.
 *
 * This is a PERSIST STEP for the draft hook's `persistPatch` (the
 * relinkScene pattern): it saves the passed draft itself and returns the
 * persisted character. Regeneration of the DTH artifacts — whose installed
 * scripts embed the repointed paths (the groom map is keyed by ABSOLUTE scene
 * path, and the CSV-delivery path is baked in) — runs in persistPatch's own
 * generate step, which also surfaces a soft `scriptsError` exactly once.
 */
export async function moveCharacterScenesFolder({
  data,
}: {
  data: unknown
}): Promise<Character> {
  const { projectId, character: raw, newSubdir } = moveScenesFolderInput.parse(data)
  const character = characterSchema.parse(raw)
  const root = await charactersRoot(projectId)
  const project = await resolveProject(projectId)
  const loc = await locateCharacter(root, character.id)
  if (!character.scenePath || !loc) throw new Error('No Daz scene linked.')
  const charFolder = normalizePath(loc.folderAbs)
  const primaryDir = parentDir(character.scenePath)
  if (!normalizePathLower(primaryDir).startsWith(normalizePathLower(charFolder) + '/')) {
    throw new Error('The scenes folder lives outside the character folder.')
  }
  // The moved folder is the scenes ROOT, not the primary's own directory —
  // the primary sits in a SUBFOLDER of the root ("primary"). ONE shared
  // derivation with the scenes field + generation (lib/scene-subfolder.ts).
  const primaryRel = primaryDir.slice(charFolder.length + 1)
  const oldDir = `${charFolder}/${deriveScenesRootRel(primaryRel, project.dazSubdir)}`
  const rel = normalizeRelFolder(newSubdir) // separators, no '..' / absolute / illegal chars
  if (!rel) throw new Error('Enter a subfolder name.')
  const newDir = `${charFolder}/${rel}`
  let next = character
  if (normalizePathLower(newDir) !== normalizePathLower(oldDir)) {
    // Same lock gate as every folder move — refuse with the file list if a
    // scene under the folder is open in Daz.
    await assertMovable(oldDir)
    await withBusyCursor(storage.moveFolder(oldDir, newDir))
    // Everything that lived under the old folder travels with the rename —
    // through THE single repoint site (storage/characters.ts), so this move can't
    // drift from what a folder rename/move repoints (the local copy this replaced
    // had already drifted: it omitted `houdiniProjects`).
    next = storage.repointCharacterPaths(character, oldDir, newDir)
  }
  // Same-subfolder no-op still SAVES: a persist step must return what is
  // actually on disk (persistPatch settles the baseline to it).
  const saved = await storage.saveCharacter(project, next, root)
  cacheCharacterLocation(root, saved.character.id, saved.location)
  return saved.character
}

/** Constant-time-irrelevant byte compare for small avatar/preview images. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const syncAvatarInput = z.object({ projectId: z.string().min(1), id: z.string().min(1) })

/** Single-flight guard: concurrent sync calls for the same character (double
 *  focus events, strict-mode double effects) join the first run instead of
 *  racing — two parallel runs could each write an avatar and delete the
 *  other's file, leaving the saved reference pointing at nothing. */
const avatarSyncInFlight = new Map<string, Promise<Partial<Character> | null>>()

/**
 * Keep a scene-derived avatar in step with its source scene's preview. Daz
 * rewrites `<scene>.tip.png` on every scene save, but the avatar is a one-time
 * copy — this re-copies it when the two drift. Called when the character view
 * loads and whenever the app window regains focus; silent and best-effort:
 *  - custom uploads / external URLs have no source scene and are never touched,
 *  - a source scene that is no longer linked is ignored (stale provenance),
 *  - definitions from before `imageScene` existed self-heal: when the stored
 *    avatar still byte-matches a linked scene's current preview, that scene is
 *    adopted as the source (provenance only — no visible change yet).
 * Persists via the ordinary character save (a real update: the avatar changed)
 * and returns the changed fields for the editor to merge via `syncPersisted`,
 * or null when nothing drifted.
 */
export async function syncAvatarWithScene({ data }: { data: unknown }): Promise<Partial<Character> | null> {
  const { projectId, id } = syncAvatarInput.parse(data)
  const key = `${projectId}|${id}`
  const inFlight = avatarSyncInFlight.get(key)
  if (inFlight) return inFlight
  const run = doSyncAvatarWithScene(projectId, id).finally(() => avatarSyncInFlight.delete(key))
  avatarSyncInFlight.set(key, run)
  return run
}

async function doSyncAvatarWithScene(
  projectId: string,
  id: string,
): Promise<Partial<Character> | null> {
  const character = await fetchCharacter({ data: { projectId, id } })
  if (!character) return null
  // The avatar bytes live under the ACTIVE project's `.dcsmeta` (one project
  // per window), while the character save targets the project the caller
  // NAMED. Assert loudly that the two agree instead of silently mixing them —
  // a mismatch would read window A's avatar store for window B's character.
  const activeDir = await getActiveProjectDir()
  if (!activeDir) return null
  const projectDir = joinPath(projectId)
  if (normalizePathLower(activeDir) !== normalizePathLower(projectDir)) {
    console.warn(
      `[avatar-sync] skipped: project ${projectDir} is not this window's active project (${activeDir})`,
    )
    return null
  }
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  // The bytes to compare TIPS against: the `.src` sibling (the pristine tip as
  // ingested — written by upscale-on-write) when present, else the stored master.
  // The master is upscaled IN PLACE, so it can never byte-equal a 256² tip — a
  // master-only compare made every sync see "stale" and rewrite the avatar on
  // each editor open/refocus. A LEGACY avatar without a `.src` still compares
  // against its master and rewrites ONCE — that write stores the `.src`, so the
  // churn self-terminates.
  const readAvatar = async (): Promise<Uint8Array | null> => {
    if (!character.image || isExternalImage(character.image)) return null
    const dir = storage.metaImagesDir(projectDir)
    try {
      return await readFile(joinPath(dir, avatarSourceName(character.image)))
    } catch {
      // no `.src` (pre-fix write, or the master was never upscale-rewritten)
    }
    try {
      return await readFile(joinPath(dir, character.image))
    } catch {
      return null
    }
  }
  // This function reaches its save after several awaits (tip reads, avatar
  // writes) — a whole-object save of the by-then-stale fetch above would
  // silently revert a concurrent editor save. Re-fetch immediately before
  // saving and apply ONLY the avatar fields onto the fresh object.
  const saveAvatarFields = async (
    fields: Partial<Pick<Character, 'image' | 'imageScene'>>,
  ): Promise<Partial<Character> | null> => {
    const project = await resolveProject(projectId)
    const fresh = await fetchCharacter({ data: { projectId, id } })
    if (!fresh) return null
    await storage.saveCharacter(project, { ...fresh, ...fields }, charsRoot(project))
    return fields
  }
  let source = character.imageScene
  // NORMALIZED membership — an exact string compare silently killed the sync
  // forever when the stored provenance and the scene list disagreed only on
  // separators/case (folder moves and manual edits both produce that).
  if (
    source &&
    !linked.some((scene) => normalizePathLower(scene) === normalizePathLower(source))
  ) {
    // The source LEFT the linked list — a replaced primary whose tip copy
    // failed at relink time, a renamed/unlinked extra. A scene-SNAPSHOT
    // avatar ('sc') must not die with its provenance (the sync would bail
    // here forever while the header shows the old look): adopt the primary
    // and fall through to the drift rewrite, the same self-heal as the
    // no-provenance case below. Uploads/external images are never touched.
    if (parseAvatarName(character.image)?.kind !== 'sc' || !character.scenePath) return null
    source = character.scenePath
  }
  if (!source) {
    const avatar = await readAvatar()
    if (!avatar) return null
    for (const scene of linked) {
      const tipPath = await findTipImage(scene)
      if (tipPath && bytesEqual(await readFile(tipPath), avatar)) {
        source = scene
        break
      }
    }
    if (source) return saveAvatarFields({ imageScene: source })
    // No linked scene's CURRENT tip matches — but a scene-snapshot avatar
    // ('sc' kind) provably CAME from a scene once: its source tip was simply
    // overwritten before provenance existed (Daz re-saves rewrite tips). Adopt
    // the primary and fall through to the drift rewrite below — without this,
    // such a character could never re-sync (the byte-match window is gone for
    // good). An upload ('up'/legacy name) is never touched.
    if (parseAvatarName(character.image)?.kind !== 'sc' || !character.scenePath) return null
    source = character.scenePath
  }
  const tipPath = await findTipImage(source)
  if (!tipPath) return null
  const tip = await readFile(tipPath)
  const avatar = await readAvatar()
  if (avatar && bytesEqual(tip, avatar)) return null
  const image = await writeAvatarBytes(character.id, tip, 'png', 'sc')
  return saveAvatarFields({ image, imageScene: source })
}

// --- Morph index (Build_Genesis_Index.dsa output) ---------------------------

/** One scanned morph from a Build_Genesis_Index.dsa run in Daz. */
export interface MorphIndexEntry {
  /** Scene node id, instance-suffix-stripped (Genesis9, GoldenPalace_G9, …). */
  node: string
  nodeLabel: string
  /** The morph's UI label in Daz (e.g. "Body Tone"). */
  label: string
  /** The internal name the ROM script dials (e.g. "body_bs_BodyTone"). */
  name: string
  /**
   * SCENE-scoped entries only: the Daz scenes this dial was found in, as
   * {@link normalizeSceneKey} keys. Set by the scene scan
   * (`morphs_scenes_<G>.json`) for what a scene adds ON TOP of the stock figures
   * — fitted clothing, hair, third-party grafts. **Absent on base-index
   * entries**, and that absence is meaningful: the autocomplete offers a base
   * morph always, and a scene morph only while one of its scenes is selected
   * (see {@link import('#/components/rom/morph-index-provider.tsx').MorphIndexProvider}).
   */
  scenes?: Array<string>
}

/**
 * The machine-wide morph index for a generation — written into app-data by the
 * Build_Genesis_Index.dsa script installed at the DTH-Character-Studio scripts
 * root (one run writes all four generations). Feeds the Morph-name autocomplete. A missing/broken file just
 * yields an empty index (the autocomplete stays quiet). Strictly the character's
 * own generation: the scan is empirical, so cross-compatible morphs already land
 * in the right file (Daz auto-loads Genesis 8 morphs onto a scanned 8.1 figure);
 * merging indexes would only offer dials the actual figure can't drive.
 */
export async function fetchMorphIndex(genesis: GenesisVersion): Promise<Array<MorphIndexEntry>> {
  // Cheap staleness check first: the parsed+deduped index is cached per genesis,
  // keyed on the source files' mtime+size — the deliberate re-fetch on every
  // window focus then costs two stat()s instead of a full re-read+re-parse. A
  // missing file (or one whose mtime can't be read) is never served from cache.
  //
  // TWO files feed one index: the base scan's `morphs_<G>.json` (the stock
  // figures) and the scene scan's `morphs_scenes_<G>.json` (what individual
  // scenes add on top). They stay separate on disk because a base rebuild
  // rewrites its file wholesale — merging the scene finds in would lose them
  // every time — and are merged here, so callers see one index.
  let basePath: string
  let scenePath: string
  let stamp: string | null = null
  try {
    basePath = await storage.dataPath(`morphs_${genesis}.json`)
    scenePath = await storage.dataPath(`morphs_scenes_${genesis}.json`)
  } catch {
    morphIndexCache.delete(genesis)
    return []
  }
  const baseStamp = await fileStamp(basePath)
  const sceneStamp = await fileStamp(scenePath)
  // No base scan for this generation yet: a scene index alone would offer the
  // clothing dials of scenes whose figure was never indexed, which is honest
  // but useless — and much more likely means the user simply hasn't scanned.
  if (baseStamp === null) {
    morphIndexCache.delete(genesis)
    return []
  }
  stamp = `${baseStamp}|${sceneStamp ?? '-'}`
  const cached = morphIndexCache.get(genesis)
  if (cached && cached.stamp === stamp) return cached.entries

  const out: Array<MorphIndexEntry> = []
  const seen = new Set<string>()
  try {
    const raw = await readTextFile(basePath)
    const parsed = JSON.parse(raw) as { morphs?: Array<Record<string, unknown>> }
    for (const m of parsed.morphs ?? []) {
      if (typeof m.name !== 'string' || !m.name || typeof m.node !== 'string' || !m.node) continue
      const key = `${m.node}|${m.name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        node: m.node,
        nodeLabel: typeof m.nodeLabel === 'string' && m.nodeLabel ? m.nodeLabel : m.node,
        label: typeof m.label === 'string' && m.label ? m.label : m.name,
        name: m.name,
      })
    }
  } catch {
    // unreadable/broken file — the autocomplete stays quiet
    morphIndexCache.delete(genesis)
    return out
  }
  // The scene extras, appended after the base entries. The scan already filters
  // itself against the base index, but the dedup still guards the window where
  // a base rebuild ran after the last scene scan — a scene entry must never
  // shadow a base one, or a dial the figure genuinely carries would go missing
  // from the autocomplete whenever its scene isn't selected.
  if (sceneStamp !== null) {
    try {
      const raw = await readTextFile(scenePath)
      const parsed = JSON.parse(raw) as { morphs?: Array<Record<string, unknown>> }
      for (const m of parsed.morphs ?? []) {
        if (typeof m.name !== 'string' || !m.name || typeof m.node !== 'string' || !m.node) continue
        const key = `${m.node}|${m.name}`
        if (seen.has(key)) continue
        const scenes = Array.isArray(m.scenes)
          ? m.scenes.filter((s): s is string => typeof s === 'string' && s !== '').map(normalizeSceneKey)
          : []
        // An entry with no scene left is unreachable by the filter — skip it
        // rather than parking a suggestion nothing can ever surface.
        if (scenes.length === 0) continue
        seen.add(key)
        out.push({
          node: m.node,
          nodeLabel: typeof m.nodeLabel === 'string' && m.nodeLabel ? m.nodeLabel : m.node,
          label: typeof m.label === 'string' && m.label ? m.label : m.name,
          name: m.name,
          scenes,
        })
      }
    } catch {
      // A broken scene index must not cost the base suggestions — keep what the
      // base scan gave us and just don't cache this run.
      morphIndexCache.delete(genesis)
      return out
    }
  }
  morphIndexCache.set(genesis, { stamp, entries: out })
  return out
}

/** A file's `mtime:size` stamp, or null when it doesn't exist / can't be
 *  stat'ed — the cheap revalidation the index caches key on. */
async function fileStamp(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    const mtime = info.mtime?.getTime()
    return mtime === undefined ? null : `${mtime}:${info.size}`
  } catch {
    return null
  }
}

// --- Bone index (same Build_Genesis_Index.dsa output) -----------------------

/** One scanned bone from a Build_Genesis_Index.dsa run in Daz — a JCM rule
 *  keys off a bone's rotation, so the "Modify JCM frames" editor autocompletes
 *  the bone field from these. */
export interface BoneIndexEntry {
  /** The bone's internal name (e.g. "lThighBend"). */
  name: string
  /** The bone's UI label in Daz (e.g. "Left Thigh Bend") — what the runtime
   *  resolves first (findNodeChildByLabel → findNodeChild), and what the field
   *  stores by default. */
  label: string
}

/**
 * The figure's bones for a generation — written into the SAME per-generation
 * scan index as the morphs (`morphs_<G>.json`'s `bones` array, index version 2+)
 * by Build_Genesis_Index.dsa. Feeds the bone autocomplete in the JCM editor. A
 * missing/old (v1, no `bones`) or broken file just yields an empty list (the
 * autocomplete stays quiet until the user re-runs the scan in Daz).
 */
export async function fetchBoneIndex(genesis: GenesisVersion): Promise<Array<BoneIndexEntry>> {
  // Same cheap stat-then-cache dance as fetchMorphIndex, keyed on the file's
  // mtime+size — a bone index is its own cache entry (the two are read on
  // different focus cadences but share one source file).
  let path: string
  let stamp: string | null = null
  try {
    path = await storage.dataPath(`morphs_${genesis}.json`)
    const info = await stat(path)
    const mtime = info.mtime?.getTime()
    if (mtime !== undefined) stamp = `${mtime}:${info.size}`
  } catch {
    boneIndexCache.delete(genesis)
    return []
  }
  const cached = boneIndexCache.get(genesis)
  if (stamp && cached && cached.stamp === stamp) return cached.entries
  const out: Array<BoneIndexEntry> = []
  const seen = new Set<string>()
  try {
    const raw = await readTextFile(path)
    const parsed = JSON.parse(raw) as { bones?: Array<Record<string, unknown>> }
    for (const b of parsed.bones ?? []) {
      if (typeof b.name !== 'string' || !b.name) continue
      if (seen.has(b.name)) continue
      seen.add(b.name)
      out.push({ name: b.name, label: typeof b.label === 'string' && b.label ? b.label : b.name })
    }
  } catch {
    boneIndexCache.delete(genesis)
    return out
  }
  if (stamp) boneIndexCache.set(genesis, { stamp, entries: out })
  return out
}
