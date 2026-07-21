import { exists, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { withBusyCursor } from '../../busy-cursor.ts'

import * as storage from '../storage'
import { normalizeRelFolder } from '../library'
import {
  cacheCharacterLocation,
  charsRoot,
  dirname,
  getActiveProjectDir,
  invalidateCharacterLocations,
  joinPath,
  projectIdInput,
  projectPath,
  resolveProject,
} from './core'
import { generateCharacterFiles } from './generate'

import type { ProjectInfo } from './core'

// --- Projects (.dcsp files) -----------------------------------------------
// Projects are folders marked by a `.dcsp` manifest, opened one-per-window. The
// app keeps only a volatile recents list; opening/creating a project opens (or
// focuses) its own window. The route param `projectId` is the project's folder.

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

/**
 * Record the window's association-opened project in recents. A `.dcsp` launched
 * via the OS file association boots straight into `activeProjectFile()` without
 * going through {@link openProject}, so without this it never lands in recents —
 * and since recents IS the project registry, the Home screen and every
 * cross-project sweep (Refresh assets, note-media GC, version detection) would
 * skip it. Best-effort: never blocks or fails boot.
 */
export async function rememberActiveProject(dcspPath: string): Promise<void> {
  try {
    const dcsp = joinPath(dcspPath)
    if (!(await exists(dcsp))) return
    const manifest = await storage.readManifest(dirname(dcsp))
    await storage.rememberRecent(dcsp, manifest.name)
  } catch {
    // A boot-time recents write must never break window startup.
  }
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

/** Save a project's behaviour defaults (the `.dcsp` manifest's per-project
 *  fields) — defaults come from the manifest's own single copy. */
const projectSettingsInput = z.object({
  projectId: z.string().min(1),
  dazSubdir: z.string().default(storage.PROJECT_BEHAVIOR_DEFAULTS.dazSubdir),
  houdiniSubdir: z.string().default(storage.PROJECT_BEHAVIOR_DEFAULTS.houdiniSubdir),
  createHoudiniSubdir: z.boolean().default(storage.PROJECT_BEHAVIOR_DEFAULTS.createHoudiniSubdir),
  assetsEnabled: z.boolean().default(storage.PROJECT_BEHAVIOR_DEFAULTS.assetsEnabled),
  dazProductsEnabled: z.boolean().default(storage.PROJECT_BEHAVIOR_DEFAULTS.dazProductsEnabled),
  charactersSubdir: z.string().default(storage.PROJECT_BEHAVIOR_DEFAULTS.charactersSubdir),
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
  // Validate + normalise EVERY relative-folder field through the same gate
  // (throws on absolute paths / `..` / illegal chars). '' = project root for
  // charactersSubdir, "use the default" for the daz/houdini subdirs (readManifest
  // fills those back in). Nested values like `scenes/daz` are legit.
  const nextCharactersSubdir = normalizeRelFolder(charactersSubdir)
  const nextDazSubdir = normalizeRelFolder(dazSubdir)
  const nextHoudiniSubdir = normalizeRelFolder(houdiniSubdir)
  // The characters subfolder defines where character folders live, so a change must
  // move the existing folders to the new location (links inside them are repointed).
  // Done before writing the manifest, so the manifest can be written to match
  // where the folders ACTUALLY ended up.
  let moveResult: storage.MoveCharactersRootResult | null = null
  if (nextCharactersSubdir !== manifest.charactersSubdir) {
    const oldRoot = manifest.charactersSubdir ? joinPath(dir, manifest.charactersSubdir) : dir
    const newRoot = nextCharactersSubdir ? joinPath(dir, nextCharactersSubdir) : dir
    // Every character folder physically moves — the cached locations are all stale.
    invalidateCharacterLocations()
    moveResult = await withBusyCursor(storage.moveCharactersRoot(oldRoot, newRoot))
  }
  // Decide which characters-root the manifest records — it must match REALITY:
  //  - clean move (or no move): the requested new subdir;
  //  - partial failure, fully rolled back: everything is back at the old root →
  //    keep the OLD subdir (the "Characters folder" change simply didn't happen);
  //  - partial failure AND failed rollback: characters live at both roots →
  //    follow the MAJORITY so the scan sees as many as possible.
  // Either failure case throws below, AFTER the manifest write, with a precise report.
  let manifestCharactersSubdir = nextCharactersSubdir
  let moveError: string | null = null
  if (moveResult && moveResult.moveFailures.length > 0) {
    const blocked = moveResult.moveFailures.map((f) => `${f.src} (${f.error})`).join('; ')
    if (moveResult.atNewRoot === 0) {
      manifestCharactersSubdir = manifest.charactersSubdir
      moveError =
        `Couldn't move the character folders — the change was rolled back, and the ` +
        `"Characters folder" setting was left unchanged. Blocked by: ${blocked}`
    } else if (moveResult.atNewRoot >= moveResult.atOldRoot) {
      manifestCharactersSubdir = nextCharactersSubdir
      moveError =
        `Partially moved the character folders: ${moveResult.atOldRoot} character(s) could not be ` +
        `moved and are still at the old location — move them by hand or retry. Blocked by: ${blocked}`
    } else {
      manifestCharactersSubdir = manifest.charactersSubdir
      moveError =
        `Couldn't move the character folders, and ${moveResult.atNewRoot} character(s) could not be ` +
        `rolled back — they are stranded at the new location while the project still uses the old ` +
        `one. Move them back by hand. Blocked by: ${blocked}`
    }
  }
  // Write the manifest so it points at where the folders actually are now,
  // even when part of the operation failed (surfaced by the throws below).
  await storage.writeManifest(dir, {
    ...manifest,
    dazSubdir: nextDazSubdir,
    houdiniSubdir: nextHoudiniSubdir,
    createHoudiniSubdir,
    assetsEnabled,
    dazProductsEnabled,
    charactersSubdir: manifestCharactersSubdir,
  })
  if (moveError) throw new Error(moveError)
  // Folders moved and the manifest is consistent, but N characters kept stale
  // in-file paths (locked/unreadable JSON mid-move). Surface it so the user knows
  // to re-save them, instead of silently leaving dead scene/groom links.
  if (moveResult && moveResult.repointFailures.length > 0) {
    throw new Error(
      `Moved the character folders, but ${moveResult.repointFailures.length} character(s) couldn't have their internal scene/Houdini paths updated — open and re-save each to repair its links.`,
    )
  }
  const project = await resolveProject(dir)
  // Toggling Daz Products on/off changes which Daz scripts each character emits, so
  // regenerate the project's Daz scripts to add (or clean up) the per-character
  // Scan_Products_<Name>.dsa right away — otherwise it wouldn't appear until the
  // next per-character Save or a Tools → Refresh. Daz target only (the Houdini CSV
  // is unaffected); per-character failures are swallowed so the save still succeeds.
  if (dazProductsEnabled !== manifest.dazProductsEnabled) {
    try {
      const root = charsRoot(project)
      // One scan resolves every character's location; primed into the session
      // cache so each generate below skips its own full library walk.
      const scan = await storage.scanCharacterLibrary(root)
      for (const { character, location } of scan.entries) {
        cacheCharacterLocation(root, character.id, location)
      }
      for (const { character } of scan.entries) {
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

const unrealProjectsInput = z.object({
  projectId: z.string().min(1),
  /** Absolute .uproject paths, in display order. */
  paths: z.array(z.string().min(1)),
})

/**
 * Replace the project's linked Unreal project files (.uproject). Links only —
 * the files are never copied or touched; unlinking never deletes.
 */
export async function setUnrealProjects({ data }: { data: unknown }): Promise<ProjectInfo> {
  const { projectId, paths } = unrealProjectsInput.parse(data)
  const dir = await projectPath(projectId)
  const manifest = await storage.readManifest(dir)
  // De-dup while keeping the caller's order (a file can be linked only once).
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))]
  await storage.writeManifest(dir, { ...manifest, unrealProjects: unique })
  return resolveProject(dir)
}
