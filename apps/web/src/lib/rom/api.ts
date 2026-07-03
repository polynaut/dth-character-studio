import { exists, mkdir, readDir, readFile, readTextFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { z } from 'zod'

import {
  characterScriptName,
  characterSlug,
  generateAll,
  genRomIncludes,
  jcmIsBaseRom,
  mergeProductScans,
  parseProductScanCsv,
  poseAssetFileName,
  resolveRomPaths,
} from '@dth/rom'
import * as storage from './storage'
import { dataPath } from './storage'
import { isExternalImage } from './image'
import { normalizeRelFolder } from './library'
import exampleCharacter from './example-character.json'
import {
  characterSchema,
  CHARACTER_SCHEMA_VERSION,
  genderSchema,
  genesisVersionSchema,
  morphSchema,
  newId,
  poseAssetCsvEra,
  posesFromDazCsv,
  RUNTIME_VERSION,
  sectionsFromFlatFrames,
} from '@dth/rom'

import type {
  Character,
  ImportedPose,
  MergedProductScan,
  PresetFrames,
  ProductScan,
} from '@dth/rom'
import type { StudioSettings } from './storage'

export type {
  CharacterLocation,
  DthExporterReleaseInfo,
  DthReleaseInfo,
  KnownDrive,
  Project,
} from './storage'

/**
 * Client data layer — the only bridge between the React UI and the filesystem.
 * Backed by the Tauri fs/dialog plugins (no Node/server). Functions keep the
 * `{ data }` call convention the route components use. Character operations are
 * scoped to a **project**: callers pass `projectId`, which resolves to that
 * project's library path (avatars stay global in the app folder).
 */

function joinPath(...parts: Array<string>): string {
  return parts
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? p
}

/** Everything but the last path segment ('/'-joined). */
function dirname(p: string): string {
  const norm = p.replace(/[\\/]+$/g, '')
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return idx >= 0 ? norm.slice(0, idx).replace(/\\/g, '/') : norm
}

// --- Active project (per window) ------------------------------------------
// A project is now identified by its FOLDER path (the dir holding the `.dcsp`),
// not a registry id. Routes still pass that path as `projectId` (one segment), so
// the character functions below are unchanged. `projectPath` is the identity; the
// `{ id, name, ... }` record is read from the folder's manifest on demand.

/** A project record assembled from a folder's `.dcsp` manifest. */
export interface ProjectInfo extends storage.Project {
  dazSubdir: string
  houdiniSubdir: string
  createHoudiniSubdir: boolean
  assetsEnabled: boolean
  dazProductsEnabled: boolean
  charactersSubdir: string
}

/** Resolve a project folder to its manifest-backed record. */
async function resolveProject(projectDir: string): Promise<ProjectInfo> {
  const dir = joinPath(projectDir)
  const m = await storage.readManifest(dir)
  return {
    id: m.id,
    name: m.name,
    path: dir,
    dazSubdir: m.dazSubdir,
    houdiniSubdir: m.houdiniSubdir,
    createHoudiniSubdir: m.createHoudiniSubdir,
    assetsEnabled: m.assetsEnabled,
    dazProductsEnabled: m.dazProductsEnabled,
    charactersSubdir: m.charactersSubdir,
    ...(m.createdAt ? { createdAt: m.createdAt } : {}),
  }
}

/** A project folder param IS the library path now (normalised). */
async function projectPath(projectDir: string): Promise<string> {
  return joinPath(projectDir)
}

/**
 * Where a project's character folders live: `<project>/<charactersSubdir>` (e.g.
 * `assets/characters`), or the project root when the subdir is empty (today's
 * default). The folder param/provenance stays the project root — only the storage
 * root for character folders shifts.
 */
function charsRoot(project: ProjectInfo): string {
  return project.charactersSubdir ? joinPath(project.path, project.charactersSubdir) : project.path
}

/** Resolve a project id straight to its characters root (reads the manifest). */
async function charactersRoot(projectId: string): Promise<string> {
  return charsRoot(await resolveProject(projectId))
}

// The active project folder for avatar resolution (resolveImageSrc) + writes,
// which have no projectId to thread. Set by the project routes' loaders; falls
// back to the per-window `.dcsp` from the native layer. '' = no project (Home).
let activeProjectDirValue = ''
export function setActiveProjectDir(dir: string): void {
  activeProjectDirValue = dir ? joinPath(dir) : ''
}
async function getActiveProjectDir(): Promise<string> {
  if (!activeProjectDirValue && isTauri()) {
    try {
      const file = (await invoke<string | null>('active_project_file')) ?? ''
      if (file) activeProjectDirValue = dirname(file)
    } catch {
      // no native layer / Home window — stays '' until a project loader sets it
    }
  }
  return activeProjectDirValue
}

/**
 * The projects a cross-project sweep — Refresh assets and version detection —
 * should act on, decided by the window it runs in:
 *  - In a **project window** (an active project is pinned) → just that project.
 *    We're working on one project, so refresh/detection stay scoped to it.
 *  - In the **Home / main window** (no active project) → every **known** project,
 *    i.e. the recents list. There's no global registry now, so recents is the set
 *    of projects the app knows about; entries dedupe by normalised folder path.
 * Unreachable folders (a moved/deleted project, an unreadable `.dcsp`) are skipped
 * — they simply contribute nothing to the sweep.
 */
async function projectsForSweep(): Promise<Array<ProjectInfo>> {
  const activeDir = await getActiveProjectDir()
  if (activeDir) {
    try {
      return [await resolveProject(activeDir)]
    } catch {
      return [] // the pinned project is unreadable — nothing to sweep
    }
  }
  const recents = await storage.listRecents()
  const dirs = new Set(recents.map((r) => joinPath(dirname(r.path))))
  const projects: Array<ProjectInfo> = []
  for (const dir of dirs) {
    try {
      projects.push(await resolveProject(dir))
    } catch {
      // a moved/deleted recent — skip it
    }
  }
  return projects
}

// --- Projects (.dcsp files) -----------------------------------------------
// Projects are folders marked by a `.dcsp` manifest, opened one-per-window. The
// app keeps only a volatile recents list; opening/creating a project opens (or
// focuses) its own window. The route param `projectId` is the project's folder.

const projectIdInput = z.object({ projectId: z.string().min(1) })

/** Open a project in its own window via the native shell (no-op off desktop). */
async function openProjectWindow(dcsp: string): Promise<void> {
  if (isTauri()) await invoke('open_project_window', { path: dcsp })
}

/** Recently opened projects for the Home screen (newest first). */
export async function fetchRecents(): Promise<Array<storage.RecentProject>> {
  return storage.listRecents()
}

/** Drop a project from the recents list (leaves every file on disk untouched). */
export async function forgetRecent({ data }: { data: unknown }): Promise<void> {
  const { path } = z.object({ path: z.string().min(1) }).parse(data)
  await storage.forgetRecent(path)
}

/** The manifest-backed record for a project folder (the route param is its path). */
export async function fetchProject({ data }: { data: unknown }): Promise<ProjectInfo | null> {
  const dir = await projectPath(projectIdInput.parse(data).projectId)
  if (!dir) return null
  return resolveProject(dir)
}

/**
 * The project this window is pinned to (the `.dcsp` it was opened with), or null on
 * the Home window. Lets paramless routes (Settings) show project-scoped UI.
 */
export async function fetchActiveProject(): Promise<ProjectInfo | null> {
  const dir = await getActiveProjectDir()
  if (!dir) return null
  try {
    return await resolveProject(dir)
  } catch {
    return null
  }
}

const createProjectInput = z.object({ name: z.string().min(1), path: z.string().min(1) })

/**
 * Create a new project: ensure the chosen folder exists (creating every parent),
 * write a `.dcsp` manifest named after the project plus its `.dcsmeta`, remember it
 * in recents, and open it in its own window. Returns the created `.dcsp` path.
 */
export async function createProject({ data }: { data: unknown }): Promise<string> {
  const { name, path } = createProjectInput.parse(data)
  const dcsp = await storage.createProjectManifest(joinPath(path), name)
  await storage.rememberRecent(dcsp, name.trim())
  await openProjectWindow(dcsp)
  return dcsp
}

/**
 * Open an existing project from its `.dcsp` file: remember it in recents and open
 * it in its own window. Throws when the file is missing.
 */
export async function openProject({ data }: { data: unknown }): Promise<void> {
  const { path } = z.object({ path: z.string().min(1) }).parse(data)
  const dcsp = joinPath(path)
  if (!(await exists(dcsp))) throw new Error(`Project file not found:\n${dcsp}`)
  const manifest = await storage.readManifest(dirname(dcsp))
  await storage.rememberRecent(dcsp, manifest.name)
  await openProjectWindow(dcsp)
}

const renameProjectInput = z.object({ projectId: z.string().min(1), name: z.string().min(1) })

/** Rename a project — updates the manifest name (the `.dcsp` file name stays put). */
export async function renameProject({ data }: { data: unknown }): Promise<ProjectInfo> {
  const { projectId, name } = renameProjectInput.parse(data)
  const dir = await projectPath(projectId)
  const manifest = await storage.readManifest(dir)
  await storage.writeManifest(dir, { ...manifest, name: name.trim() })
  const dcsp = await storage.findManifestPath(dir)
  if (dcsp) await storage.rememberRecent(dcsp, name.trim())
  return resolveProject(dir)
}

/** Save a project's behaviour defaults (the `.dcsp` manifest's per-project fields). */
const projectSettingsInput = z.object({
  projectId: z.string().min(1),
  dazSubdir: z.string().default('daz3d'),
  houdiniSubdir: z.string().default('houdini'),
  createHoudiniSubdir: z.boolean().default(true),
  assetsEnabled: z.boolean().default(false),
  dazProductsEnabled: z.boolean().default(false),
  charactersSubdir: z.string().default(''),
})
export async function saveProjectSettings({ data }: { data: unknown }): Promise<ProjectInfo> {
  const {
    projectId,
    dazSubdir,
    houdiniSubdir,
    createHoudiniSubdir,
    assetsEnabled,
    dazProductsEnabled,
    charactersSubdir,
  } = projectSettingsInput.parse(data)
  const dir = await projectPath(projectId)
  const manifest = await storage.readManifest(dir)
  // Validate + normalise the relative folder (throws on absolute paths / `..`); '' = project root.
  const nextCharactersSubdir = normalizeRelFolder(charactersSubdir)
  // The characters subfolder defines where character folders live, so a change must
  // move the existing folders to the new location (links inside them are repointed).
  // Done before writing the manifest: if the move fails, the manifest still points
  // at where the folders actually are.
  if (nextCharactersSubdir !== manifest.charactersSubdir) {
    const oldRoot = manifest.charactersSubdir ? joinPath(dir, manifest.charactersSubdir) : dir
    const newRoot = nextCharactersSubdir ? joinPath(dir, nextCharactersSubdir) : dir
    await storage.moveCharactersRoot(oldRoot, newRoot)
  }
  await storage.writeManifest(dir, {
    ...manifest,
    dazSubdir,
    houdiniSubdir,
    createHoudiniSubdir,
    assetsEnabled,
    dazProductsEnabled,
    charactersSubdir: nextCharactersSubdir,
  })
  const project = await resolveProject(dir)
  // Toggling Daz Products on/off changes which Daz scripts each character emits, so
  // regenerate the project's Daz scripts to add (or clean up) the per-character
  // Scan_Products_<Name>.dsa right away — otherwise it wouldn't appear until the
  // next per-character Save or a Tools → Refresh. Daz target only (the Houdini CSV
  // is unaffected); per-character failures are swallowed so the save still succeeds.
  if (dazProductsEnabled !== manifest.dazProductsEnabled) {
    try {
      const characters = await storage.listCharacters(charsRoot(project))
      for (const character of characters) {
        try {
          await generateCharacterFiles({
            data: { projectId: project.path, id: character.id, targets: { daz: true, houdini: false } },
          })
        } catch {
          // one bad character shouldn't block the others or the settings save
        }
      }
    } catch {
      // unreadable characters root — nothing to regenerate
    }
  }
  return project
}

// --- Characters (scoped to a project) -------------------------------------

const charScopeInput = z.object({ projectId: z.string().min(1), id: z.string().min(1) })
// Generate also accepts the character's previous name so a rename can clean up
// the old-named script left behind in the shared scripts folder, plus an optional
// `targets` set so a selective Refresh can rewrite only the Daz scripts or only the
// Houdini CSV (omitted = write both, the editor's "Generate").
const generateInput = charScopeInput.extend({
  previousName: z.string().optional(),
  targets: z
    .object({ daz: z.boolean(), houdini: z.boolean() })
    .optional(),
})

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

export async function fetchCharacter({ data }: { data: unknown }): Promise<Character | null> {
  const { projectId, id } = charScopeInput.parse(data)
  return storage.getCharacter(await charactersRoot(projectId), id)
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
  /** 'example' seeds the ROM definitions from the bundled example. */
  prefill: z.enum(['empty', 'example']).optional(),
  /** Copy the ROM definitions from this existing character (in the same project). */
  prefillFromId: z.string().optional(),
})

/** ROM-definition fields copied when prefilling from the example or another
 *  character — everything that shapes the ROM, minus identity / provenance. */
function romFields(src: Record<string, unknown>): Record<string, unknown> {
  return {
    sections: src.sections,
    facsDetailStrength: src.facsDetailStrength,
    flexionStrength: src.flexionStrength,
    resetGenBeforeApplying: src.resetGenBeforeApplying,
    preserveMorphs: src.preserveMorphs,
    preserveNodeTransforms: src.preserveNodeTransforms,
    jcmMorphMods: src.jcmMorphMods,
  }
}

/** Scene path with a trailing ".duf" stripped (case-insensitive). */
function sceneBase(scenePath: string): string {
  return scenePath.replace(/\.duf$/i, '')
}

/**
 * First existing Daz tip thumbnail next to a scene, trying both naming
 * conventions: `<scene>.tip.png` (e.g. Kira.duf.tip.png) and `<base>.tip.png`
 * (Kira.tip.png). Returns '' when neither exists.
 */
async function findTipImage(scenePath: string): Promise<string> {
  for (const p of [`${scenePath}.tip.png`, `${sceneBase(scenePath)}.tip.png`]) {
    if (await exists(p)) return p
  }
  return ''
}

/**
 * Write a character's avatar bytes under a content-versioned filename
 * (`<id>-<ts>.<ext>`), removing any previous avatar for that id first. The version
 * in the name makes the stored reference change whenever the image does, so every
 * `<Avatar>` keyed on it re-resolves — a fixed `<id>.png` would look unchanged and
 * keep showing the cached old image (e.g. switching the avatar between two scenes).
 * Returns the stored filename.
 */
async function writeAvatarBytes(
  characterId: string,
  bytes: Uint8Array,
  ext: string,
): Promise<string> {
  const projectDir = await getActiveProjectDir()
  if (!projectDir) throw new Error('No project is open.')
  const dir = storage.metaImagesDir(projectDir)
  await mkdir(dir, { recursive: true })
  const id = basename(characterId)
  // One avatar per character — drop any previous variant (old fixed name or version).
  for (const entry of await readDir(dir)) {
    if (entry.isFile && (entry.name.startsWith(`${id}.`) || entry.name.startsWith(`${id}-`))) {
      await remove(joinPath(dir, entry.name))
    }
  }
  const fileName = `${id}-${Date.now()}.${ext}`
  await writeFile(joinPath(dir, fileName), bytes)
  return fileName
}

/**
 * Copy a Daz scene's tip thumbnail into the app's images folder as the
 * character's avatar. Returns the stored filename, or '' when no tip image exists
 * next to the scene.
 */
async function copyTipImage(characterId: string, scenePath: string): Promise<string> {
  const tipPath = await findTipImage(scenePath)
  if (!tipPath) return ''
  return writeAvatarBytes(characterId, await readFile(tipPath), 'png')
}

export async function createCharacter({ data }: { data: unknown }): Promise<Character> {
  const input = createInput.parse(data)
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const now = new Date().toISOString()
  const id = newId()
  // ROM prefill: from the bundled example, or copied from an existing character.
  let prefill: Record<string, unknown> = {}
  if (input.prefill === 'example') {
    prefill = romFields(exampleCharacter as Record<string, unknown>)
  } else if (input.prefillFromId) {
    // The source may live in any project (prefill lists characters globally).
    const source = await storage.findCharacterAcrossProjects(input.prefillFromId)
    if (source) prefill = romFields(source as unknown as Record<string, unknown>)
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

const copySceneInput = z.object({
  projectId: z.string().min(1),
  characterId: z.string().min(1),
  /** Absolute path to the picked Daz scene (.duf). */
  scenePath: z.string().min(1),
  /** Subfolder inside the character's folder; '' copies into the folder itself. */
  subfolder: z.string().optional(),
  /** When true, delete the source `.duf` + thumbnails after copying (a move). */
  deleteOriginal: z.boolean().optional(),
})

/**
 * Copy a Daz scene into the character's folder (used when the picked scene lives
 * outside the project). Copies the `.duf` plus its two sibling thumbnails
 * (`<scene>.png` and `<scene>.tip.png`) into `<characterFolder>/<subfolder>/`.
 * With `deleteOriginal`, the sources are removed afterwards (effectively a move).
 * Returns the absolute path of the copied `.duf`.
 */
/**
 * Copy a Daz scene (`.duf` + its `.png` / `.tip.png` sidecars) into `destDir`,
 * creating it. With `deleteOriginal` the sources are removed after every copy
 * succeeds (a move) — best-effort, so a locked source can't undo the copy.
 * Returns the absolute path of the copied `.duf`. Shared by the character copy
 * and the asset copy.
 */
async function copySceneInto(
  scenePath: string,
  destDir: string,
  deleteOriginal: boolean,
): Promise<string> {
  await mkdir(destDir, { recursive: true })
  const sources = [
    scenePath,
    `${scenePath}.png`,
    `${scenePath}.tip.png`,
    `${sceneBase(scenePath)}.tip.png`,
  ]
  const copied: Array<string> = []
  for (const src of sources) {
    if (await exists(src)) {
      await writeFile(joinPath(destDir, basename(src)), await readFile(src))
      copied.push(src)
    }
  }
  if (deleteOriginal) {
    for (const src of copied) {
      try {
        await remove(src)
      } catch {
        // leave a stray original rather than failing the whole operation
      }
    }
  }
  return joinPath(destDir, basename(scenePath))
}

export async function copyDazScene({ data }: { data: unknown }): Promise<string> {
  const input = copySceneInput.parse(data)
  const lib = await charactersRoot(input.projectId)
  const folder = await storage.getCharacterFolder(lib, input.characterId)
  const sub = normalizeRelFolder(input.subfolder ?? '')
  const destDir = sub ? joinPath(folder, sub) : folder
  return copySceneInto(input.scenePath, destDir, input.deleteOriginal ?? false)
}

// --- Assets ---------------------------------------------------------------
// Reusable Daz scenes ("assets") — bases to build characters on — live inside a
// project's folder (its `.assets`). There is no global/shared asset library: a
// project opts into the feature via its manifest's `assetsEnabled` flag.

/** The root a project's assets live under (its folder). */
async function assetsBase(projectId: string): Promise<string> {
  return projectPath(projectId)
}

export async function listAssets({ data }: { data: unknown }): Promise<Array<storage.DazAsset>> {
  const { projectId } = z.object({ projectId: z.string().min(1) }).parse(data)
  return storage.listAssets(await assetsBase(projectId))
}

const createAssetInput = z.object({
  /** The project the asset belongs to (its folder path). */
  projectId: z.string().min(1),
  /** Absolute path to the picked Daz scene (.duf). */
  scenePath: z.string().min(1),
  /** Display name; defaults to the scene's file name. */
  name: z.string().optional(),
  description: z.string().optional(),
  /** Subfolder under `.assets` to copy into (only used when copying). */
  subfolder: z.string().optional(),
  /** Copy the scene into `.assets` (default), or link it in place. */
  copy: z.boolean().optional(),
  /** When copying, delete the source after a successful copy (a move). */
  deleteOriginal: z.boolean().optional(),
})

export async function createAsset({ data }: { data: unknown }): Promise<storage.DazAsset> {
  const input = createAssetInput.parse(data)
  const base = await assetsBase(input.projectId)
  const copy = input.copy ?? true
  const now = new Date().toISOString()
  let scenePath = input.scenePath
  let linked = true
  let subfolder = ''
  if (copy) {
    const sub = normalizeRelFolder(input.subfolder ?? '')
    const destDir = sub ? joinPath(storage.assetsDir(base), sub) : storage.assetsDir(base)
    scenePath = await copySceneInto(input.scenePath, destDir, input.deleteOriginal ?? false)
    linked = false
    subfolder = sub
  }
  const name = input.name?.trim() || basename(input.scenePath).replace(/\.duf$/i, '') || 'Asset'
  return storage.addAsset(base, {
    id: newId(),
    name,
    scenePath,
    description: input.description?.trim() ?? '',
    subfolder,
    linked,
    createdAt: now,
    updatedAt: now,
  })
}

const deleteAssetInput = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  /** Keep a copied asset's scene files on disk (only the registry entry is dropped). */
  keepFiles: z.boolean().optional(),
})

export async function deleteAsset({ data }: { data: unknown }): Promise<void> {
  const { projectId, id, keepFiles } = deleteAssetInput.parse(data)
  await storage.removeAsset(await assetsBase(projectId), id, { keepFiles })
}

const relinkInput = z.object({
  projectId: z.string().min(1),
  /** The current (possibly draft) character — saved with the new scene path. */
  character: z.unknown(),
  /** Absolute path to the newly-linked Daz scene (.duf). */
  scenePath: z.string().min(1),
})

/**
 * Point a character at a (new) Daz scene: persist the path and refresh the
 * avatar from that scene's `.tip.png`. Operates on the passed-in character so
 * any unsaved editor edits are preserved (mirrors the inline rename).
 */
export async function relinkScene({ data }: { data: unknown }): Promise<Character> {
  const { projectId, character, scenePath } = relinkInput.parse(data)
  const parsed = characterSchema.parse(character)
  const next: Character = { ...parsed, scenePath, updatedAt: new Date().toISOString() }
  const image = await copyTipImage(parsed.id, scenePath)
  if (image) next.image = image
  const project = await resolveProject(projectId)
  return storage.saveCharacter(project, next, charsRoot(project))
}

const sceneAvatarInput = z.object({
  characterId: z.string().min(1),
  scenePath: z.string().min(1),
})

/**
 * Set a character's avatar to a Daz scene's tip thumbnail — copies the scene's
 * `.tip.png` into the app images folder as `<id>.png` and returns the stored
 * filename (the portable reference saved on the character). Throws when the scene
 * has no thumbnail. Powers the avatar dialog's scene-thumbnail picker, so the user
 * can switch the avatar to any linked scene's image.
 */
export async function setAvatarFromScene({ data }: { data: unknown }): Promise<string> {
  const { characterId, scenePath } = sceneAvatarInput.parse(data)
  const fileName = await copyTipImage(characterId, scenePath)
  if (!fileName) throw new Error('That scene has no thumbnail (.tip.png) to use.')
  return fileName
}

/** Open a file with its OS-default application (a `.duf` opens in Daz Studio). */
export async function openScene({ data }: { data: unknown }): Promise<void> {
  const { scenePath } = z.object({ scenePath: z.string().min(1) }).parse(data)
  await shellOpen(scenePath)
}

/**
 * Delete files from disk (best-effort, each independently) — used when unlinking
 * a Daz scene / Houdini project with "Delete file on disk" on. The caller passes
 * the asset plus any siblings (e.g. a scene's `.png` / `.tip.png` thumbnails).
 */
export async function deleteFiles({ data }: { data: unknown }): Promise<void> {
  const { paths } = z.object({ paths: z.array(z.string()) }).parse(data)
  for (const p of paths) {
    if (!p) continue
    try {
      if (await exists(p)) await remove(p)
    } catch {
      // best-effort — a locked/absent file shouldn't fail the whole unlink
    }
  }
}

/** Whether a path exists on disk; false (never throws) when it can't be probed. */
export async function fileExists({ data }: { data: unknown }): Promise<boolean> {
  const { path } = z.object({ path: z.string() }).parse(data)
  if (!path) return false
  try {
    return await exists(path)
  } catch {
    return false
  }
}

/**
 * Best-effort auto-detect of the DAZ Install Manager `ManifestFiles` folder (the
 * Daz Products scan's product database). DIM's location is user-configured and
 * isn't reliably derivable, so we probe the standard layout across drive letters
 * plus the Public Documents fallback and return the first that exists, or '' when
 * none match (the user then sets it by hand). ~30 cheap `exists()` probes.
 */
export async function detectDimManifestsFolder(): Promise<string> {
  if (!isTauri()) return ''
  const candidates: Array<string> = []
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    candidates.push(`${String.fromCharCode(c)}:/DAZ 3D/Install Manager/ManifestFiles`)
  }
  candidates.push('C:/Users/Public/Documents/DAZ 3D/InstallManager/ManifestFiles')
  for (const path of candidates) {
    try {
      if (await exists(path)) return path
    } catch {
      // unprobeable drive — skip
    }
  }
  return ''
}

/**
 * Read back a character's product scans (written from Daz by the generated
 * `Scan_Products_<Name>.dsa`). The script writes one CSV per Daz scene into the
 * character's scan folder; this reads every CSV and merges them so each product /
 * unmatched asset is attributed to the scene(s) it was found in. Best-effort —
 * returns `{ exists: false }` when no scan has been run or the folder is unreadable.
 */
/** One per-scene CSV on disk in a character's scan folder — surfaced so the UI can
 *  show exactly which files back the merged results and when each was last written. */
export interface ProductScanFile {
  /** The CSV file name on disk (e.g. `KiraSummertide_G9_GP.csv`). */
  name: string
  /** The Daz scene the CSV was written for ('' for an unsaved scene). */
  scene: string
  scenePath: string
  products: number
  unmatched: number
  /** ISO mtime of the file, or '' when it couldn't be stat'd. */
  modifiedAt: string
}

export async function fetchProductScan({
  data,
}: {
  data: unknown
}): Promise<{
  exists: boolean
  scan: MergedProductScan | null
  dir: string
  files: Array<ProductScanFile>
}> {
  const { projectId, id } = charScopeInput.parse(data)
  const project = await resolveProject(projectId)
  const dir = await storage.productScanDir(project.id, id)
  try {
    if (!(await exists(dir))) return { exists: false, scan: null, dir, files: [] }
    const scans: Array<ProductScan> = []
    const files: Array<ProductScanFile> = []
    for (const entry of await readDir(dir)) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.csv')) continue
      const full = joinPath(dir, entry.name)
      try {
        const parsed = parseProductScanCsv(await readTextFile(full))
        scans.push(parsed)
        let modifiedAt = ''
        try {
          const info = await stat(full)
          modifiedAt = info.mtime ? info.mtime.toISOString() : ''
        } catch {
          // mtime unavailable — leave ''
        }
        files.push({
          name: entry.name,
          scene: parsed.sceneName,
          scenePath: parsed.scenePath,
          products: parsed.products.length,
          unmatched: parsed.unmatched.length,
          modifiedAt,
        })
      } catch {
        // skip an individual unreadable CSV
      }
    }
    if (scans.length === 0) return { exists: false, scan: null, dir, files: [] }
    files.sort((a, b) =>
      (a.scene || a.name).localeCompare(b.scene || b.name, undefined, { sensitivity: 'base' }),
    )
    return { exists: true, scan: mergeProductScans(scans), dir, files }
  } catch {
    return { exists: false, scan: null, dir, files: [] }
  }
}

/**
 * Discard a character's unstored product-scan results — the per-scene CSVs the Daz
 * script wrote into the scan folder. This clears the review panel; it does NOT
 * touch the products already stored on the character (those live in its JSON).
 * The whole folder is removed — the next scan recreates it. Best-effort.
 */
export async function clearProductScan({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  const project = await resolveProject(projectId)
  const dir = await storage.productScanDir(project.id, id)
  if (await exists(dir)) await remove(dir, { recursive: true })
}

/** Whether `path` is a directory (false, never throws, when it can't be probed).
 *  Used to resolve a dropped folder vs file in the create-project drop zone. */
export async function isDirectory(path: string): Promise<boolean> {
  if (!path) return false
  try {
    return (await stat(path)).isDirectory
  } catch {
    return false
  }
}

const saveInput = z.object({ projectId: z.string().min(1), character: z.unknown() })

export async function saveCharacter({ data }: { data: unknown }): Promise<Character> {
  const { projectId, character } = saveInput.parse(data)
  const project = await resolveProject(projectId)
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

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const uploadImageInput = z.object({
  characterId: z.string().min(1),
  mimeType: z.string(),
  /** Raw image data, base64 (no data-URL prefix). Capped at ~10 MB. */
  dataBase64: z.string().max(14_000_000),
})

/**
 * Stores a dropped avatar image under <data>/images/ and returns its bare
 * filename — the portable canonical reference saved on the character (see
 * ./image). Avatars are global (keyed by character id), not per-project.
 */
export async function uploadCharacterImage({ data }: { data: unknown }): Promise<string> {
  const input = uploadImageInput.parse(data)
  const extension = IMAGE_EXTENSIONS[input.mimeType]
  if (!extension) throw new Error(`Unsupported image type: ${input.mimeType}`)
  const bytes = Uint8Array.from(atob(input.dataBase64), (c) => c.charCodeAt(0))
  // extension is like ".png"; writeAvatarBytes wants the bare "png".
  return writeAvatarBytes(input.characterId, bytes, extension.slice(1))
}

/** Extension → MIME for avatar images dropped as a file path (native drag-drop). */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * Store an avatar image from an absolute file path — native OS drag-drop hands us
 * a path, not file bytes. Reads it, infers the MIME from the extension, and
 * delegates to {@link uploadCharacterImage}.
 */
export async function uploadCharacterImageFromPath({ data }: { data: unknown }): Promise<string> {
  const { characterId, path } = z
    .object({ characterId: z.string().min(1), path: z.string().min(1) })
    .parse(data)
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  const mimeType = IMAGE_MIME[ext]
  if (!mimeType) throw new Error(`Unsupported image type${ext ? `: .${ext}` : ''}`)
  const bytes = await readFile(path)
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Image is larger than 10 MB.')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return uploadCharacterImage({ data: { characterId, mimeType, dataBase64: btoa(binary) } })
}

/** Inline raw image bytes as a `data:` URL, MIME inferred from the file name. */
function bytesToDataUrl(bytes: Uint8Array, fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  const mime = IMAGE_MIME[ext] ?? 'image/png'
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/**
 * Turns a stored `image` reference (see ./image) into a URL the webview can load.
 * External URLs pass through unchanged; a local filename resolves to the avatar in
 * the active project's `.dcsmeta/images`, read as an inline data URL (the asset
 * protocol isn't scoped to arbitrary project folders). Returns '' when there's no
 * active project or the file is missing, so the UI falls back to the placeholder.
 */
export async function resolveImageSrc(image: string): Promise<string> {
  if (!image) return ''
  if (isExternalImage(image)) return image
  const projectDir = await getActiveProjectDir()
  if (!projectDir) return ''
  try {
    const bytes = await readFile(joinPath(storage.metaImagesDir(projectDir), image))
    return bytesToDataUrl(bytes, image)
  } catch {
    return ''
  }
}

/**
 * Preview a picked Daz scene's tip thumbnail (`<scene>.tip.png`) as a data URL.
 * The asset protocol is scoped to the app folder, so an arbitrary scene path
 * can't be served via convertFileSrc — we read the bytes and inline them.
 * Returns '' when there's no tip image.
 */
export async function resolveScenePreview(scenePath: string): Promise<string> {
  if (!scenePath) return ''
  try {
    const tipPath = await findTipImage(scenePath)
    if (!tipPath) return ''
    return bytesToDataUrl(await readFile(tipPath), tipPath)
  } catch {
    return ''
  }
}

// --- Settings + catalog ---------------------------------------------------

export async function fetchSettings(): Promise<StudioSettings> {
  return storage.getSettings()
}

/** The running app's version (e.g. "0.17.0"); '' on the web-only build. */
export async function fetchAppVersion(): Promise<string> {
  return storage.studioVersion()
}

/**
 * The app's internal per-user data folder — where settings.json, projects.json
 * and avatar images live. Surfaced in Settings so the user can find (and back
 * up) the app's state.
 */
export async function fetchAppDataFolder(): Promise<string> {
  return dataPath()
}

// In-memory pose catalog for the app session. The active DTH release's Poses
// folder is scanned (natively, in Rust) on first use and re-scanned when the
// release selection changes — there's no on-disk cache to build, miss, or go
// stale. The scan is small and fast, so one session-lived value is plenty.
// Failed scans (no release / unreachable) are NOT memoized, so fixing Settings
// recovers on the next read without an explicit rescan.
type PoseAssets = Awaited<ReturnType<typeof storage.scanPoseAssets>>
let poseAssets: PoseAssets | null = null

/** The DTH pose presets for the active release — scanned once, then kept in
 *  memory for the session. */
export async function fetchPoseAssets(): Promise<PoseAssets> {
  if (poseAssets) return poseAssets
  const result = await storage.scanPoseAssets()
  if (!result.error) poseAssets = result
  return result
}

/** Re-scan the active release now and refresh the in-memory catalog — call after
 *  the release selection changes or its content is installed/updated. */
export async function rescanPoseAssets(): Promise<PoseAssets> {
  const result = await storage.scanPoseAssets()
  poseAssets = result.error ? null : result
  return result
}

/** Inspect a DTH folder: a single release, or a list of versioned releases. */
export async function listDthReleases({
  data,
}: {
  data: unknown
}): Promise<ReturnType<typeof storage.listDthReleases>> {
  const { folder } = z.object({ folder: z.string() }).parse(data)
  return storage.listDthReleases(folder)
}

/** Inspect a DTH Exporter Plugin folder: a single plugin, or versioned folders. */
export async function listDthExporterReleases({
  data,
}: {
  data: unknown
}): Promise<ReturnType<typeof storage.listDthExporterReleases>> {
  const { folder } = z.object({ folder: z.string() }).parse(data)
  return storage.listDthExporterReleases(folder)
}

const settingsInput = z.object({
  dazLibraryFolder: z.string(),
  dthPosesFolder: z.string(),
  // Tolerate older payloads that predate the field (kept = '' = not chosen).
  currentDthVersion: z.string().default(''),
  dthExporterFolder: z.string().default(''),
  currentDthExporterVersion: z.string().default(''),
  dazInstallFolder: z.string().default(''),
  houdiniDocsFolder: z.string().default(''),
  dimManifestsFolder: z.string().default(''),
  dazAssetsFolders: z.array(z.string()).default([]),
  dazMorphsSource: z.string().default(''),
  dazMorphsDest: z.string().default(''),
  dazPresetsSource: z.string().default(''),
  dazPresetsDest: z.string().default(''),
  houdiniPresetsSource: z.string().default(''),
  acceptedConflicts: z.array(z.string()).default([]),
  dedupQuarantineFolder: z.string().default(''),
  dazUninstallFolders: z.array(z.string()).default([]),
})

export async function saveSettings({ data }: { data: unknown }): Promise<StudioSettings> {
  return storage.saveSettings(settingsInput.parse(data))
}

/** One copy step of the DTH install (mirrors the Rust `InstallStep`). */
export interface InstallStep {
  label: string
  files: number
  status: 'ok' | 'skipped' | 'error' | 'header'
  detail: string
  /** For asset steps: the (capped) list of files an install would copy. */
  filesList?: Array<string>
  /** Set when this asset writes the same library files as another in the report
   *  (e.g. a folder and its .zip) — a "same files as …" duplicate hint. */
  note?: string
}

/** Outcome of a DTH install run (mirrors the Rust `InstallReport`). */
export interface InstallReport {
  dryRun: boolean
  steps: Array<InstallStep>
  totalFiles: number
}

/**
 * Install the DTH *release* content into the local Daz library + (optionally) the
 * Houdini documents folder — a port of the dth-cli `install-daz-dth` /
 * `install-houdini-dth` commands. Path resolution happens here; the recursive
 * copy runs in native Rust (`install_dth_release`). Throws with a combined
 * message when prerequisites are missing. `dryRun` previews without writing.
 */
export async function installDthRelease({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const plan = await storage.resolveReleaseInstall()
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return invoke<InstallReport>('install_dth_release', {
    request: {
      releaseRoot: plan.releaseRoot,
      dazLibFolder: plan.dazLibFolder,
      houdiniDocsFolder: plan.houdiniDocsFolder,
      dryRun: dryRun ?? false,
    },
  })
}

/**
 * Install the Exporter *plugin* DLLs into `<Daz install>/plugins` (the
 * admin-sensitive half) — native `install_dth_plugin`. Throws when prerequisites
 * are missing; `dryRun` previews without writing.
 */
export async function installDthPlugin({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const plan = await storage.resolvePluginInstall()
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  return invoke<InstallReport>('install_dth_plugin', {
    request: {
      exporterFolder: plan.exporterFolder,
      dazInstallFolder: plan.dazInstallFolder,
      dryRun: dryRun ?? false,
    },
  })
}

// --- "Optional" tab: install your own Daz/Houdini content -----------------
// Ports of the dth-cli install-daz-assets / -morphs / -presets / -houdini-presets
// (and list-daz-assets) commands. Paths come from settings; the copy + scan run
// in native Rust. `dryRun` previews; assets/list also report what's already there.

const installOptions = z.object({
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  // The changed-asset names from a prior dry-run/scan — install only those,
  // skipping a re-walk of every already-installed asset. Empty installs all.
  only: z.array(z.string()).optional(),
})

/** Install your own Daz assets (G3/G8/G9, .zip extracted) from the configured
 *  asset folders into "My DAZ 3D Library" — content-folder-aware, overwriting per
 *  asset, skipping ones already installed unless `force`. */
export async function installDazAssets({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun, force, only } = installOptions.parse(data ?? {})
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  const errors: Array<string> = []
  if (!sources.length) errors.push('Add at least one Daz assets folder')
  if (!s.dazLibraryFolder.trim()) errors.push('Set “My DAZ 3D Library”')
  if (errors.length) throw new Error(errors.join('\n'))
  return invoke<InstallReport>('install_daz_assets', {
    request: {
      sources,
      dest: s.dazLibraryFolder.trim(),
      force: force ?? false,
      dryRun: dryRun ?? false,
      only: only ?? [],
      accepted: s.acceptedConflicts,
    },
  })
}

/** Read-only scan of the asset folders — what content each holds and whether it's
 *  already installed in the library. */
export async function listDazAssets(): Promise<InstallReport> {
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return invoke<InstallReport>('list_daz_assets', {
    request: { sources, dest: s.dazLibraryFolder.trim(), accepted: s.acceptedConflicts },
  })
}

/** Accept files as legitimately shared between products — they stop showing as
 *  "to copy" / as a conflict (left as whatever is installed). Returns the updated
 *  accepted list. Pass `clear: true` with the same paths to un-accept them. */
export async function setAcceptedConflicts(
  rels: Array<string>,
  clear = false,
): Promise<Array<string>> {
  const s = await storage.getSettings()
  const set = new Set(s.acceptedConflicts)
  for (const r of rels) {
    if (clear) set.delete(r)
    else set.add(r)
  }
  const acceptedConflicts = [...set].sort()
  await storage.saveSettings({ ...s, acceptedConflicts })
  return acceptedConflicts
}

/** One copy of a conflicting shared file (mirrors Rust `ConflictCopy`). */
export interface ConflictCopy {
  label: string
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: string
  size: number
  inZip: boolean
}
/** A file shipped by 2+ different products at different sizes. Informational —
 *  resolved by Accept (never rewritten). */
export interface FileConflict {
  rel: string
  copies: Array<ConflictCopy>
}
/** One copy in a duplicate group. */
export interface DupMember {
  label: string
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: string
  fileCount: number
  isZip: boolean
  /** The copy kept (others are quarantined) — auto-picked, user-overridable. */
  isKeeper: boolean
}
/** A set of assets that are the same content — identical ('exact') or the same
 *  product at a different version ('version', e.g. a …UD vs …UPDATE). */
export interface AssetDup {
  members: Array<DupMember>
  kind: 'exact' | 'version'
  fixed: boolean
}
/** Result of the dedup scan/apply (mirrors Rust `DedupReport`). */
export interface DedupReport {
  dryRun: boolean
  conflicts: Array<FileConflict>
  duplicates: Array<AssetDup>
  assetsQuarantined: number
  backupDir: string
}

/** Find (dry run) or resolve duplicate assets + conflicting shared files. Apply
 *  rewrites every smaller copy — and the library copy — to the largest version,
 *  and quarantines redundant duplicate assets. Reversible (originals backed up). */
export async function dedupDazAssets({ data }: { data: unknown }): Promise<DedupReport> {
  const { dryRun, keepers } = z
    .object({ dryRun: z.boolean().optional(), keepers: z.array(z.string()).optional() })
    .parse(data ?? {})
  const s = await storage.getSettings()
  const sources = s.dazAssetsFolders.map((f) => f.trim()).filter(Boolean)
  if (!sources.length) throw new Error('Add at least one Daz assets folder')
  return invoke<DedupReport>('dedup_daz_assets', {
    request: {
      sources,
      dryRun: dryRun ?? false,
      accepted: s.acceptedConflicts,
      keepers: keepers ?? [],
      quarantine: s.dedupQuarantineFolder.trim(),
    },
  })
}

/** The default leftover-Daz-folder list (dth-cli `uninstall-daz` defaults: the
 *  library root, common Documents/Public spots, APPDATA DAZ 3D + Start Menu). */
export async function defaultDazUninstallFolders(): Promise<Array<string>> {
  const s = await storage.getSettings()
  return invoke<Array<string>>('default_daz_uninstall_folders', {
    request: { dazLibFolder: s.dazLibraryFolder.trim() },
  })
}

/** DANGER: recursively delete the configured leftover Daz folders (run after
 *  removing Daz Studio / DIM via Add or Remove Programs). `dryRun` only previews. */
export async function uninstallDaz({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const s = await storage.getSettings()
  const folders = s.dazUninstallFolders.map((f) => f.trim()).filter(Boolean)
  if (!folders.length) throw new Error('No folders to clean up')
  return invoke<InstallReport>('uninstall_daz', { request: { folders, dryRun: dryRun ?? false } })
}

/** The companion DazToHue-Scripts repo (the runtime the studio co-owns). */
export const DAZTOHUE_SCRIPTS_REPO = 'https://github.com/soltude/DazToHue-Scripts'

/**
 * Download the soltude/DazToHue-Scripts repo as a zip and install it into
 * `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`. The download + unpack run
 * natively in Rust (the webview can't fetch the archive — codeload's CORS only
 * allows render.githubusercontent.com); GitHub's top-level wrapper folder is
 * stripped so the repo files land directly in the folder. `dryRun` downloads +
 * counts only. Throws when "My DAZ 3D Library" isn't set.
 */
export async function installDazToHueScripts({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = z.object({ dryRun: z.boolean().optional() }).parse(data ?? {})
  const s = await storage.getSettings()
  const lib = s.dazLibraryFolder.trim()
  if (!lib) throw new Error('Set “My DAZ 3D Library” first')
  return invoke<InstallReport>('install_daztohue_scripts', {
    request: { dest: storage.daztohueScriptsDir(lib), dryRun: dryRun ?? false },
  })
}

/** The latest available DazToHue-Scripts commit (HEAD of `main` on GitHub),
 *  fetched natively (the webview can't hit the GitHub API — CORS). Desktop-only;
 *  throws on web/offline/rate-limit, which {@link dazToHueScriptsStatus} treats as
 *  "couldn't check". */
export async function latestDazToHueCommit(): Promise<string> {
  return invoke<string>('latest_daztohue_commit')
}

export type DazToHueScriptsState =
  | 'uptodate'
  | 'outdated'
  /** Files present but no version marker — installed before we tracked commits. */
  | 'unversioned'
  | 'notinstalled'
  /** Installed (have a local commit) but the remote check couldn't run. */
  | 'unknown'

export interface DazToHueScriptsStatus {
  /** Commit recorded in the local install's marker (null → no marker). */
  installed: string | null
  /** Latest commit on GitHub (null → the remote check failed). */
  latest: string | null
  state: DazToHueScriptsState
}

/**
 * Whether the locally installed DazToHue-Scripts are up to date: compares the
 * commit the installer recorded against the current HEAD on GitHub. Never throws —
 * a failed remote check reports `unknown` (so the UI still shows what's installed),
 * and nothing installed reports `notinstalled`.
 */
export async function dazToHueScriptsStatus(): Promise<DazToHueScriptsStatus> {
  const s = await storage.getSettings()
  const lib = s.dazLibraryFolder.trim()
  const installed = await storage.readDazToHueScriptsCommit(lib)
  let latest: string | null = null
  try {
    latest = await latestDazToHueCommit()
  } catch {
    latest = null // offline / rate-limited / web build — surfaced as "unknown"
  }
  let state: DazToHueScriptsState
  if (installed) {
    state = !latest ? 'unknown' : installed === latest ? 'uptodate' : 'outdated'
  } else {
    // No marker: a pre-versioning install (files present) vs no install at all.
    state = (lib && (await storage.daztohueScriptsPresent(lib))) ? 'unversioned' : 'notinstalled'
  }
  return { installed, latest, state }
}

/** Merge-only install (adds new files, never overwrites) used for custom morphs
 *  and presets — `which` picks the source/dest pair from settings. */
async function installMerge(
  which: 'morphs' | 'presets',
  dryRun: boolean,
): Promise<InstallReport> {
  const s = await storage.getSettings()
  const label = which === 'morphs' ? 'Custom morphs' : 'Daz presets'
  const source = which === 'morphs' ? s.dazMorphsSource.trim() : s.dazPresetsSource.trim()
  const dest = which === 'morphs' ? s.dazMorphsDest.trim() : s.dazPresetsDest.trim()
  const errors: Array<string> = []
  if (!source) errors.push(`Set the ${label.toLowerCase()} source folder`)
  if (!dest) errors.push(`Set the ${label.toLowerCase()} destination folder`)
  if (errors.length) throw new Error(errors.join('\n'))
  return invoke<InstallReport>('install_daz_merge', {
    request: { label, source, dest, dryRun },
  })
}

export async function installDazMorphs({ data }: { data: unknown }): Promise<InstallReport> {
  return installMerge('morphs', installOptions.parse(data ?? {}).dryRun ?? false)
}

export async function installDazPresets({ data }: { data: unknown }): Promise<InstallReport> {
  return installMerge('presets', installOptions.parse(data ?? {}).dryRun ?? false)
}

/** Install your Houdini `my_presets` into the Houdini docs folder (overwriting)
 *  and wire it into that version's `houdini.env`. */
export async function installHoudiniPresets({ data }: { data: unknown }): Promise<InstallReport> {
  const { dryRun } = installOptions.parse(data ?? {})
  const s = await storage.getSettings()
  const errors: Array<string> = []
  if (!s.houdiniPresetsSource.trim()) errors.push('Set the Houdini presets source folder')
  if (!s.houdiniDocsFolder.trim()) errors.push('Set the Houdini documents folder')
  if (errors.length) throw new Error(errors.join('\n'))
  return invoke<InstallReport>('install_houdini_presets', {
    request: {
      source: s.houdiniPresetsSource.trim(),
      houdiniDocs: s.houdiniDocsFolder.trim(),
      dryRun: dryRun ?? false,
    },
  })
}

// --- Network drives -------------------------------------------------------

/** Outcome of trying to ensure one known network drive is mapped (mirrors Rust). */
export interface RemapResult {
  drive: string
  unc: string
  status: 'already' | 'remapped' | 'conflict' | 'failed' | 'unsupported'
  detail: string
}

/** UNC a mapped network drive points to ("X:\…" → "\\host\share"), or '' when
 *  the path isn't on a (mapped) network drive / the native command is absent. */
export async function uncForPath(path: string): Promise<string> {
  try {
    return (await invoke<string | null>('unc_for_path', { path })) ?? ''
  } catch {
    return ''
  }
}

/**
 * If `path` lives on a mapped network drive, remember that drive→UNC mapping so
 * it can be re-mapped later (e.g. after relaunching elevated). Fire-and-forget,
 * called as folders/files are picked; a no-op off Windows / in web-only mode.
 */
export async function rememberNetworkPath(path: string): Promise<void> {
  if (!path || path[1] !== ':') return
  const unc = await uncForPath(path)
  if (unc) await storage.rememberDrive(path.slice(0, 2), unc)
}

/** Re-map any known network drives that aren't currently available. Runs on
 *  startup; returns a per-drive report. No-op (empty) off Windows / web-only. */
export async function ensureNetworkDrives(): Promise<Array<RemapResult>> {
  try {
    const mappings = await storage.listKnownDrives()
    if (mappings.length === 0) return []
    return await invoke<Array<RemapResult>>('ensure_network_drives', { mappings })
  } catch {
    return []
  }
}

export async function fetchKnownDrives(): Promise<Array<storage.KnownDrive>> {
  return storage.listKnownDrives()
}

/** Version of the exporter DLL already installed in `<dazInstall>/plugins` (''=none). */
export async function installedExporterVersion(dazInstallFolder: string): Promise<string> {
  try {
    return await storage.installedExporterVersion(dazInstallFolder)
  } catch {
    return ''
  }
}

export async function forgetNetworkDrive({ data }: { data: unknown }): Promise<void> {
  await storage.forgetDrive(z.object({ drive: z.string().min(1) }).parse(data).drive)
}

// --- Pose-asset frame measurement -----------------------------------------

interface MeasuredFrames {
  frames: number
  error: string
}

/** Measure the frame length of each `.duf` via the native command. */
async function measureFrames(paths: Array<string>): Promise<Map<string, MeasuredFrames>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const results = await invoke<Array<{ path: string; frames: number; error: string }>>(
    'pose_asset_frames',
    { paths: unique },
  )
  return new Map(results.map((r) => [r.path, { frames: r.frames, error: r.error }]))
}

/**
 * Measure the preset ROM block lengths (base JCM/RET/FAC, GP, DK, Physics) for a
 * character from the actual `.duf` assets — read on the fly, nothing hard-coded,
 * custom assets measured the same way as DTH ones. **Throws** when an included
 * block's asset can't be found or read, so a missing/bad `.duf` can never
 * silently produce a wrong-length ROM. `gp`/`dk`/`phys` are 0 when not included.
 */
export async function resolvePresetFrames(
  character: Character,
  catalog?: PoseAssets,
): Promise<PresetFrames> {
  const cat = catalog ?? (await fetchPoseAssets())
  const romPaths = cat.error ? {} : resolveRomPaths(character, cat)
  const { sections, gender } = character
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(gender, sections.GEN.presetAssets)

  const basePath =
    sections.JCM.mode === 'custom' ? sections.JCM.customAssetPath.trim() : (romPaths.jcm ?? '')
  const blocks: Array<{
    key: keyof PresetFrames
    label: string
    need: boolean
    path: string
  }> = [
    { key: 'base', label: 'base ROM (JCM / RET / FAC)', need: jcmIsBaseRom(sections), path: basePath },
    { key: 'gp', label: 'Golden Palace', need: genPreset && roms.gp, path: romPaths.gp ?? '' },
    { key: 'dk', label: 'Dicktator', need: genPreset && roms.dk, path: romPaths.dk ?? '' },
    {
      key: 'phys',
      label: 'Physics',
      need: sections.PHY.enabled && sections.PHY.mode === 'preset',
      path: romPaths.phys ?? '',
    },
  ]

  const measured = await measureFrames(blocks.filter((b) => b.need).map((b) => b.path))
  const frames: PresetFrames = { base: 0, gp: 0, dk: 0, phys: 0 }
  for (const block of blocks) {
    if (!block.need) continue
    if (!block.path) {
      throw new Error(
        `Couldn't locate the ${block.label} pose asset — rescan the poses in Settings.`,
      )
    }
    const hit = measured.get(block.path)
    if (!hit || hit.error) {
      throw new Error(`Couldn't read frames from the ${block.label} asset:\n${hit?.error ?? block.path}`)
    }
    frames[block.key] = hit.frames
  }
  return frames
}

/**
 * Compiles the character into its DTH artifacts and writes them to two places:
 *  - the Houdini PoseAsset CSV → the character's own folder (next to its
 *    definition JSON), and
 *  - the self-contained Daz script (<Name>_<Genesis>.dsa) → a per-character
 *    subfolder `<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/`.
 *    The DTH runtime files it imports are installed ONCE in that root (copied
 *    from the DazToHue-Scripts checkout); the script imports them two levels up.
 *    Returns the files so the UI can offer downloads.
 */
export async function generateCharacterFiles({ data }: { data: unknown }): Promise<{
  outDir: string
  files: ReturnType<typeof generateAll>
  scriptsDir: string | null
  scriptsError: string | null
}> {
  const { projectId, id, previousName, targets } = generateInput.parse(data)
  // Which artifact groups to (re)write. The editor's Generate writes both; a
  // selective Refresh asks for only the Daz scripts (runtime change) or only the
  // Houdini CSV (DTH-era change).
  const writeDaz = targets?.daz ?? true
  const writeHoudini = targets?.houdini ?? true
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const character = await storage.getCharacter(lib, id)
  if (!character) throw new Error(`Character ${id} not found`)
  // Exact ROM paths from the active release's pose scan; {} when the folder is
  // unavailable — the script then falls back to DthOptions resolution.
  const catalog = await fetchPoseAssets()
  const romPaths = catalog.error ? {} : resolveRomPaths(character, catalog)
  // Frame lengths measured live from the actual .duf assets (hard-errors if an
  // included block can't be read — never a wrong-length ROM).
  const frames = await resolvePresetFrames(character, catalog)
  // The character's own folder holds the canonical PoseAsset CSV. Its absolute
  // path is baked into the generated script so the script can move the CSV into
  // the resolved export dir (scene subfolder included) when it runs in Daz.
  const outDir = await storage.getCharacterFolder(lib, id)
  // Stamp the generating studio version into the script header for traceability.
  const versioned = { ...character, studioVersion: await storage.studioVersion() }
  // The active DTH release selects the PoseAsset CSV era/variant (the Daz scripts
  // are release-independent — tied to RUNTIME_VERSION only).
  const activeRelease = catalog.error ? '' : catalog.version
  const settings = await storage.getSettings()
  // When the project enables Daz Products, also emit the per-character product-scan
  // script. The "on" flag + the DIM folder + the derived per-scene output folder
  // reach the pure core only here, as the trailing generateAll argument.
  const scanProducts = project.dazProductsEnabled
    ? {
        dimManifestPath: settings.dimManifestsFolder,
        outputDir: await storage.productScanDir(project.id, character.id),
        dazLibraryFolder: settings.dazLibraryFolder,
      }
    : undefined
  const files = generateAll(versioned, romPaths, frames, outDir, activeRelease, scanProducts)

  // Houdini deliverable(s) — <Name>_pose_asset.csv — live in the character's own folder.
  if (writeHoudini) {
    await storage.writeFilesToFolder(
      outDir,
      files.filter((file) => file.target === 'houdini'),
    )
    // After a rename the PoseAsset filename changes too — drop the old-named one
    // that traveled with the folder.
    if (previousName) {
      const oldPose = poseAssetFileName({ ...character, name: previousName })
      if (oldPose !== poseAssetFileName(character)) {
        await storage.removeFilesFromFolder(outDir, [oldPose])
      }
    }
    // Drop the legacy-cased CSV (<name>_PoseAsset.csv) left by older versions —
    // the file is now <name>_pose_asset.csv.
    const legacyPose = poseAssetFileName(character).replace(/_pose_asset\.csv$/, '_PoseAsset.csv')
    await storage.removeFilesFromFolder(outDir, [legacyPose])
    // Record which DTH release the CSV was generated for (its era drives staleness).
    await storage.setGeneratedDthVersion(lib, id, activeRelease)
  }

  // The PoseAsset CSV is delivered to the export dir by the generated Daz script
  // when it runs — it copies the CSV from the character folder into the resolved
  // export dir (scene subfolder included), next to the exporter's .abc/.dth. So
  // the studio no longer copies it to the export root here (the scene subfolder
  // isn't known until run time anyway).

  // The character script goes in its own <project>/<character>/ subfolder of the
  // shared scripts folder; the runtime it imports is installed once in the root.
  const dazFiles = files.filter((file) => file.target === 'daz')
  let scriptsDir: string | null = null
  let scriptsError: string | null = null
  if (writeDaz && !settings.dazLibraryFolder) {
    scriptsError = 'Set “My DAZ 3D Library” to install the character script'
  } else if (writeDaz) {
    const root = storage.studioScriptsDir(settings.dazLibraryFolder)
    const charDir = storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name)
    try {
      await storage.copyRuntimeFiles(root)
      await storage.writeFilesToFolder(charDir, dazFiles)
      // Drop the other script variant when the combined/split choice changed, and
      // the scan script when Daz Products is turned off: keep only the .dsa names
      // just written (<base>, ROM_<base>, Export_<base>, Scan_Products_<slug>).
      const dazBase = characterScriptName(character)
      const writtenDaz = dazFiles.map((file) => file.fileName)
      await storage.removeFilesFromFolder(
        charDir,
        [
          `${dazBase}.dsa`,
          `ROM_${dazBase}.dsa`,
          `Export_${dazBase}.dsa`,
          `Scan_Products_${characterSlug(character)}.dsa`,
        ].filter((name) => !writtenDaz.includes(name)),
      )
      // Migration: older versions wrote the script flat in the root — drop this
      // character's flat-layout script (current + previous name) if it lingers.
      await storage.removeFilesFromFolder(root, [
        `${characterScriptName(character)}.dsa`,
        ...(previousName ? [`${characterScriptName({ ...character, name: previousName })}.dsa`] : []),
      ])
      // After a rename the character subfolder name changes — remove the stale one.
      if (previousName) {
        const oldCharDir = storage.studioCharScriptsDir(
          settings.dazLibraryFolder,
          project.name,
          previousName,
        )
        if (oldCharDir !== charDir && (await exists(oldCharDir))) {
          await remove(oldCharDir, { recursive: true })
        }
      }
      scriptsDir = charDir
    } catch (error) {
      scriptsError = error instanceof Error ? error.message : String(error)
    }
  }
  return { outDir, files, scriptsDir, scriptsError }
}

/** One character's outcome in a {@link refreshAllAssets} run. */
export interface RefreshResult {
  project: string
  character: string
  /** false = generation threw (e.g. an asset couldn't be measured). */
  ok: boolean
  /** Generation error (when !ok) or a soft warning (e.g. scripts skipped). */
  detail?: string
}

export interface RefreshSummary {
  /** Characters actually (re)generated this run (= regenerated + failed). */
  total: number
  regenerated: number
  failed: number
  /** Characters left untouched because nothing of theirs was out of date (only on a
   *  targeted refresh; a forced full refresh regenerates everyone, so 0). */
  skipped: number
  /** Per-artifact counts of what was actually (re)written — so the UI can say
   *  exactly what happened, not just "N characters". */
  counts: {
    /** Character definitions migrated + re-saved (schema was out of date). */
    migrated: number
    /** Characters whose Daz scripts (ROM/Export) were regenerated. */
    scripts: number
    /** Characters whose PoseAsset CSV was regenerated. */
    csv: number
  }
  results: Array<RefreshResult>
  /** Outcome of refreshing the bundled DTH runtime files (null = not refreshed this
   *  run — no DAZ library, or no character needed its scripts rewritten). */
  runtime: { ok: boolean; detail?: string } | null
}

/**
 * Re-generate the derived artifacts across the in-scope projects (this window's
 * active project, or every known project from Home — see {@link projectsForSweep}),
 * **selectively**:
 *  - If anything is out of date, each character regenerates only its affected
 *    artifact(s) — `runtime` → the bundled runtime files + that character's Daz
 *    scripts (their call API may have changed); `csv` → the PoseAsset CSV (its DTH
 *    era changed); `schema` → migrate + re-save the JSON, then regenerate both
 *    (a migration can change generated output). Characters with nothing stale are
 *    skipped.
 *  - If nothing is out of date (the user clicked Refresh anyway), it's a forced
 *    full refresh: every character regenerates everything.
 * Per-character failures are collected, not thrown, so one bad character can't
 * abort the sweep.
 */
export async function refreshAllAssets(): Promise<RefreshSummary> {
  const settings = await storage.getSettings()
  const hasDazLibrary = Boolean(settings.dazLibraryFolder)
  const catalog = await fetchPoseAssets()
  const activeRelease = catalog.error ? '' : catalog.version
  const opts = { hasDazLibrary, hasDthRelease: activeRelease !== '' }
  const app = { schema: CHARACTER_SCHEMA_VERSION, runtime: RUNTIME_VERSION, dthRelease: activeRelease }

  // Pass 1 — gather every character with its staleness, so we can tell a targeted
  // refresh (some mismatch → regenerate only what's affected) from a forced full
  // refresh (nothing stale, the user clicked anyway → regenerate everything).
  // Scope follows the window: the active project in a project window, every known
  // project (recents) from the Home window — see projectsForSweep.
  const projects = await projectsForSweep()
  const results: Array<RefreshResult> = []
  const items: Array<{ project: ProjectInfo; character: Character; targets: StaleTargets }> = []
  for (const project of projects) {
    let characters: Array<Character>
    try {
      characters = await storage.listCharacters(charsRoot(project))
    } catch (e) {
      results.push({
        project: project.name,
        character: '(project unreachable)',
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
      continue
    }
    for (const character of characters) {
      const runtimeVersion = hasDazLibrary
        ? await storage.readScriptRuntimeVersion(settings.dazLibraryFolder, project.name, character)
        : null
      const status: CharacterAssetStatus = {
        projectId: project.path,
        project: project.name,
        character: character.name,
        schemaVersion: character.schemaVersion,
        runtimeVersion,
        generatedDthVersion: character.generatedDthVersion,
      }
      items.push({ project, character, targets: characterStaleTargets(status, app, opts) })
    }
  }

  const force = !items.some((i) => i.targets.schema || i.targets.runtime || i.targets.csv)

  // Refresh the bundled runtime files once when scripts will be (re)written — any
  // runtime mismatch, or a forced full refresh.
  let runtime: RefreshSummary['runtime'] = null
  if (hasDazLibrary && (force || items.some((i) => i.targets.runtime))) {
    try {
      await storage.copyRuntimeFiles(storage.studioScriptsDir(settings.dazLibraryFolder))
      runtime = { ok: true }
    } catch (e) {
      runtime = { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  // Pass 2 — regenerate per character. A schema change regenerates both artifacts
  // (the migration can alter generated output); runtime → Daz scripts; csv → CSV.
  let skipped = 0
  const counts = { migrated: 0, scripts: 0, csv: 0 }
  for (const { project, character, targets } of items) {
    const regenSchema = force || targets.schema
    const regenDaz = force || targets.runtime || targets.schema
    const regenHoudini = force || targets.csv || targets.schema
    if (!regenSchema && !regenDaz && !regenHoudini) {
      skipped += 1
      continue
    }
    try {
      // A character read at an older schema is already migrated in-memory
      // (parseCharacter); re-saving stamps the current version, clearing the stale
      // state. Independent of the DAZ library.
      if (regenSchema && character.schemaVersion < CHARACTER_SCHEMA_VERSION) {
        await storage.saveCharacter(project, character, charsRoot(project))
        counts.migrated += 1
      }
      const res = await generateCharacterFiles({
        data: {
          projectId: project.path,
          id: character.id,
          targets: { daz: regenDaz, houdini: regenHoudini },
        },
      })
      // Scripts only count when they were actually written (no DAZ library → soft
      // scriptsError, nothing on disk); the CSV always writes to the project folder.
      if (regenDaz && !res.scriptsError) counts.scripts += 1
      if (regenHoudini) counts.csv += 1
      results.push({
        project: project.name,
        character: character.name,
        ok: true,
        detail: res.scriptsError ?? undefined,
      })
    } catch (e) {
      results.push({
        project: project.name,
        character: character.name,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const failed = results.filter((r) => !r.ok).length
  return {
    total: results.length,
    regenerated: results.length - failed,
    failed,
    skipped,
    counts,
    results,
    runtime,
  }
}

/** One character's local asset-version status in a {@link detectAssetVersions} run. */
export interface CharacterAssetStatus {
  projectId: string
  project: string
  character: string
  /** Schema version stored in the character's JSON definition. */
  schemaVersion: number
  /** Runtime version read from the character's generated Daz script — `null` when
   *  no script has been generated yet (or no DAZ library is configured). */
  runtimeVersion: number | null
  /** DTH release the character's PoseAsset CSV was last generated for (from the
   *  JSON's `generatedDthVersion`; '' when never generated). Staleness compares its
   *  CSV *era* (see {@link poseAssetCsvEra}), not the exact string. */
  generatedDthVersion: string
}

export interface AssetVersionReport {
  /** The versions the CURRENT app generates with. `dthRelease` is the active DTH
   *  release ('' when none is configured). */
  app: { schema: number; runtime: number; dthRelease: string }
  characters: Array<CharacterAssetStatus>
  total: number
  /** Distinct characters that need updating — an older definition schema (migrated
   *  by a re-save), an older/missing script runtime, or a CSV generated for a
   *  different DTH era than the active release. Refresh clears every cause. */
  staleCount: number
  /** A DAZ library is configured, so generated-script (runtime) versions can be
   *  checked and regenerated. Schema + CSV checks do NOT require it. */
  hasDazLibrary: boolean
  /** A DTH release is configured, so the CSV era can be compared. */
  hasDthRelease: boolean
  /** Some character is out of date → a Refresh is needed. Drives the banner and the
   *  startup redirect; Refresh fixes every cause (migrate + regenerate), so it
   *  converges (no redirect loop). */
  refreshNeeded: boolean
}

/** Which of a character's three artifact groups are out of date. */
export interface StaleTargets {
  /** Definition JSON is on an older schema — migrate + re-save (then regenerate). */
  schema: boolean
  /** Daz scripts (runtime + character scripts) are on an older/missing runtime. */
  runtime: boolean
  /** PoseAsset CSV was generated for a different DTH era — regenerate the CSV. */
  csv: boolean
}

/**
 * Which artifacts are out of date versus what the app now produces:
 *  - `schema`: JSON below CHARACTER_SCHEMA_VERSION.
 *  - `runtime`: script missing or older than RUNTIME_VERSION — judged only when a
 *    DAZ library is configured (no library → no scripts to compare).
 *  - `csv`: the CSV's DTH *era* differs from the active release's era — judged only
 *    when a DTH release is configured. Needs NO DAZ library: the CSV and its
 *    provenance live in the project folder / JSON.
 * Shared by detection, the Refresh table, and the selective refresh so all three
 * judge staleness identically.
 */
export function characterStaleTargets(
  c: CharacterAssetStatus,
  app: AssetVersionReport['app'],
  opts: { hasDazLibrary: boolean; hasDthRelease: boolean },
): StaleTargets {
  return {
    schema: c.schemaVersion < app.schema,
    runtime: opts.hasDazLibrary && (c.runtimeVersion === null || c.runtimeVersion < app.runtime),
    csv:
      opts.hasDthRelease &&
      poseAssetCsvEra(c.generatedDthVersion) !== poseAssetCsvEra(app.dthRelease),
  }
}

/** Whether a character is out of date in ANY of its three artifacts. */
export function isCharacterStale(
  c: CharacterAssetStatus,
  app: AssetVersionReport['app'],
  opts: { hasDazLibrary: boolean; hasDthRelease: boolean },
): boolean {
  const t = characterStaleTargets(c, app, opts)
  return t.schema || t.runtime || t.csv
}

/**
 * Detect, across the in-scope projects (this window's active project, or every
 * known project from Home — see {@link projectsForSweep}), which character-JSON
 * **schema**, generated **script runtime**, and **PoseAsset-CSV DTH release** each
 * character is on locally, versus what the current app produces. Schema + CSV come from
 * each JSON (the CSV's release is its `generatedDthVersion` provenance); the
 * runtime is read back from each character's generated Daz script header. Feeds the
 * Refresh assets page, the About summary, and the startup "refresh needed?" check.
 */
export async function detectAssetVersions(): Promise<AssetVersionReport> {
  const settings = await storage.getSettings()
  const hasDazLibrary = Boolean(settings.dazLibraryFolder)
  const catalog = await fetchPoseAssets()
  const activeRelease = catalog.error ? '' : catalog.version
  const hasDthRelease = activeRelease !== ''
  const app = { schema: CHARACTER_SCHEMA_VERSION, runtime: RUNTIME_VERSION, dthRelease: activeRelease }

  const characters: Array<CharacterAssetStatus> = []
  // Scope follows the window: the active project in a project window, every known
  // project (recents) from the Home window — see projectsForSweep.
  const projects = await projectsForSweep()
  for (const project of projects) {
    let chars: Array<Character>
    try {
      chars = await storage.listCharacters(charsRoot(project))
    } catch {
      continue // unreachable project — an actual refresh run surfaces the error
    }
    for (const character of chars) {
      const runtimeVersion = hasDazLibrary
        ? await storage.readScriptRuntimeVersion(settings.dazLibraryFolder, project.name, character)
        : null
      characters.push({
        projectId: project.path,
        project: project.name,
        character: character.name,
        schemaVersion: character.schemaVersion,
        runtimeVersion,
        generatedDthVersion: character.generatedDthVersion,
      })
    }
  }

  const staleCount = characters.filter((c) =>
    isCharacterStale(c, app, { hasDazLibrary, hasDthRelease }),
  ).length
  return {
    app,
    characters,
    total: characters.length,
    staleCount,
    hasDazLibrary,
    hasDthRelease,
    refreshNeeded: staleCount > 0,
  }
}

/**
 * Lightweight startup probe: true when generated scripts are out of date versus
 * this app's runtime (so the app should send the user to Refresh assets). Never
 * throws — any failure (no native layer, unreadable disk) reports "not needed".
 */
export async function isRefreshNeeded(): Promise<boolean> {
  try {
    return (await detectAssetVersions()).refreshNeeded
  } catch {
    return false
  }
}

/** Where a character's files live (absolute + library-relative), for the editor. */
export async function getCharacterPath({
  data,
}: {
  data: unknown
}): Promise<storage.CharacterLocation | null> {
  const { projectId, id } = charScopeInput.parse(data)
  return storage.getCharacterPath(await charactersRoot(projectId), id)
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
  return storage.moveCharacter(await charactersRoot(projectId), id, relPath)
}
