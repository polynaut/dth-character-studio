import { exists, mkdir, readDir, readTextFile, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import { ROM_RUN_LOG_FILE } from '@dth/rom'
import * as storage from '../storage'
import { normalizeRelFolder } from '../library'
import {
  characterSchema,
  defaultSections,
  genderSchema,
  genesisVersionSchema,
  morphSchema,
  newId,
  posesFromDazCsv,
  sectionsFromFlatFrames,
} from '@dth/rom'
import {
  characterLocationCache,
  charactersRoot,
  charScopeInput,
  charsRoot,
  dirname,
  fetchPoseAssets,
  invalidateCharacterLocations,
  joinPath,
  morphIndexCache,
  projectIdInput,
  resolveProject,
} from './core'
import { copyTipImage, removeCharacterAvatars } from './avatars'

import type { Character, GenesisVersion, ImportedPose } from '@dth/rom'

// --- Characters (scoped to a project) -------------------------------------

export async function fetchCharacters({ data }: { data: unknown }): Promise<Array<Character>> {
  return storage.listCharacters(await charactersRoot(projectIdInput.parse(data).projectId))
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

/**
 * Where a character lives, through the session location cache: a cache hit is
 * verified with a single `exists()` (so external deletes/renames are noticed);
 * a miss or stale entry falls back to the full library scan and repopulates.
 * Mutations (save/move/delete) also clear the cache outright — navigating right
 * after a rename re-scans instead of 404ing.
 */
async function locateCharacter(
  root: string,
  id: string,
): Promise<storage.CharacterLocation | null> {
  const key = `${root}|${id}`
  const cached = characterLocationCache.get(key)
  if (cached) {
    try {
      if (await exists(cached.definitionAbs)) return cached
    } catch {
      // unverifiable (e.g. an unreachable share) — treat as stale
    }
    characterLocationCache.delete(key)
  }
  const location = await storage.getCharacterPath(root, id)
  if (location) characterLocationCache.set(key, location)
  return location
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
  /** Copy the ROM definitions from this existing character (in the same project). */
  prefillFromId: z.string().optional(),
})

/** ROM-definition fields copied when prefilling from another
 *  character — everything that shapes the ROM, minus identity / provenance. */
function romFields(src: Character): Partial<Character> {
  return {
    sections: src.sections,
    facsDetailStrength: src.facsDetailStrength,
    flexionStrength: src.flexionStrength,
    resetGenBeforeApplying: src.resetGenBeforeApplying,
    applyUE5TearUV: src.applyUE5TearUV,
    preserveMorphs: src.preserveMorphs,
    preserveNodeTransforms: src.preserveNodeTransforms,
    jcmMorphMods: src.jcmMorphMods,
  }
}

export async function createCharacter({ data }: { data: unknown }): Promise<Character> {
  const input = createInput.parse(data)
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const now = new Date().toISOString()
  const id = newId()
  // ROM prefill: copied from an existing character (any project).
  let prefill: Partial<Character> = {}
  if (input.prefillFromId) {
    // The source may live in any project (prefill lists characters globally).
    const source = await storage.findCharacterAcrossProjects(input.prefillFromId)
    if (source) prefill = romFields(source)
  }
  const base: Record<string, unknown> = {
    id,
    name: input.name,
    genesis: input.genesis,
    gender: input.gender,
    createdAt: now,
    updatedAt: now,
    ...prefill,
  }
  // The stock defaults enable FAC in preset mode — only valid when the DTH
  // release ships a FAC-variant base ROM for this generation (it doesn't for
  // G8/G3). Start FAC disabled there; enabling it in the editor offers the
  // custom morph list. Prefills copy a same-generation character, so they
  // are already consistent and stay untouched.
  if (!('sections' in prefill)) {
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
      const sections = defaultSections()
      sections.FAC.enabled = false
      sections.FAC.mode = 'custom'
      base.sections = sections
    }
  }
  // The picked scene's tip thumbnail becomes the avatar, and we record the scene
  // path as read-only provenance shown in the editor.
  if (input.scenePath) {
    base.scenePath = input.scenePath
    const image = await copyTipImage(id, input.scenePath)
    if (image) base.image = image
  }
  const character: Character = characterSchema.parse(base)
  const created = await storage.createCharacterAt(project, character, input.relFolder ?? '', lib)
  // Seed an empty Houdini folder (named from the project manifest) so the user is
  // nudged to create the character's Houdini project there. Best-effort and only
  // for characters that own a folder — never scatter it into the project root.
  const houSub = normalizeRelFolder(project.houdiniSubdir)
  if (project.createHoudiniSubdir && houSub) {
    try {
      const loc = await storage.getCharacterPath(lib, created.id)
      if (loc?.relFolder) await mkdir(joinPath(loc.folderAbs, houSub), { recursive: true })
    } catch {
      // a missing seed folder shouldn't fail character creation
    }
  }
  return created
}

/** One morph the ROM run couldn't apply (from the Daz-side run log). */
export interface RomRunFailedMorph {
  frame: number
  node: string
  prop: string
  reason: string
}

/** The run log the generated ROM script writes into the character folder after
 *  every run in Daz (success too). `unreadable` marks an existing-but-corrupt
 *  log — itself surfaced as a problem. */
export interface RomRunLog {
  character: string
  finishedAt: string
  finishedAtMs: number
  framesTotal?: number
  ok: boolean
  errors: Array<string>
  failedMorphs: Array<RomRunFailedMorph>
  unreadable?: boolean
}

/** The studio's OWN copy of the last run log (`.last_rom_run.json`, character
 *  folder). The Daz-written `dth_rom_run_log.json` is a throwaway transport:
 *  fetchRomRunLog ingests it here and deletes it. */
const LAST_ROM_RUN_FILE = '.last_rom_run.json'

/** Parse run-log JSON into the normalized shape (throws on unparseable text). */
function parseRomRunLogText(text: string): RomRunLog {
  const record = (JSON.parse(text) ?? {}) as Record<string, unknown>
  return {
    character: typeof record.character === 'string' ? record.character : '',
    finishedAt: typeof record.finishedAt === 'string' ? record.finishedAt : '',
    finishedAtMs: typeof record.finishedAtMs === 'number' ? record.finishedAtMs : 0,
    framesTotal: typeof record.framesTotal === 'number' ? record.framesTotal : undefined,
    ok: record.ok === true,
    errors: Array.isArray(record.errors) ? record.errors.map((e) => String(e)) : [],
    failedMorphs: Array.isArray(record.failedMorphs)
      ? record.failedMorphs.map((m) => {
          const entry = (m ?? {}) as Record<string, unknown>
          return {
            frame: typeof entry.frame === 'number' ? entry.frame : -1,
            node: typeof entry.node === 'string' ? entry.node : '',
            prop: typeof entry.prop === 'string' ? entry.prop : '',
            reason: typeof entry.reason === 'string' ? entry.reason : '',
          }
        })
      : [],
    unreadable: record.unreadable === true || undefined,
  }
}

/** An existing-but-corrupt log still surfaces as a problem instead of throwing. */
function unreadableRomRunLog(): RomRunLog {
  return {
    character: '',
    finishedAt: '',
    finishedAtMs: Date.now(),
    ok: false,
    unreadable: true,
    errors: [
      'The ROM run log exists but could not be read — the run may have crashed while writing it. Re-run the ROM script in Daz.',
    ],
    failedMorphs: [],
  }
}

/**
 * The character's last ROM run log. A freshly Daz-written `dth_rom_run_log.json`
 * is ingested into the studio's own `.last_rom_run.json` and DELETED (throwaway
 * transport); otherwise the stored copy is returned. Null when no run was ever
 * logged (or the report was dismissed). Defensive throughout — a malformed file
 * becomes an `unreadable` problem log rather than an exception.
 */
export async function fetchRomRunLog({ data }: { data: unknown }): Promise<RomRunLog | null> {
  const { projectId, id } = charScopeInput.parse(data)
  const location = await locateCharacter(await charactersRoot(projectId), id)
  if (!location) return null
  const folder = location.folderAbs
  const dazPath = joinPath(folder, ROM_RUN_LOG_FILE)
  const storePath = joinPath(folder, LAST_ROM_RUN_FILE)
  try {
    if (await exists(dazPath)) {
      let log: RomRunLog
      try {
        log = parseRomRunLogText(await readTextFile(dazPath))
      } catch {
        log = unreadableRomRunLog()
      }
      await writeTextFile(storePath, JSON.stringify(log, null, 2))
      await remove(dazPath)
      return log
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
  const location = await locateCharacter(await charactersRoot(projectId), id)
  if (!location) return
  const folder = location.folderAbs
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
  // A name change renames the character's folder on disk — drop the cached
  // locations so the next read re-scans instead of chasing the old path.
  invalidateCharacterLocations()
  return storage.saveCharacter(project, characterSchema.parse(character), charsRoot(project))
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
  // Capture the name before deleting — it keys the generated script subfolder.
  const character = await storage.getCharacter(lib, id)
  const settings = await storage.getSettings()
  // Resolve the keep flags to the configured subfolder names so the recursive
  // delete can spare them. The Houdini subfolder (seeded into new characters) can
  // hold the user's own .hip project, so it's kept on request too.
  const keepFolders: Array<string> = []
  if (keepDaz && project.dazSubdir) keepFolders.push(project.dazSubdir)
  if (keepHoudini && project.houdiniSubdir) keepFolders.push(project.houdiniSubdir)
  await storage.deleteCharacter(lib, id, { keepFolders })
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
  const existing = await storage.existingCharacterSubfolders(
    charsRoot(project),
    id,
    [project.dazSubdir, project.houdiniSubdir].filter(Boolean),
  )
  return {
    daz: !!project.dazSubdir && existing.includes(project.dazSubdir),
    houdini: !!project.houdiniSubdir && existing.includes(project.houdiniSubdir),
  }
}

/** Shape of an existing DazToHue-Scripts FBM file (e.g. ElectraG9_FBMs.json). */
const fbmJsonSchema = z.object({
  meta: z
    .object({
      resetGPBeforeApplying: z.boolean().optional(),
      resetDKBeforeApplying: z.boolean().optional(),
    })
    .optional(),
  frames: z.array(
    z.object({
      frame: z.number(),
      section: z.string(),
      name: z.string(),
      morphs: z.array(morphSchema),
    }),
  ),
})

const importInput = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  genesis: genesisVersionSchema,
  gender: genderSchema,
  /** Absolute path to an existing *_FBMs.json on this machine. */
  filePath: z.string().min(1),
})

/** Seeds a new character from an existing DazToHue-Scripts FBM JSON file. */
export async function importCharacterFromJson({ data }: { data: unknown }): Promise<Character> {
  const input = importInput.parse(data)
  const raw = fbmJsonSchema.parse(JSON.parse(await readTextFile(input.filePath)))
  const now = new Date().toISOString()
  const character: Character = characterSchema.parse({
    id: newId(),
    name: input.name,
    genesis: input.genesis,
    gender: input.gender,
    createdAt: now,
    updatedAt: now,
    sections: sectionsFromFlatFrames([...raw.frames].sort((a, b) => a.frame - b.frame)),
  })
  // Map either per-block reset flag from the imported FBM JSON onto the generic field.
  const importedReset = raw.meta?.resetGPBeforeApplying ?? raw.meta?.resetDKBeforeApplying
  if (importedReset !== undefined) {
    character.resetGenBeforeApplying = importedReset
  }
  const project = await resolveProject(input.projectId)
  return storage.saveCharacter(project, character, charsRoot(project))
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
  invalidateCharacterLocations()
  return storage.moveCharacter(await charactersRoot(projectId), id, relPath)
}

const moveScenesFolderInput = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  /** New scenes subfolder, relative to the character folder (e.g. "daz3d"). */
  newSubdir: z.string().min(1),
})

/**
 * Rename the character's Daz scenes folder (the primary scene's directory) to a
 * new subfolder relative to the character folder: physically moves the folder on
 * disk, then repoints every linked scene path underneath it and saves. The
 * scenes folder must live INSIDE the character folder — a scene linked from
 * elsewhere has no subfolder to edit.
 */
export async function moveCharacterScenesFolder({
  data,
}: {
  data: unknown
}): Promise<Character> {
  const { projectId, id, newSubdir } = moveScenesFolderInput.parse(data)
  const root = await charactersRoot(projectId)
  const loc = await locateCharacter(root, id)
  const located = loc ? await storage.readCharacterAt(loc.definitionAbs) : null
  const character = located?.id === id ? located : null
  if (!character?.scenePath || !loc) throw new Error('No Daz scene linked.')
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const charFolder = norm(loc.folderAbs)
  const oldDir = norm(character.scenePath).replace(/\/[^/]*$/, '')
  if (!oldDir.toLowerCase().startsWith(charFolder.toLowerCase() + '/')) {
    throw new Error('The scenes folder lives outside the character folder.')
  }
  const rel = normalizeRelFolder(newSubdir) // separators, no '..' / absolute / illegal chars
  if (!rel) throw new Error('Enter a subfolder name.')
  const newDir = `${charFolder}/${rel}`
  if (norm(newDir).toLowerCase() === oldDir.toLowerCase()) return character
  await storage.moveFolder(oldDir, newDir)
  // Everything that lived under the old folder travels with the rename.
  const repoint = (p: string) => {
    const n = norm(p)
    return n.toLowerCase().startsWith(oldDir.toLowerCase() + '/')
      ? `${newDir}${n.slice(oldDir.length)}`
      : p
  }
  const next: Character = {
    ...character,
    scenePath: repoint(character.scenePath),
    extraScenes: character.extraScenes.map(repoint),
  }
  const project = await resolveProject(projectId)
  return storage.saveCharacter(project, next, root)
}

// --- Morph index (Scan_Morphs_<Genesis>.dsa output) -------------------------

/** One scanned morph from a Scan_Morphs_<Genesis>.dsa run in Daz. */
export interface MorphIndexEntry {
  /** Scene node id, instance-suffix-stripped (Genesis9, GoldenPalace_G9, …). */
  node: string
  nodeLabel: string
  /** The morph's UI label in Daz (e.g. "Body Tone"). */
  label: string
  /** The internal name the ROM script dials (e.g. "body_bs_BodyTone"). */
  name: string
}

/**
 * The machine-wide morph index for a generation — written into app-data by the
 * Scan_Morphs_<Genesis>.dsa scripts installed at the DTH-Character-Studio
 * scripts root. Feeds the Morph-name autocomplete. A missing/broken file just
 * yields an empty index (the autocomplete stays quiet). Strictly the character's
 * own generation: the scan is empirical, so cross-compatible morphs already land
 * in the right file (Daz auto-loads Genesis 8 morphs onto a scanned 8.1 figure);
 * merging indexes would only offer dials the actual figure can't drive.
 */
export async function fetchMorphIndex(genesis: GenesisVersion): Promise<Array<MorphIndexEntry>> {
  // Cheap staleness check first: the parsed+deduped index is cached per genesis,
  // keyed on the file's mtime+size — the deliberate re-fetch on every window
  // focus then costs one stat() instead of a full re-read+re-parse. A missing
  // file (or one whose mtime can't be read) is never served from cache.
  let path: string
  let stamp: string | null = null
  try {
    path = await storage.dataPath(`morphs_${genesis}.json`)
    const info = await stat(path)
    const mtime = info.mtime?.getTime()
    if (mtime !== undefined) stamp = `${mtime}:${info.size}`
  } catch {
    // no scan for this generation yet — nothing to offer
    morphIndexCache.delete(genesis)
    return []
  }
  const cached = morphIndexCache.get(genesis)
  if (stamp && cached && cached.stamp === stamp) return cached.entries
  const out: Array<MorphIndexEntry> = []
  const seen = new Set<string>()
  try {
    const raw = await readTextFile(path)
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
  if (stamp) morphIndexCache.set(genesis, { stamp, entries: out })
  return out
}
