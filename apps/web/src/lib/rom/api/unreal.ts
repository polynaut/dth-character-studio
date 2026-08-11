import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import {
  EMPTY_UNREAL_SCAN,
  buildUnrealScan,
  unrealProjectNameError,
  uprojectFileContent,
} from '#/lib/unreal-install.ts'
import {
  unrealEngineInstallSchema,
  unrealPluginSourceSchema,
  unrealProjectStateSchema,
} from './native-types.ts'
import { joinPath } from './core'
import * as storage from '../storage'

import type { UnrealEngineScan, UnrealPluginSource } from '#/lib/unreal-install.ts'
import type { UnrealProjectState } from './native-types.ts'

// Unreal Engine: which engines this machine has, which plugin builds the
// configured source folders hold, what a linked project already carries, and
// installing/creating. The registry + folder scanning is native
// (`unreal_install.rs`); the matching rules live in `lib/unreal-install.ts`.
// This module is only the I/O.

/**
 * Every launcher-installed Unreal Engine on this machine, newest first.
 *
 * Best-effort: no Unreal, no registry key, or a non-Windows build all come
 * back empty, which the UI shows as "nothing detected". A missing Unreal is
 * not an error; the Daz/Houdini halves work without it.
 */
export async function detectUnrealEngines(): Promise<UnrealEngineScan> {
  if (!isTauri()) return EMPTY_UNREAL_SCAN
  let installs
  try {
    // Never a bare invoke<T>() cast — pinned by contracts/unreal-installs.json.
    installs = z.array(unrealEngineInstallSchema).parse(await invoke('unreal_engine_installs'))
  } catch {
    return EMPTY_UNREAL_SCAN
  }
  // The registry is what Epic BELIEVES; the folder is what is there. Measured
  // on this project's own dev machine: an uninstalled 4.0 still had its key.
  const existing = new Set<string>()
  await Promise.all(
    installs.map(async (install) => {
      try {
        if (await exists(install.path)) existing.add(install.path)
      } catch {
        // unreadable — treated as absent, and the UI says so
      }
    }),
  )
  return buildUnrealScan(installs, existing)
}

const scanInput = z.object({
  /** Folders to scan; omitted = the saved `unrealPluginFolders` setting (what
   *  the install dialog wants). The Settings panel passes its UNSAVED list so
   *  the preview reflects what the user is editing, not what is on disk. */
  folders: z.array(z.string()).optional(),
})

/** Every plugin build under the given (or configured) source folders. */
export async function scanUnrealPlugins({ data }: { data: unknown } = { data: {} }): Promise<
  Array<UnrealPluginSource>
> {
  const { folders } = scanInput.parse(data)
  if (!isTauri()) return []
  const list = folders ?? (await storage.getSettings()).unrealPluginFolders
  const cleaned = list.map((f) => f.trim()).filter(Boolean)
  if (cleaned.length === 0) return []
  // Pinned by contracts/unreal-plugins.json.
  return z.array(unrealPluginSourceSchema).parse(await invoke('scan_unreal_plugins', { folders: cleaned }))
}

const projectStateInput = z.object({
  /** The linked `.uproject` file (absolute). */
  uprojectPath: z.string().min(1),
})

/** What the linked project is and already carries — the install dialog's one
 *  probe (engine association + DTH content + installed plugin folders). */
export async function unrealProjectState({ data }: { data: unknown }): Promise<UnrealProjectState> {
  const { uprojectPath } = projectStateInput.parse(data)
  if (!isTauri()) throw new Error('Reading an Unreal project needs the desktop app.')
  // Pinned by contracts/unreal-project-state.json.
  return unrealProjectStateSchema.parse(await invoke('unreal_project_state', { uprojectPath }))
}

const installPluginInput = z.object({
  /** The plugin build's folder (holds the `.uplugin`). */
  pluginPath: z.string().min(1),
  /** The linked `.uproject` file (absolute). */
  uprojectPath: z.string().min(1),
  /** Copy over an existing `Plugins/<name>` — the dialog's semantics: a
   *  checked item means "make it this build". */
  overwrite: z.boolean().default(true),
})

/** Install one plugin build into the project's `Plugins/<name>`. Returns files
 *  copied. */
export async function installUnrealPlugin({ data }: { data: unknown }): Promise<number> {
  const { pluginPath, uprojectPath, overwrite } = installPluginInput.parse(data)
  if (!isTauri()) throw new Error('Installing a plugin needs the desktop app.')
  // zod-parsed, not a bare invoke<T>() cast (primitive shape — no fixture needed).
  return z.number().parse(
    await invoke('install_unreal_plugin', { request: { pluginPath, uprojectPath, overwrite } }),
  )
}

const createProjectInput = z.object({
  /** The folder the new project folder is created IN. */
  parentDir: z.string().min(1),
  /** Project name — becomes the folder and the `.uproject` name. */
  name: z.string().min(1),
  /** The launcher engine to bind (`5.7`) — a detected install's version. */
  engineVersion: z.string().min(1),
})

/** What generating a new Unreal project produced. */
export interface CreatedUnrealProject {
  uprojectPath: string
  projectDir: string
}

/**
 * Create a fresh Blueprint-only Unreal project: `<parentDir>/<name>/` with the
 * `.uproject` bound to the chosen engine, plus empty `Content/` and `Config/`
 * skeletons (Unreal fills its own defaults on first open — a Blueprint project
 * has no modules to compile). Refuses an existing target folder: generation
 * never writes into something that is already there.
 *
 * Plain writes, not Rust: three small files is not "heavy file work", and the
 * same plugin-fs calls write every `.dcsp` manifest.
 */
export async function createUnrealProject({ data }: { data: unknown }): Promise<CreatedUnrealProject> {
  const { parentDir, name, engineVersion } = createProjectInput.parse(data)
  if (!isTauri()) throw new Error('Generating an Unreal project needs the desktop app.')
  const trimmed = name.trim()
  const nameError = unrealProjectNameError(trimmed)
  if (nameError) throw new Error(nameError)
  const projectDir = joinPath(parentDir, trimmed)
  if (await exists(projectDir)) {
    throw new Error(`${trimmed} already exists in that folder — pick another name.`)
  }
  await mkdir(joinPath(projectDir, 'Content'), { recursive: true })
  await mkdir(joinPath(projectDir, 'Config'), { recursive: true })
  const uprojectPath = joinPath(projectDir, `${trimmed}.uproject`)
  await writeTextFile(uprojectPath, uprojectFileContent(engineVersion))
  // The minimal identity Unreal's own template writes; everything else is
  // engine defaults until the user opens Project Settings.
  await writeTextFile(
    joinPath(projectDir, 'Config', 'DefaultGame.ini'),
    `[/Script/EngineSettings.GeneralProjectSettings]\nProjectName=${trimmed}\n`,
  )
  await writeTextFile(joinPath(projectDir, 'Config', 'DefaultEngine.ini'), '')
  return { uprojectPath, projectDir }
}
