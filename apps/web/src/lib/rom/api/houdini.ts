import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { houdiniVersionFromInstall, matchingHoudiniDocsFolder } from '#/lib/houdini-version.ts'
import {
  EXPORTS_FOLDER,
  characterHoudiniDir,
  characterHoudiniProjectDir,
} from '#/lib/scene-subfolder.ts'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

// "Generate project": create a ready-made DazToHue Houdini project for a
// character. hython starts a fresh scene, bakes $JOB to the character's ONE
// shared `houdini-project` folder, creates the DazToHue network FROM THE USER'S
// INSTALLED HDA (no template scene: a template would rot against newer
// Houdini/DazToHue versions; instantiating the installed asset is always
// current) and saves <name>.hiplc beside that folder. Path resolution lives
// here; the folder-create + hython run are native (create_houdini_project,
// houdini.rs).
//
// The project folder holds no exports (schema v29) — those live in the
// character's fixed Daz-side export root. It gets a `dth-exports` JUNCTION
// pointing there instead, so Houdini's file picker (which opens at $JOB) shows
// the exports one click away rather than two levels up. Best-effort in every
// sense: the junction is a shortcut, nothing resolves through it.

const generateInput = charScopeInput.extend({
  /** The new scene's name (dialog input, prefilled `<Project>_<Character>`). */
  sceneName: z.string().min(1),
})

/** Folder/file-name-safe: Windows-illegal characters collapse to one space
 *  (the same rule as the Houdini project folder input). */
function cleanFileName(value: string): string {
  return value
    .trim()
    .replace(/[\r\n<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The `.hiplc` path a dialog name generates to ('' when either part is
 *  empty) — inside the character's HOUDINI folder, beside the shared
 *  `houdini-project` folder it Set-Projects to. ONE computation shared by the
 *  generate itself and the dialog's live name-collision check — the two must
 *  never disagree on the target. */
export function generatedHoudiniScenePath(houdiniDir: string, sceneName: string): string {
  const name = cleanFileName(sceneName)
  const dir = houdiniDir.trim().replace(/\\/g, '/')
  if (!name || !dir) return ''
  return joinPath(dir, `${name}.hiplc`)
}

/**
 * Put the `dth-exports` shortcut inside the project folder: a junction to the
 * character's real export root, so Houdini's file picker — which opens at $JOB
 * — lists the exports right there instead of making the user climb out to the
 * Daz subfolder. Returns whether the link is in place.
 *
 * BEST-EFFORT ON PURPOSE. Nothing resolves through it: the studio and the
 * generated Daz scripts write and read absolute paths, and Houdini only ever
 * sees it if the user browses. So every failure mode — a non-NTFS or network
 * export root (a junction can't target UNC), a real folder already sitting at
 * that name, a version-control client that deleted it — costs the shortcut and
 * nothing else. Re-running Generate project repairs it.
 */
async function linkExportsIntoProject(projectDir: string, exportPath: string): Promise<boolean> {
  const target = exportPath.trim().replace(/\\/g, '/')
  if (!target || !isTauri()) return false
  try {
    // A primitive return — z.enum, not a bare invoke<T>() cast (no fixture
    // needed; see the FFI ritual in .ai/conventions.md).
    z.enum(['created', 'exists']).parse(
      await invoke('create_junction', {
        request: { linkPath: joinPath(projectDir, EXPORTS_FOLDER), targetPath: target },
      }),
    )
    return true
  } catch {
    return false
  }
}

export interface GeneratedHoudiniProject {
  /** Absolute path of the saved `.hiplc` — the caller links it. */
  scenePath: string
  /** The project folder `$JOB` was baked to (shared by the character's
   *  projects — this generate may have reused an existing one). */
  projectDir: string
  /** Whether the `dth-exports` junction into the export root is in place —
   *  false just means the file-picker shortcut is missing (see
   *  `linkExportsIntoProject`), never that the project is broken. */
  exportsLink: boolean
  /** Whether the DazToHue network was created from the installed HDA (false =
   *  hython couldn't see the HDA — the scene saved empty, `$JOB` still baked;
   *  the user adds the network from the DazToHue shelf). */
  networkAdded: boolean
  /** Every DazToHue-ish node type hython could see (`<category>/<type>`) —
   *  diagnosis when `networkAdded` is false: empty means the otls didn't load
   *  at all; SOP-only entries mean the main asset isn't an Object-level HDA. */
  visibleTypes: Array<string>
}

export async function generateHoudiniProject({
  data,
}: {
  data: unknown
}): Promise<GeneratedHoudiniProject> {
  const { projectId, id, sceneName } = generateInput.parse(data)
  if (!isTauri()) throw new Error('Generate project needs the desktop app (it runs hython).')

  const settings = await storage.getSettings()
  const installDir = settings.houdiniInstallFolder.trim()
  if (!installDir) {
    throw new Error('Set the Houdini installation folder in Settings first — hython creates the project.')
  }
  const hythonPath = joinPath(installDir.replace(/\\/g, '/'), 'bin/hython.exe')
  if (!(await exists(hythonPath))) {
    throw new Error(`hython was not found:\n${hythonPath}\nCheck the Houdini installation folder in Settings.`)
  }
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!character) throw new Error(`Character ${id} not found`)
  // Layout: the scene FILE lives in the character's houdini folder, NEXT TO the
  // one shared project folder every one of its scenes Set-Projects into:
  //   houdini/<name>.hiplc              ← the scene (one per generate)
  //   houdini/houdini-project/          ← $JOB, shared — created once
  //   houdini/houdini-project/dth-exports  → junction to the export root
  const charFolder = location?.folderAbs ?? ''
  if (!charFolder) throw new Error(`Character ${id} not found`)
  const houdiniDir = characterHoudiniDir(charFolder, project.houdiniSubdir)
  const projectDir = characterHoudiniProjectDir(charFolder, project.houdiniSubdir)
  const scenePath = generatedHoudiniScenePath(houdiniDir, sceneName)
  if (!scenePath) throw new Error('The project name cannot be empty.')
  if (await exists(scenePath)) {
    throw new Error(
      `A scene with that name already exists:\n${scenePath}\nPick a different name, or open the existing project instead.`,
    )
  }

  // Created by whichever generate runs first; every later one finds it and
  // reuses it, so all of a character's projects share one $JOB.
  await mkdir(projectDir, { recursive: true })
  const exportsLink = await linkExportsIntoProject(projectDir, character.exportPath)

  // The matching Houdini documents folder doubles as HOUDINI_USER_PREF_DIR
  // for hython — without it, hython inherits the studio's environment and can
  // resolve the prefs elsewhere, never loading the DazToHue otls (measured:
  // the same leak that hid the DazToHue shelf from studio-launched Houdini).
  // MATCHING by version is mandatory: prefs are per major.minor, so the
  // install `Houdini 22.0.x` must pair with a configured `houdini22.0` docs
  // folder (primary or extra) or hython would load another version's — or
  // no — otls.
  const houdiniPrefDir = matchingHoudiniDocsFolder(installDir, [
    settings.houdiniDocsFolder,
    ...settings.extraHoudiniDocsFolders,
  ])
  if (!houdiniPrefDir) {
    const version = houdiniVersionFromInstall(installDir)
    throw new Error(
      version
        ? `The Houdini installation (${version}) has no matching documents folder — add "…\\Documents\\houdini${version}" as a Houdini documents folder in Settings.`
        : `Could not read a Houdini version from the installation folder:\n${installDir}\nPoint it at a versioned install (e.g. "…\\Houdini 22.0.368").`,
    )
  }

  // zod-parsed, not a bare invoke<T>() cast (primitive "<created>|<visible>"
  // report — no fixture needed).
  const report = z.string().parse(
    await invoke('create_houdini_project', {
      request: { hythonPath, projectDir, scenePath, houdiniPrefDir },
    }),
  )
  const [created = 'none', visible = 'none'] = report.split('|')
  return {
    scenePath,
    projectDir,
    exportsLink,
    networkAdded: created !== 'none',
    visibleTypes: visible === 'none' ? [] : visible.split(',').filter(Boolean),
  }
}

const removeInput = charScopeInput.extend({
  /** The linked `.hiplc` to remove (a generated one — it lives directly in
   *  the character's houdini/export folder). */
  hipPath: z.string().min(1),
})

/**
 * Delete a GENERATED Houdini project's SCENE FILE from disk. The remove
 * dialog's "Keep houdini files" toggle guards this; the caller unlinks the card
 * afterwards. Safety: the scene must live DIRECTLY in the character's Houdini
 * folder (the generated layout) — anything else refuses, so a hand-linked
 * project can never be deleted through this path.
 *
 * The `houdini-project` folder is deliberately NOT touched: it is shared by
 * every one of the character's projects now (schema v29), so deleting it with
 * one project would break the others' `$JOB`. It holds no exports either — just
 * the `dth-exports` junction and whatever Houdini itself writes — so leaving it
 * costs nothing, and the next Generate project reuses it.
 */
export async function removeGeneratedHoudiniProject({ data }: { data: unknown }): Promise<void> {
  const { projectId, id, hipPath } = removeInput.parse(data)
  if (!isTauri()) return
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  if (!location) throw new Error(`Character ${id} not found`)
  const houdiniDir = characterHoudiniDir(location.folderAbs, project.houdiniSubdir)

  const norm = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()
  const hipNorm = norm(hipPath)
  const hipParent = hipNorm.slice(0, hipNorm.lastIndexOf('/'))
  if (hipParent !== norm(houdiniDir)) {
    throw new Error(
      'Only generated projects (living in the character’s houdini folder) can be deleted from here — unlink instead.',
    )
  }

  if (await exists(hipPath)) await remove(hipPath)
}
