import { exists, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { normalizeRelFolder } from '../library'
import {
  charsRoot,
  dirname,
  getActiveProjectDir,
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
