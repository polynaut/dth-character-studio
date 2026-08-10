import { exists, remove, rename, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { newId } from '@dth/rom'

import { withBusyCursor } from '../../busy-cursor.ts'
import { normalizePathLower } from '#/lib/path.ts'

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
  setActiveProjectDir,
} from './core'
import { generateCharacterFiles } from './generate'
import { relocateExportRoot } from './export-root'
import { assertMovable } from './move'

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
  const manifest = await remintCopiedProjectId(dcsp)
  await storage.rememberRecent(dcsp, manifest.name)
  await openProjectWindow(dcsp)
}

/**
 * A byte-copied project folder carries the ORIGINAL's manifest id, and the
 * app-data product-scan store (`product-scans/<manifest id>/<character id>/`)
 * keys on it — the "two" projects then cross-pollinate scan rows forever.
 * First sight of a path NEW to recents whose id another live recents project
 * still claims = a copy: re-mint this one's id before it enters the registry
 * (its scan store starts empty; the original keeps the data it owns). The
 * already-known path is presumptively the original and is NEVER re-minted. A
 * MOVED project (old path dead) keeps its id — the store follows it.
 *
 * Residuals, deliberate: two copies BOTH opened before this shipped are both
 * in recents already and stay collided until one is deleted/re-created; and
 * probing siblings costs one manifest read per live recents entry — paid only
 * on a genuinely new path, never on a routine reopen.
 *
 * Returns the manifest as it now stands (re-minted or not).
 */
async function remintCopiedProjectId(dcsp: string): Promise<storage.DcspManifest> {
  const dir = dirname(dcsp)
  const manifest = await storage.readManifest(dir)
  const key = dcsp.toLowerCase()
  const recents = await storage.listRecents()
  if (recents.some((r) => r.path.toLowerCase() === key)) return manifest
  for (const other of recents) {
    try {
      if (!(await exists(other.path))) continue // a dead entry is a MOVE, not a copy
      const sibling = await storage.readManifest(dirname(other.path))
      if (sibling.id !== manifest.id) continue
      const reminted = { ...manifest, id: newId() }
      await storage.writeManifest(dir, reminted)
      console.info(
        `[DTH] project at ${dir} carried the same id as ${dirname(other.path)} (a byte copy) — minted a fresh id so their product-scan stores separate`,
      )
      return reminted
    } catch {
      // an unreadable sibling is not evidence of a copy
    }
  }
  return manifest
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
    // Same copy check as openProject — a `.dcsp` double-clicked in Explorer is
    // exactly how a fresh byte copy usually gets its first open.
    const manifest = await remintCopiedProjectId(dcsp)
    await storage.rememberRecent(dcsp, manifest.name)
  } catch {
    // A boot-time recents write must never break window startup.
  }
}

const renameProjectInput = z.object({ projectId: z.string().min(1), name: z.string().min(1) })

/**
 * Follow a project rename with its generated-scripts tree in the Daz library:
 * `Scripts/DTH-Character-Studio/<old name>/` → `<new name>/`. That tree is keyed
 * by project NAME (see `studioCharScriptsDir`), so leaving it put would orphan
 * every generated script while DTH Export looks — and the next save regenerates
 * — under the new name, silently breaking Export until then. Returns a
 * user-facing warning ('' = fine): an existing destination is NEVER merged into
 * or deleted (another project can legitimately sanitize to the same folder
 * name), and a failed rename leaves the old tree exactly where it was — the
 * scripts are derived artifacts, so the guidance is to regenerate, not to
 * rescue.
 */
async function renameProjectScriptsDir(oldName: string, newName: string): Promise<string> {
  if (!isTauri()) return ''
  const guidance =
    'Re-save the characters or run Tools → Refresh assets to regenerate the scripts under the new name.'
  try {
    const settings = await storage.getSettings()
    // No Daz library configured — nothing was ever generated there.
    if (!settings.dazLibraryFolder) return ''
    const from = storage.studioProjectScriptsDir(settings.dazLibraryFolder, oldName)
    const to = storage.studioProjectScriptsDir(settings.dazLibraryFolder, newName)
    // Both names can sanitize to the same folder — nothing to move then. A
    // case-ONLY difference still renames below: `rename` re-cases in place on
    // Windows (same rule as moveCharacterMetaDir), and exists(to) would report
    // the source itself there, so it must not read as a conflict.
    if (from === to) return ''
    if (!(await exists(from))) return '' // never generated — nothing to follow
    if (from.toLowerCase() !== to.toLowerCase() && (await exists(to))) {
      return (
        `The project was renamed, but its generated Daz scripts stayed at "${from}" — ` +
        `"${to}" already exists and is never merged into or replaced. ${guidance}`
      )
    }
    await rename(from, to)
    return ''
  } catch (e) {
    return (
      `The project was renamed, but its generated Daz scripts folder could not be renamed with it ` +
      `(${e instanceof Error ? e.message : String(e)}) — the old folder was left in place. ${guidance}`
    )
  }
}

/**
 * Rename a project: update the manifest name AND rename the `.dcsp` file to
 * match (so the filename — and the window title derived from it — track the
 * name). Recents key off the `.dcsp` path, so the old entry is forgotten and
 * the new one remembered; the generated Daz scripts folder (keyed by project
 * name) is renamed along, since DTH Export resolves it under the NEW name from
 * now on. Finally, any open window for the project is live-re-titled and
 * re-pinned to the new file via `sync_renamed_project_window`.
 *
 * Throws AFTER the rename itself completed when the scripts folder could not
 * follow (same pattern as saveProjectSettings' folder-move report): the caller
 * toasts the message, which carries the regenerate guidance.
 */
export async function renameProject({ data }: { data: unknown }): Promise<ProjectInfo> {
  const { projectId, name } = renameProjectInput.parse(data)
  const dir = await projectPath(projectId)
  const oldDcsp = await storage.findManifestPath(dir)
  const manifest = await storage.readManifest(dir)
  const oldName = manifest.name
  await storage.writeManifest(dir, { ...manifest, name: name.trim() })
  const newDcsp = (await storage.renameManifestFile(dir, name.trim())) ?? oldDcsp
  if (newDcsp) {
    const moved = !!oldDcsp && oldDcsp.toLowerCase() !== newDcsp.toLowerCase()
    if (moved) await storage.forgetRecent(oldDcsp)
    await storage.rememberRecent(newDcsp, name.trim())
    if (moved && isTauri()) {
      await invoke('sync_renamed_project_window', { oldPath: oldDcsp, newPath: newDcsp })
    }
  }
  const scriptsWarning = await renameProjectScriptsDir(oldName, name.trim())
  const project = await resolveProject(dir)
  if (scriptsWarning) throw new Error(scriptsWarning)
  return project
}

/**
 * Permanently delete a project (the Operations tab's danger zone):
 *
 *  1. the entire project folder — characters, scenes, generated artifacts, the
 *     `.dcsp` manifest and the hidden `.dcsmeta` (avatars/notes media);
 *  2. the project's generated Daz-script folder in the Daz library
 *     (`<lib>/Scripts/DTH-Character-Studio/<project>/`) — a derived artifact,
 *     orphaned once the project is gone (best-effort; the shared runtime at the
 *     root stays, other projects use it);
 *  3. the project's app-data product scans (best-effort housekeeping);
 *  4. every recents entry pointing into the folder (recents IS the registry);
 *  5. this window's project pin, so it continues as a Home window.
 *
 * The lock gate runs FIRST: a file open in Daz/Houdini aborts the delete before
 * anything is touched (all-or-nothing, like the folder moves) — otherwise
 * `remove` would tear out half the folder and then fail.
 */
export async function deleteProject({ data }: { data: unknown }): Promise<void> {
  const { projectId } = projectIdInput.parse(data)
  const dir = await projectPath(projectId)
  // Resolves the name (keys the scripts folder) + id (keys the scans folder);
  // throws for an unreachable folder — nothing to delete there, and recents
  // cleanup for a MISSING project is the Home screen's "forget" instead.
  const project = await resolveProject(dir)
  await assertMovable(dir)
  invalidateCharacterLocations()
  // The derived artifacts first (best-effort — an orphaned script/scan folder
  // must not block the real delete)…
  try {
    const settings = await storage.getSettings()
    if (settings.dazLibraryFolder) {
      const scripts = storage.studioProjectScriptsDir(settings.dazLibraryFolder, project.name)
      if (await exists(scripts)) await remove(scripts, { recursive: true })
    }
  } catch {
    // stays behind as an orphan — harmless, and visible in the Daz library
  }
  try {
    const scans = await storage.dataPath('product-scans', project.id)
    if (await exists(scans)) await remove(scans, { recursive: true })
  } catch {
    // orphaned scans age out via the housekeeping sweep
  }
  // …then the project folder itself — THE delete; this one throws on failure.
  await withBusyCursor(remove(dir, { recursive: true }))
  // Recents: drop every entry whose `.dcsp` lives in the deleted folder (the
  // stored path can differ in casing/separators from the route param). Safe in
  // parallel — forgetRecent serializes through the recents mutation queue.
  const key = normalizePathLower(dir)
  const stale = (await storage.listRecents()).filter(
    (r) => normalizePathLower(dirname(r.path)) === key,
  )
  await Promise.all(stale.map((r) => storage.forgetRecent(r.path)))
  // Unpin the window (native map + title) BEFORE clearing the TS-side value —
  // getActiveProjectDir re-reads the native pin once its cached value is ''.
  if (isTauri()) {
    try {
      await invoke('release_project_window')
    } catch {
      // an un-released pin only leaves a stale window title
    }
  }
  setActiveProjectDir('')
}

/** Save a project's behaviour defaults (the `.dcsp` manifest's per-project
 *  fields) — defaults come from the manifest's own single copy. */
const projectSettingsInput = z.object({
  projectId: z.string().min(1),
  dazSubdir: z.string().default(storage.PROJECT_BEHAVIOR_DEFAULTS.dazSubdir),
  houdiniSubdir: z.string().default(storage.PROJECT_BEHAVIOR_DEFAULTS.houdiniSubdir),
  exportSubdir: z.string().default(storage.PROJECT_BEHAVIOR_DEFAULTS.exportSubdir),
  createHoudiniSubdir: z.boolean().default(storage.PROJECT_BEHAVIOR_DEFAULTS.createHoudiniSubdir),
  assetsEnabled: z.boolean().default(storage.PROJECT_BEHAVIOR_DEFAULTS.assetsEnabled),
  dazProductsEnabled: z.boolean().default(storage.PROJECT_BEHAVIOR_DEFAULTS.dazProductsEnabled),
  charactersSubdir: z.string().default(storage.PROJECT_BEHAVIOR_DEFAULTS.charactersSubdir),
  houdiniPathStyle: z
    .enum(['hip', 'absolute'])
    .default(storage.PROJECT_BEHAVIOR_DEFAULTS.houdiniPathStyle),
})
export async function saveProjectSettings({ data }: { data: unknown }): Promise<ProjectInfo> {
  const {
    projectId,
    dazSubdir,
    houdiniSubdir,
    exportSubdir,
    createHoudiniSubdir,
    assetsEnabled,
    dazProductsEnabled,
    charactersSubdir,
    houdiniPathStyle,
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
  const nextExportSubdir = normalizeRelFolder(exportSubdir)
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
    exportSubdir: nextExportSubdir,
    createHoudiniSubdir,
    assetsEnabled,
    dazProductsEnabled,
    charactersSubdir: manifestCharactersSubdir,
    houdiniPathStyle,
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
  // Two per-project settings change what the characters' generated files SAY,
  // so the save has to sweep the library right away — otherwise nothing happens
  // until each character's next Save or a Tools → Refresh:
  //  - Daz Products on/off adds (or cleans up) the per-character
  //    Scan_Products_<Name>.dsa — Daz scripts only.
  //  - The Houdini subfolder anchors every character's DERIVED export root
  //    (`<char>/<houdiniSubdir>/daz-export`). Changing it moves the exported
  //    files and repoints each definition — and a repoint MUST regenerate both
  //    artifacts, because the .dsa bakes `exportPath`: relocating without
  //    regenerating leaves every installed script exporting into the vacated
  //    old root.
  // Per-character failures are swallowed so the save still succeeds; whatever
  // is missed here is exactly what Tools → Refresh repairs (the export-root
  // trigger is derived, so it stays live until actually fixed).
  const productsToggled = dazProductsEnabled !== manifest.dazProductsEnabled
  // '' means "use the default" for the Houdini subdir (readManifest fills it
  // back in), so the change test must compare EFFECTIVE values — comparing the
  // raw '' against the manifest's filled-in default would re-sweep every save.
  const effectiveHoudiniSubdir =
    nextHoudiniSubdir || storage.PROJECT_BEHAVIOR_DEFAULTS.houdiniSubdir
  const houdiniSubdirChanged = effectiveHoudiniSubdir !== manifest.houdiniSubdir
  if (productsToggled || houdiniSubdirChanged) {
    try {
      const root = charsRoot(project)
      // One scan resolves every character's location; primed into the session
      // cache so each generate below skips its own full library walk.
      const scan = await storage.scanCharacterLibrary(root)
      for (const { character, location } of scan.entries) {
        cacheCharacterLocation(root, character.id, location)
      }
      await withBusyCursor(
        (async () => {
          for (const { character, location } of scan.entries) {
            try {
              let regenDaz = productsToggled
              let regenHoudini = false
              if (houdiniSubdirChanged) {
                // `project` was resolved AFTER the manifest write, so the
                // relocation derives with the NEW subfolder.
                const relocation = await relocateExportRoot(project, root, character, location)
                if (relocation.repointed) {
                  regenDaz = true
                  regenHoudini = true
                }
              }
              if (regenDaz || regenHoudini) {
                await generateCharacterFiles({
                  data: {
                    projectId: project.path,
                    id: character.id,
                    targets: { daz: regenDaz, houdini: regenHoudini },
                  },
                })
              }
            } catch {
              // one bad character shouldn't block the others or the settings save
            }
          }
        })(),
      )
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
