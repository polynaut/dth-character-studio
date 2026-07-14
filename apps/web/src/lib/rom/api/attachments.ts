import { exists, mkdir, readFile, remove, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { characterSchema, newId } from '@dth/rom'
import * as storage from '../storage'
import { normalizeRelFolder } from '../library'
import { basename, charactersRoot, charsRoot, joinPath, projectPath, resolveProject } from './core'
import { copyTipImage, sceneBase } from './avatars'

import type { Character } from '@dth/rom'

// Daz scenes attached to characters (copy into the character folder, relink,
// open with the OS) + the per-project reusable-asset registry (`.assets`).

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

/**
 * Open a `.duf` in the ALREADY-RUNNING Daz Studio instance. Since DS 4.12 a
 * second launch forwards the file to the running instance — but DS 6 silently
 * ignores forwarded scene opens (Explorer double-click does nothing either).
 * Forwarded SCRIPT files still execute there, so the bridge is a one-shot
 * `.dsa` in app-data that opens the scene from INSIDE the running instance
 * (with Daz's normal unsaved-changes prompt).
 *
 * The bridge is launched via `run_daz_script` (which invokes Daz's executable
 * with the script as its argument), NOT by shell-opening the `.dsa`. A shell-open
 * follows the OS file association, and on a dev box `.dsa` is often bound to a
 * text editor (VS Code) — the script would just open as text and never run. If
 * the executable can't be located we fall back to the shell-open so the feature
 * still works on machines where `.dsa` *is* associated with Daz.
 */
// Rotate the bridge across a small pool of filenames so two consecutive opens
// never hand Daz the SAME path — a running Daz can ignore a repeated "open" of an
// identical path, leaving the scene unchanged (you clicked a new card but nothing
// loaded). The pool is tiny and fixed, so these one-shot scripts can't pile up in
// app-data.
let bridgeSeq = 0
const BRIDGE_POOL = 4

async function openSceneInRunningDaz(scenePath: string): Promise<void> {
  // The bridge reports failures with a message box so the open isn't silent: if you
  // see NO box AND the scene doesn't load, the running Daz never executed this
  // script (the forwarded-script assumption failed) — the key thing to know.
  const script = [
    '// Written by DTH Character Studio — opens a scene in the already-running Daz',
    '// Studio instance. openFile(path, false): merge=false REPLACES the current scene',
    '// (clears it, then opens the file). With the default it merges into the open',
    '// scene, so opening a new card when a scene was already loaded did nothing visible.',
    '(function () {',
    `  var path = ${JSON.stringify(scenePath.replace(/\\/g, '/'))};`,
    '  try {',
    '    if (!App.getContentMgr().openFile(path, false)) {',
    '      MessageBox.warning("DTH: could not open the scene:\\n" + path, "DTH Character Studio", "&OK");',
    '    }',
    '  } catch (e) {',
    '    MessageBox.critical("DTH: error opening the scene:\\n" + e, "DTH Character Studio", "&OK");',
    '  }',
    '})();',
    '',
  ].join('\n')
  const bridge = await storage.dataPath(`dth_open_scene_${bridgeSeq}.dsa`)
  bridgeSeq = (bridgeSeq + 1) % BRIDGE_POOL
  await writeTextFile(bridge, script)
  try {
    const exe = await invoke<string>('run_daz_script', { scriptPath: bridge })
    // Visible in the (now enabled) devtools console — tells us which instance we
    // asked to run the script when a running Daz doesn't react.
    console.info('[DTH] ran open-scene script via', exe, '→', bridge)
  } catch (err) {
    console.warn('[DTH] run_daz_script failed, falling back to shell-open', err)
    await shellOpen(bridge)
  }
}

/** Open a scene/project file with its OS-default application (a `.duf` opens in
 *  Daz Studio, a `.hip` in Houdini). Only LOCAL files with an expected extension
 *  are opened — a character definition is shareable, so a crafted `scenePath`
 *  must not turn "Open scene" into launching an arbitrary URL (phishing). */
export async function openScene({ data }: { data: unknown }): Promise<void> {
  const { scenePath } = z.object({ scenePath: z.string().min(1) }).parse(data)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(scenePath)) {
    throw new Error('Refusing to open a URL — the scene path must be a local file.')
  }
  if (!/\.(duf|hip|hipnc|hiplc|uproject)$/i.test(scenePath)) {
    throw new Error(
      'Refusing to open — not a recognised scene/project file (.duf/.hip/.uproject).',
    )
  }
  // A running Daz ignores forwarded .duf opens — route through the script bridge.
  if (
    /\.duf$/i.test(scenePath) &&
    (await invoke<boolean>('daz_studio_running').catch(() => false))
  ) {
    await openSceneInRunningDaz(scenePath)
  } else {
    await shellOpen(scenePath)
  }
  await focusOpenedApp(scenePath)
}

/** The app executables that could own the window for an opened file, by type —
 *  used to pull the target app forward after opening (see `focusOpenedApp`). */
function appExesFor(scenePath: string): Array<string> {
  if (/\.duf$/i.test(scenePath)) return ['DAZStudio.exe']
  if (/\.(hip|hipnc|hiplc)$/i.test(scenePath))
    return ['houdini.exe', 'houdinifx.exe', 'houdinicore.exe']
  if (/\.uproject$/i.test(scenePath)) return ['UnrealEditor.exe', 'UE4Editor.exe']
  return []
}

/** Best-effort: bring the app the scene just opened in to the foreground, so it
 *  doesn't load hidden behind the studio window. A no-op when the app isn't
 *  running yet (a fresh launch focuses itself) or off Windows. The short beat
 *  lets a just-spawned launcher/forwarder settle before we grab focus back. */
async function focusOpenedApp(scenePath: string): Promise<void> {
  const exeNames = appExesFor(scenePath)
  if (exeNames.length === 0) return
  await new Promise((resolve) => setTimeout(resolve, 200))
  await invoke('focus_app_window', { exeNames }).catch(() => {})
}

/** Whether a Daz Studio instance is currently running (false in a plain browser).
 *  The scene-card UI uses it to warn — the studio can't switch the scene of an
 *  already-running Daz, so it points the user at the per-character open script. */
export async function dazStudioRunning(): Promise<boolean> {
  return invoke<boolean>('daz_studio_running').catch(() => false)
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
 * Open a path in the OS file manager (Explorer on Windows) — a file path opens
 * its parent folder. Same URL-scheme refusal as openScene: a shareable
 * character definition must not turn Ctrl+click into launching arbitrary URLs.
 */
export async function revealPath({ data }: { data: unknown }): Promise<void> {
  const { path } = z.object({ path: z.string().min(1) }).parse(data)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error('Refusing to open a URL — the path must be a local file or folder.')
  }
  let dir = path
  try {
    if (!(await stat(path)).isDirectory) dir = path.replace(/[\\/][^\\/]*$/, '')
  } catch {
    throw new Error('The path does not exist (anymore).')
  }
  // Trailing separator: that's how the shell-open scope (tauri.conf.json)
  // recognises a FOLDER — extensionless paths are refused otherwise.
  if (!/[\\/]$/.test(dir)) dir += path.includes('\\') ? '\\' : '/'
  await shellOpen(dir)
}
