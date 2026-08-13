import { invoke, isTauri } from '@tauri-apps/api/core'
import { copyFile, exists, mkdir, readDir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import {
  CHARACTER_SCHEMA_VERSION,
  EXPORT_CANCEL_FILE,
  newId,
  romSectionSchema,
  ROM_SECTIONS,
} from '@dth/rom'

import { characterExportRoot } from '#/lib/scene-subfolder.ts'
import {
  CHARACTER_ZIP_FORMAT,
  CHARACTER_ZIP_FORMAT_VERSION,
  ZIP_CHARACTER_PREFIX,
  ZIP_IMAGES_PREFIX,
  ZIP_META_PREFIX,
  characterZipExclusions,
  characterZipFileName,
  characterZipManifestSchema,
  mergeImportedCharacter,
  rekeyAvatarFileName,
  repointExecuteStampsText,
  repointExportFoldersRecordText,
  repointPath,
  repointProductScansText,
  repointRomRunLogText,
  sceneWipeTarget,
} from '../character-zip'
import { LAST_ROM_RUN_FILE } from '../character-internals.ts'
import { PRODUCTS_FILE } from '../character-products.ts'
import { EXECUTE_STAMPS_FILE, EXPORT_FOLDERS_FILE, normalizeSceneKey } from '../execute-jobs.ts'
import { characterFolderName, definitionFileName, normalizeRelFolder, notesPathFor } from '../library'
import * as storage from '../storage'
import { relativeInside, renameWithRetry, uniqueFolder } from '../storage/fs'
import { deleteCharacter } from './characters'
import {
  basename,
  cacheCharacterLocation,
  charsRoot,
  dirname,
  invalidateCharacterLocations,
  joinPath,
  locateCharacter,
  resolveProject,
} from './core'
import { generateCharacterFiles } from './generate'
import { repairHoudiniDefaults, repathHoudiniReferences } from './houdini-material'
import { assertMovable } from './move'
import { exportZipReportSchema } from './native-types'

import type { Character } from '@dth/rom'
import type { CharacterZipImportChoices, CharacterZipManifest } from '../character-zip'
import type { ProjectInfo } from './core'
import type { ExportZipReport } from './native-types'

export type { CharacterZipImportChoices, CharacterZipManifest } from '../character-zip'
export type { ExportZipReport } from './native-types'

// Whole-character export/import: pack one character — its folder, its
// `.dcsmeta/characters/<folder>` files and its avatars — into a self-contained
// `.dcsc.zip`, and restore one over an existing character (the granular
// overwrite wizard) or as a new one (project-level drop, everything restored).
// The pure rules (manifest schema, naming, exclusions, the overwrite merge,
// meta repointers) live in `../character-zip`; the zip work in Rust.

const exportInput = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  /** Pack the Daz→Houdini intermediate (`daz-export`, can be gigabytes). */
  includeDazExports: z.boolean(),
  /** Pack the FINAL export folder (the project's `exportSubdir`). */
  includeHoudiniExports: z.boolean(),
  /** The folder the zip lands in (the user's pick). */
  targetFolder: z.string().min(1),
})

/**
 * Pack a character into `<targetFolder>/<Name>_<date>.dcsc.zip`. Always packed:
 * the definition, the notes, every file the user keeps in the character folder
 * (Daz scenes, Houdini projects), the studio's per-character meta files and the
 * avatar images. The two export trees ride their toggles. Reads the character
 * FROM DISK — unsaved editor changes are not in the zip (the dialog says so).
 */
export async function exportCharacterZip({
  data,
}: {
  data: unknown
}): Promise<{ zipPath: string; report: ExportZipReport }> {
  const input = exportInput.parse(data)
  if (!isTauri()) throw new Error('Exporting a character needs the desktop app.')
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, input.id)
  if (!location) throw new Error('Character not found.')
  if (!location.relFolder) {
    throw new Error(
      'This character sits loosely at the project root, so its "folder" is the whole library — move it into its own folder first (the folder chip in the editor header), then export.',
    )
  }
  const character = await storage.readCharacterAt(location.definitionAbs)
  if (!character) throw new Error('The character definition could not be read.')

  const manifest: CharacterZipManifest = {
    format: CHARACTER_ZIP_FORMAT,
    formatVersion: CHARACTER_ZIP_FORMAT_VERSION,
    studioVersion: await storage.studioVersion(),
    exportedAt: new Date().toISOString(),
    characterId: character.id,
    characterName: character.name,
    definitionFile: basename(location.definitionAbs),
    sourceFolder: location.folderAbs,
    sourceProjectName: project.name,
    includes: {
      dazExports: input.includeDazExports,
      houdiniExports: input.includeHoudiniExports,
    },
  }
  const { excludeRel, excludeDirNames } = characterZipExclusions({
    exportSubdir: normalizeRelFolder(project.exportSubdir),
    includeDazExports: input.includeDazExports,
    includeHoudiniExports: input.includeHoudiniExports,
  })
  const zipPath = await freeZipPath(input.targetFolder, character.name)
  const report = exportZipReportSchema.parse(
    await invoke('export_character_zip', {
      request: {
        zipPath,
        manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
        roots: [
          {
            prefix: ZIP_CHARACTER_PREFIX,
            dir: location.folderAbs,
            excludeRel,
            excludeDirNames,
          },
          {
            prefix: ZIP_META_PREFIX,
            dir: storage.characterMetaDir(project.path, location.relFolder, character.id),
            // The interrupt flag is live run state on THIS machine, and it is
            // the one meta file that changes behaviour just by existing: zipped
            // along, it would land in the importer's meta folder and silently
            // skip every scene of their first export. (Zipping mid-run is
            // unlikely — "unlikely" is not a reason to ship a trap.)
            excludeRel: [EXPORT_CANCEL_FILE],
            excludeDirNames: [],
          },
        ],
        files: await characterAvatarFiles(project.path, character.id),
      },
    }),
  )
  return { zipPath, report }
}

/** First free `<folder>/<Name>_<date>[ (n)].dcsc.zip`. */
async function freeZipPath(folder: string, name: string): Promise<string> {
  const now = new Date()
  for (let attempt = 1; attempt <= 99; attempt++) {
    const candidate = joinPath(folder, characterZipFileName(name, now, attempt))
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`Could not find a free zip name in ${folder}.`)
}

/** First free `<stem> (n).<ext>` beside a taken file (add-mode collisions). */
async function freeFileName(abs: string): Promise<string> {
  const dir = dirname(abs)
  const name = basename(abs)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i <= 99; i++) {
    const candidate = joinPath(dir, `${stem} (${i})${ext}`)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`Could not find a free name beside ${abs}.`)
}

/** The character's stored avatar files (masters + `.src` siblings, legacy names
 *  included — the same prefix rule `removeCharacterAvatars` deletes by). */
async function characterAvatarFiles(
  projectDir: string,
  characterId: string,
): Promise<Array<{ zipPath: string; path: string }>> {
  const dir = storage.metaImagesDir(projectDir)
  if (!(await exists(dir))) return []
  const id = basename(characterId)
  return (await readDir(dir))
    .filter((e) => e.isFile && (e.name.startsWith(`${id}.`) || e.name.startsWith(`${id}-`)))
    .map((e) => ({ zipPath: `${ZIP_IMAGES_PREFIX}/${e.name}`, path: joinPath(dir, e.name) }))
}

/**
 * Read + validate a zip's `manifest.json` — how a picked/dropped zip is judged
 * BEFORE anything is extracted. Throws a user-readable reason for a foreign
 * zip, and the honest "update the app" for a newer export format.
 */
export async function readCharacterZipManifest({
  data,
}: {
  data: unknown
}): Promise<CharacterZipManifest> {
  const { zipPath } = z.object({ zipPath: z.string().min(1) }).parse(data)
  if (!isTauri()) throw new Error('Importing a character needs the desktop app.')
  const text = z.string().parse(await invoke('read_character_zip_manifest', { zipPath }))
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This zip is not a DTH Character Studio character export (unreadable manifest).')
  }
  const version =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>).formatVersion
      : undefined
  const format =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).format : undefined
  if (
    format === CHARACTER_ZIP_FORMAT &&
    typeof version === 'number' &&
    version > CHARACTER_ZIP_FORMAT_VERSION
  ) {
    throw new Error(
      `This character export was created by a newer studio (format v${version}; this build reads v${CHARACTER_ZIP_FORMAT_VERSION}). Update the app to import it.`,
    )
  }
  const parsed = characterZipManifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('This zip is not a DTH Character Studio character export.')
  }
  return parsed.data
}

/** What the overwrite wizard renders: the zip's character (sections, extras)
 *  plus its scene/Houdini lists, each flagged with whether the FILE is
 *  actually in the zip (an in-place link outside the export travels as a
 *  reference only). */
export interface CharacterZipSummary {
  manifest: CharacterZipManifest
  /** The zip's character, with its ORIGINAL (zip-side) paths. */
  character: Character
  scenes: Array<{ path: string; primary: boolean; inZip: boolean }>
  houdiniProjects: Array<{ path: string; inZip: boolean }>
}

/**
 * The wizard's preview of a zip — read from the archive's central directory +
 * its definition entry, nothing extracted. Throws the same user-readable
 * reasons as {@link readCharacterZipManifest}, plus "update the app" for a
 * definition saved by a newer studio.
 */
export async function readCharacterZipSummary({
  data,
}: {
  data: unknown
}): Promise<CharacterZipSummary> {
  const { zipPath } = z.object({ zipPath: z.string().min(1) }).parse(data)
  const manifest = await readCharacterZipManifest({ data: { zipPath } })
  const entries = z.array(z.string()).parse(await invoke('list_character_zip_entries', { zipPath }))
  const entryKeys = new Set(entries.map((entry) => entry.replace(/\\/g, '/').toLowerCase()))
  const text = z.string().parse(
    await invoke('read_character_zip_entry', {
      request: { zipPath, entryPath: `${ZIP_CHARACTER_PREFIX}/${manifest.definitionFile}` },
    }),
  )
  let character: Character
  try {
    character = storage.parseCharacterJson(JSON.parse(text))
  } catch (e) {
    throw new Error(zipDefinitionProblem(e), { cause: e })
  }
  const inZip = (p: string): boolean => {
    const rel = manifest.sourceFolder ? relativeInside(manifest.sourceFolder, p) : null
    return rel !== null && entryKeys.has(`${ZIP_CHARACTER_PREFIX}/${rel}`.toLowerCase())
  }
  return {
    manifest,
    character,
    scenes: [
      ...(character.scenePath
        ? [{ path: character.scenePath, primary: true, inZip: inZip(character.scenePath) }]
        : []),
      ...character.extraScenes.map((path) => ({ path, primary: false, inZip: inZip(path) })),
    ],
    houdiniProjects: character.houdiniProjects.map((path) => ({ path, inZip: inZip(path) })),
  }
}

/** Why a zip definition failed to parse — names the honest "newer studio" case. */
function zipDefinitionProblem(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return /newer/i.test(message)
    ? `The zip's character was saved by a newer studio — ${message}`
    : 'The character definition inside the zip could not be read.'
}

const importChoicesInput = z.object({
  /** The character's name after the import (pre-filled with the zip's). */
  name: z
    .string()
    .min(1)
    .refine((name) => !/\.json$/i.test(name.trim()), 'A character name can’t end in “.json”.'),
  /** ROM sections taken from the zip; unchecked keep the target's config. */
  sections: z.array(romSectionSchema),
  extras: z.object({
    jcmRules: z.boolean(),
    preserveMorphs: z.boolean(),
    preserveNodeTransforms: z.boolean(),
  }),
  /** Zip scene paths (as the zip's definition stores them) to restore. Must
   *  include the zip's primary — the target's scenes are always wiped. */
  scenes: z.array(z.string()),
  houdini: z.object({
    mode: z.enum(['add', 'overwrite']),
    projects: z.array(z.string()),
  }),
})

const importInput = z.object({
  projectId: z.string().min(1),
  zipPath: z.string().min(1),
  /** `overwrite` merges the zip into `targetId`'s character per `choices`;
   *  `create` restores the zip wholesale as a new character. */
  mode: z.enum(['overwrite', 'create']),
  targetId: z.string().optional(),
  choices: importChoicesInput.optional(),
})

export interface CharacterZipImportResult {
  character: Character
  /** What the import could NOT fully fix — surfaced, never silent (a missing
   *  Houdini install, a failed regeneration). Empty = everything done. */
  warnings: Array<string>
}

/**
 * Restore a character from a `.dcsc.zip`.
 *
 * The zip is extracted to a staging folder and fully validated BEFORE any live
 * character is touched, so a refused/corrupt zip can never leave a half-
 * overwritten character behind. `create` (the project-level drop) restores
 * everything as a new character. `overwrite` runs the import WIZARD's plan:
 * the target character persists as an entity (same id, its creation stamp),
 * takes the chosen name, the zip's identity and the picked ROM sections /
 * extras, its scenes are wiped and replaced by the zip's selected ones
 * (primary mandatory), and the zip's selected Houdini projects either join the
 * target's own (`add`) or replace them (`overwrite`). What the user chose to
 * keep — unchecked sections' custom base-ROM files, add-mode `.hip`s, the
 * avatar/notes when the zip carries none — is carried across the teardown.
 *
 * Everything path-shaped is fixed for the new location: the definition
 * (`repointCharacterPaths` / the pure merge), the meta records, the avatar
 * references, and the Houdini projects — their `$JOB` is repointed at the new
 * character folder and their stored references repathed/rebuilt via the same
 * hython ops the Utils drawer runs. The generated artifacts (.dsa + PoseAsset
 * CSV) are regenerated so their baked paths match. Anything that can't be
 * fixed here lands in `warnings`.
 *
 * A scene or `.hip` that was LINKED IN PLACE outside the character folder
 * keeps its original absolute path — on the same machine it still resolves; on
 * another machine it shows as missing and is relinked in the editor.
 */
export async function importCharacterZip({
  data,
}: {
  data: unknown
}): Promise<CharacterZipImportResult> {
  const input = importInput.parse(data)
  if (!isTauri()) throw new Error('Importing a character needs the desktop app.')
  if (input.mode === 'overwrite' && (!input.targetId || !input.choices)) {
    throw new Error('Overwrite import needs the character to overwrite and the wizard’s choices.')
  }
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const manifest = await readCharacterZipManifest({ data: { zipPath: input.zipPath } })
  const warnings: Array<string> = []

  const staging = joinPath(
    storage.dcsmetaDir(project.path),
    `import-${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`,
  )
  try {
    await mkdir(staging, { recursive: true })
    z.number().parse(
      await invoke('extract_character_zip', {
        request: { zipPath: input.zipPath, destDir: staging },
      }),
    )
    const stagedCharDir = joinPath(staging, ZIP_CHARACTER_PREFIX)
    if (!(await exists(stagedCharDir))) {
      throw new Error('The zip holds no character folder — it is not a complete export.')
    }
    const stagedDef = joinPath(stagedCharDir, manifest.definitionFile)
    const staged = await storage.readCharacterAt(stagedDef)
    if (!staged) throw new Error(await unreadableStagedReason(stagedDef))

    const restored =
      input.mode === 'overwrite'
        ? await overwriteFromStaging({
            projectId: input.projectId,
            project,
            lib,
            staging,
            staged,
            manifest,
            targetId: input.targetId!,
            choices: input.choices!,
            warnings,
          })
        : await createFromStaging({ project, lib, staging, staged, manifest })

    invalidateCharacterLocations()
    cacheCharacterLocation(lib, restored.character.id, restored.location)

    // Regenerate the .dsa scripts + PoseAsset CSV so their baked paths (scene
    // paths, CSV delivery path) match the new location.
    try {
      await generateCharacterFiles({
        data: { projectId: input.projectId, id: restored.character.id },
      })
    } catch (e) {
      warnings.push(
        `The generated files could not be refreshed (${e instanceof Error ? e.message : String(e)}) — Save in the editor (or Tools → Refresh assets) regenerates them.`,
      )
    }

    // The Houdini projects' own stored state: `$JOB` repointed at the new
    // character folder, references repathed/rebuilt — via the same hython ops
    // the Utils drawer runs.
    warnings.push(
      ...(await fixImportedHoudiniPaths(
        input.projectId,
        restored.character.id,
        restored.character,
        restored.location.folderAbs,
      )),
    )

    // Cleanup ONLY on success. Nothing sweeps `.dcsmeta/import-*` later, so a
    // failed removal is surfaced rather than silently orphaned.
    try {
      if (await exists(staging)) await remove(staging, { recursive: true })
    } catch {
      warnings.push(
        `The import's staging folder could not be removed — delete it by hand: ${staging}`,
      )
    }
    return { character: restored.character, warnings }
  } catch (e) {
    // DELIBERATELY no cleanup here: past the overwrite teardown, staging holds
    // the ONLY remaining copy of the zip's content and the keep-captured files
    // — deleting it on failure would turn a refused rename into total loss.
    // The error names the folder so the user can recover (or discard) it.
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      (await exists(staging))
        ? `${message}\n\nThe zip's extracted files were kept at ${staging} — nothing there is deleted automatically.`
        : message,
      { cause: e },
    )
  }
}

/** The `create` restore: the whole zip becomes a new character under the
 *  project's characters root. The zip's id is kept unless a character of this
 *  project already carries it (importing a copy beside its original) — then a
 *  fresh one is minted and the avatar files re-keyed. */
async function createFromStaging(opts: {
  project: ProjectInfo
  lib: string
  staging: string
  staged: Character
  manifest: CharacterZipManifest
}): Promise<{ character: Character; location: storage.CharacterLocation }> {
  const { project, lib, staging, staged, manifest } = opts
  const conflicting = await locateCharacter(lib, staged.id)
  const finalId = conflicting === null ? staged.id : newId()

  invalidateCharacterLocations()
  await mkdir(lib, { recursive: true })
  const destFolder = await uniqueFolder(lib, characterFolderName(staged.name))
  await renameWithRetry(joinPath(staging, ZIP_CHARACTER_PREFIX), destFolder)
  const relFolder = normalizeRelFolder(relativeInside(lib, destFolder) ?? '')

  await restoreZipMeta(staging, project, relFolder, finalId, manifest.sourceFolder, destFolder)
  await restoreZipImages(staging, project, staged.id, finalId)

  let final = manifest.sourceFolder
    ? storage.repointCharacterPaths(staged, manifest.sourceFolder, destFolder)
    : staged
  final = {
    ...final,
    id: finalId,
    image: rekeyAvatarFileName(final.image, staged.id, finalId),
    ...(await importStamps(project, destFolder, relFolder)),
  }
  const definitionAbs = await writeImportedDefinition(final, destFolder, manifest)
  return {
    character: final,
    location: { definitionAbs, folderAbs: destFolder, relFolder, libraryFolder: lib },
  }
}

/** The `overwrite` restore — the wizard's plan (see {@link importCharacterZip}). */
async function overwriteFromStaging(opts: {
  projectId: string
  project: ProjectInfo
  lib: string
  staging: string
  staged: Character
  manifest: CharacterZipManifest
  targetId: string
  choices: CharacterZipImportChoices
  warnings: Array<string>
}): Promise<{ character: Character; location: storage.CharacterLocation }> {
  const { projectId, project, lib, staging, staged, manifest, targetId, choices, warnings } = opts
  const chosenName = choices.name.trim()
  const targetLocation = await locateCharacter(lib, targetId)
  if (!targetLocation) throw new Error('The character to overwrite was not found.')
  if (!targetLocation.relFolder) {
    throw new Error(
      'The character to overwrite sits loosely at the project root (no folder of its own) — it cannot be replaced wholesale.',
    )
  }
  const targetFolder = targetLocation.folderAbs
  const targetChar = await storage.readCharacterAt(targetLocation.definitionAbs)
  if (!targetChar) {
    throw new Error(
      'The character to overwrite could not be read — import at the project level instead.',
    )
  }
  // The same lock gate as every folder-removing operation: a scene open in
  // Daz/Houdini aborts BEFORE anything is touched.
  await assertMovable(targetFolder)

  // The wizard enforces this; the api rails it too — scenes are wiped, so an
  // import without the zip's primary would leave a scene-less character.
  const sceneKeys = new Set(choices.scenes.map(normalizeSceneKey))
  if (staged.scenePath && !sceneKeys.has(normalizeSceneKey(staged.scenePath))) {
    throw new Error('The zip’s primary Daz scene must be part of the import.')
  }

  // --- KEEP-CAPTURE: what survives the teardown, copied into staging. -------
  // 1. Unchecked sections' custom base-ROM files — the kept config points at
  //    them, and the teardown would otherwise orphan the reference.
  const keptCustomRels: Array<string> = []
  for (const section of ROM_SECTIONS) {
    if (choices.sections.includes(section)) continue
    const asset = targetChar.sections[section].customAssetPath
    const rel = asset ? relativeInside(targetFolder, asset) : null
    if (rel && (await exists(asset))) {
      const keep = joinPath(staging, 'keep/custom', rel)
      await mkdir(dirname(keep), { recursive: true })
      await copyFile(asset, keep)
      keptCustomRels.push(rel)
    }
  }
  // 2. `add` mode: the target's own Houdini project files.
  const keptHoudiniRels: Array<string> = []
  if (choices.houdini.mode === 'add') {
    for (const hip of targetChar.houdiniProjects) {
      const rel = relativeInside(targetFolder, hip)
      if (rel && (await exists(hip))) {
        const keep = joinPath(staging, 'keep/houdini', rel)
        await mkdir(dirname(keep), { recursive: true })
        await copyFile(hip, keep)
        keptHoudiniRels.push(rel)
      }
    }
  }
  // 3. A zip without avatars must not cost the target its own.
  const stagedImages = joinPath(staging, ZIP_IMAGES_PREFIX)
  const zipHasAvatars =
    (await exists(stagedImages)) && (await readDir(stagedImages)).some((e) => e.isFile)
  const keptImages: Array<string> = []
  if (!zipHasAvatars) {
    for (const file of await characterAvatarFiles(project.path, targetId)) {
      const keep = joinPath(staging, 'keep/images', basename(file.path))
      await mkdir(dirname(keep), { recursive: true })
      await copyFile(file.path, keep)
      keptImages.push(basename(file.path))
    }
  }
  // 4. A zip without notes must not cost the target its own.
  const zipHasNotes = await exists(notesPathFor(joinPath(staging, ZIP_CHARACTER_PREFIX, manifest.definitionFile)))
  const targetNotes = notesPathFor(targetLocation.definitionAbs)
  let keptNotes = false
  if (!zipHasNotes && (await exists(targetNotes))) {
    await mkdir(joinPath(staging, 'keep'), { recursive: true })
    await copyFile(targetNotes, joinPath(staging, 'keep/notes.md'))
    keptNotes = true
  }

  // --- TEARDOWN + RESTORE ---------------------------------------------------
  // The full delete through the existing rails (folder, meta, avatars,
  // generated scripts) — "the existing scenes are wiped" is this step.
  await deleteCharacter({ data: { projectId, id: targetId } })

  invalidateCharacterLocations()
  const parentAbs = dirname(targetFolder)
  await mkdir(parentAbs, { recursive: true })
  const destFolder = await uniqueFolder(parentAbs, characterFolderName(chosenName))
  await renameWithRetry(joinPath(staging, ZIP_CHARACTER_PREFIX), destFolder)
  const relFolder = normalizeRelFolder(relativeInside(lib, destFolder) ?? '')

  // Deselected zip scenes: their restored subfolder goes (sidecars +
  // rom-animations live in it) — unless the folder is shared with the
  // character root, the scenes root, or a KEPT scene, where only the file may
  // go (`sceneWipeTarget`, pure + tested: removing a shared folder would take
  // the kept scene along, the primary included).
  const scenesRoot = staged.scenePath
    ? dirname(dirname(repointPath(staged.scenePath, manifest.sourceFolder, destFolder)))
    : ''
  const keptSceneDests = choices.scenes.map((scene) =>
    repointPath(scene, manifest.sourceFolder, destFolder),
  )
  for (const scene of [staged.scenePath, ...staged.extraScenes]) {
    if (!scene || sceneKeys.has(normalizeSceneKey(scene))) continue
    const dest = repointPath(scene, manifest.sourceFolder, destFolder)
    if (!relativeInside(destFolder, dest)) continue // an outside link only drops its ref
    try {
      const removeTarget = sceneWipeTarget({
        scene: dest,
        destFolder,
        scenesRoot,
        keptScenes: keptSceneDests,
      })
      if (await exists(removeTarget)) await remove(removeTarget, { recursive: true })
    } catch {
      warnings.push(`The deselected scene “${basename(scene)}” could not be fully removed.`)
    }
  }
  // Deselected zip Houdini projects likewise (file-level).
  const houdiniKeys = new Set(choices.houdini.projects.map(normalizeSceneKey))
  for (const hip of staged.houdiniProjects) {
    if (houdiniKeys.has(normalizeSceneKey(hip))) continue
    const dest = repointPath(hip, manifest.sourceFolder, destFolder)
    if (!relativeInside(destFolder, dest)) continue
    try {
      if (await exists(dest)) await remove(dest)
    } catch {
      warnings.push(`The deselected Houdini project “${basename(hip)}” could not be removed.`)
    }
  }

  // Restore the keeps.
  for (const rel of keptCustomRels) {
    const dest = joinPath(destFolder, rel)
    await mkdir(dirname(dest), { recursive: true })
    await renameWithRetry(joinPath(staging, 'keep/custom', rel), dest)
  }
  const keptHoudiniAbs: Array<string> = []
  for (const rel of keptHoudiniRels) {
    let dest = joinPath(destFolder, rel)
    // A zip project claimed the same file name — keep BOTH (that's what `add`
    // means), the target's under a suffixed name.
    if (await exists(dest)) dest = await freeFileName(dest)
    await mkdir(dirname(dest), { recursive: true })
    await renameWithRetry(joinPath(staging, 'keep/houdini', rel), dest)
    keptHoudiniAbs.push(dest)
  }
  // `add` also keeps the target's OUTSIDE-linked projects. Their files were
  // never touched (the teardown reaches only the character folder), but the
  // merge keeps exactly what this list carries — without them the refs would
  // silently drop from the definition. A zip selection naming the same
  // outside file dedupes in the merge.
  if (choices.houdini.mode === 'add') {
    keptHoudiniAbs.push(
      ...targetChar.houdiniProjects.filter((hip) => relativeInside(targetFolder, hip) === null),
    )
  }
  if (keptImages.length > 0) {
    const imagesDir = storage.metaImagesDir(project.path)
    await mkdir(imagesDir, { recursive: true })
    await Promise.all(
      keptImages.map((name) =>
        renameWithRetry(joinPath(staging, 'keep/images', name), joinPath(imagesDir, name)),
      ),
    )
  }

  await restoreZipMeta(staging, project, relFolder, targetId, manifest.sourceFolder, destFolder)
  if (zipHasAvatars) await restoreZipImages(staging, project, staged.id, targetId)

  // --- THE DEFINITION: the pure merge, in destination space. ----------------
  const zipRepointed = manifest.sourceFolder
    ? storage.repointCharacterPaths(staged, manifest.sourceFolder, destFolder)
    : staged
  const targetRepointed = storage.repointCharacterPaths(targetChar, targetFolder, destFolder)
  const repointChoice = (p: string) => repointPath(p, manifest.sourceFolder, destFolder)
  let final = mergeImportedCharacter({
    zip: zipRepointed,
    target: targetRepointed,
    choices: {
      ...choices,
      name: chosenName,
      scenes: choices.scenes.map(repointChoice),
      houdini: { mode: choices.houdini.mode, projects: choices.houdini.projects.map(repointChoice) },
    },
    keptHoudini: keptHoudiniAbs,
  })
  final = {
    ...final,
    // The avatar: the zip's (re-keyed to the persisting id), or the target's
    // own when the zip carries none — its imageScene claim then drops (the
    // scene it mirrored was just wiped).
    image: zipHasAvatars ? rekeyAvatarFileName(zipRepointed.image, staged.id, targetId) : targetChar.image,
    imageScene: zipHasAvatars ? final.imageScene : '',
    ...(await importStamps(project, destFolder, relFolder)),
  }
  const definitionAbs = await writeImportedDefinition(final, destFolder, manifest)
  if (keptNotes) {
    const notes = notesPathFor(definitionAbs)
    if (!(await exists(notes))) {
      await renameWithRetry(joinPath(staging, 'keep/notes.md'), notes)
    }
  }
  return {
    character: final,
    location: { definitionAbs, folderAbs: destFolder, relFolder, libraryFolder: lib },
  }
}

/** The provenance + derived-path stamps every imported definition gets. */
async function importStamps(
  project: ProjectInfo,
  destFolder: string,
  relFolder: string,
): Promise<Partial<Character>> {
  return {
    projectName: project.name,
    projectPath: project.path,
    updatedAt: new Date().toISOString(),
    studioVersion: await storage.studioVersion(),
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    // The export root is location-DERIVED (schema v29), never carried over.
    ...(relFolder
      ? { exportPath: characterExportRoot(destFolder, normalizeRelFolder(project.houdiniSubdir)) }
      : {}),
  }
}

/** Write the definition under its name-derived filename; a zip whose stored
 *  filename doesn't match (legacy renames, a wizard rename) sheds the stale
 *  staged copy and carries the notes to the new stem. */
async function writeImportedDefinition(
  final: Character,
  destFolder: string,
  manifest: CharacterZipManifest,
): Promise<string> {
  const definitionAbs = joinPath(destFolder, definitionFileName(final.name))
  await storage.writeTextFileAtomic(definitionAbs, `${JSON.stringify(final, null, 2)}\n`)
  const zipDef = joinPath(destFolder, manifest.definitionFile)
  if (basename(zipDef).toLowerCase() !== basename(definitionAbs).toLowerCase()) {
    try {
      if (await exists(zipDef)) await remove(zipDef)
      const oldNotes = notesPathFor(zipDef)
      const newNotes = notesPathFor(definitionAbs)
      if ((await exists(oldNotes)) && !(await exists(newNotes))) {
        await renameWithRetry(oldNotes, newNotes)
      }
    } catch {
      // a stray legacy-named file is harmless — never fail the import over it
    }
  }
  return definitionAbs
}

/** Move the zip's `meta/` files to the character's meta dir and repoint their
 *  recorded absolute paths. */
async function restoreZipMeta(
  staging: string,
  project: ProjectInfo,
  relFolder: string,
  characterId: string,
  sourceFolder: string,
  destFolder: string,
): Promise<void> {
  const stagedMeta = joinPath(staging, ZIP_META_PREFIX)
  if (!(await exists(stagedMeta))) return
  const metaDest = storage.characterMetaDir(project.path, relFolder, characterId)
  if (await exists(metaDest)) await remove(metaDest, { recursive: true })
  await mkdir(dirname(metaDest), { recursive: true })
  await renameWithRetry(stagedMeta, metaDest)
  await repointMetaFiles(metaDest, sourceFolder, destFolder)
}

/** Move the zip's `images/` files into the project's image store, re-keyed
 *  when the character id changed (independent files, in parallel — the
 *  removeCharacterAvatars pattern). */
async function restoreZipImages(
  staging: string,
  project: ProjectInfo,
  zipId: string,
  finalId: string,
): Promise<void> {
  const stagedImages = joinPath(staging, ZIP_IMAGES_PREFIX)
  if (!(await exists(stagedImages))) return
  const imagesDir = storage.metaImagesDir(project.path)
  await mkdir(imagesDir, { recursive: true })
  await Promise.all(
    (await readDir(stagedImages))
      .filter((entry) => entry.isFile)
      .map((entry) =>
        renameWithRetry(
          joinPath(stagedImages, entry.name),
          joinPath(imagesDir, rekeyAvatarFileName(entry.name, zipId, finalId)),
        ),
      ),
  )
}

/** Why a staged definition failed to read — names the honest "newer studio"
 *  case instead of a generic "could not be read". */
async function unreadableStagedReason(stagedDef: string): Promise<string> {
  try {
    const raw = JSON.parse(await readTextFile(stagedDef)) as { schemaVersion?: unknown }
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > CHARACTER_SCHEMA_VERSION) {
      return `The zip's character was saved by a newer studio (schema v${raw.schemaVersion}; this build reads up to v${CHARACTER_SCHEMA_VERSION}). Update the app to import it.`
    }
  } catch {
    // fall through to the generic reason
  }
  return 'The character definition inside the zip could not be read.'
}

/** The meta files that record absolute paths, each with its repoint transform. */
const META_REPOINTERS: ReadonlyArray<{
  file: string
  fix: (text: string, fromFolder: string, toFolder: string) => string | null
}> = [
  { file: EXPORT_FOLDERS_FILE, fix: repointExportFoldersRecordText },
  { file: EXECUTE_STAMPS_FILE, fix: repointExecuteStampsText },
  { file: LAST_ROM_RUN_FILE, fix: repointRomRunLogText },
  { file: PRODUCTS_FILE, fix: repointProductScansText },
]

async function repointMetaFiles(
  metaDir: string,
  fromFolder: string,
  toFolder: string,
): Promise<void> {
  if (!fromFolder) return
  for (const { file, fix } of META_REPOINTERS) {
    const path = joinPath(metaDir, file)
    try {
      if (!(await exists(path))) continue
      const fixed = fix(await readTextFile(path), fromFolder, toFolder)
      if (fixed !== null) await storage.writeTextFileAtomic(path, fixed)
    } catch {
      // a garbled record is left alone — exactly how its readers treat it
    }
  }
}

/**
 * Fix the imported Houdini projects' own stored paths: `$JOB` → the new
 * character folder (repairHoudiniDefaults), then repath/rebuild stored
 * references against it (repathHoudiniReferences — its export-root donor is
 * what carries import paths across the relocation). Best-effort BY DESIGN:
 * both ops need a paired Houdini install (hython); every failure is returned
 * as a warning naming the manual fallback, never swallowed.
 */
async function fixImportedHoudiniPaths(
  projectId: string,
  characterId: string,
  character: Character,
  folderAbs: string,
): Promise<Array<string>> {
  const inside = character.houdiniProjects.filter(
    (hip) => /\.(hip|hipnc|hiplc)$/i.test(hip) && relativeInside(folderAbs, hip) !== null,
  )
  if (inside.length === 0) return []
  const problems: Array<string> = []
  try {
    const defaults = await repairHoudiniDefaults({
      data: { targets: inside.map((hipPath) => ({ hipPath, jobDir: folderAbs })), dryRun: false },
    })
    if (!defaults.ok && defaults.error) problems.push(defaults.error)
    const jobFixed: Array<string> = []
    for (const d of defaults.defaults) {
      if (d.ok) jobFixed.push(d.hipPath)
      else problems.push(`${basename(d.hipPath)}: $JOB could not be repaired — ${d.error}`)
    }
    if (jobFixed.length > 0) {
      const repath = await repathHoudiniReferences({
        data: {
          targets: jobFixed.map((hipPath) => ({ hipPath, jobDir: folderAbs })),
          projectId,
          characterId,
          dryRun: false,
        },
      })
      if (!repath.ok && repath.error) problems.push(repath.error)
      for (const r of repath.repath) {
        if (!r.ok) {
          problems.push(`${basename(r.hipPath)}: references could not be repathed — ${r.error}`)
        }
      }
    }
  } catch (e) {
    problems.push(
      `Houdini project paths were not adjusted (${e instanceof Error ? e.message : String(e)}). Fix them later via the character's Houdini Utils drawer: Repair project settings, then Make paths portable.`,
    )
  }
  return problems
}
