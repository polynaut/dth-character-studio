import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { houdiniVersionFromInstall, matchingHoudiniDocsFolder } from '#/lib/houdini-version.ts'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

// "Generate project": create a ready-made DazToHue Houdini project for a
// character. hython starts a fresh scene, bakes $JOB to
// <exportPath>/<houdiniProjectFolder> — the folder the bulk export delivers
// into as $JOB/dth-export/<scene>/ — creates the DazToHue network FROM THE
// USER'S INSTALLED HDA (no template scene: a template would rot against newer
// Houdini/DazToHue versions; instantiating the installed asset is always
// current) and saves <name>.hiplc at the project root. Path resolution lives
// here; the folder-create + hython run are native (create_houdini_project,
// houdini.rs).

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
 *  empty). ONE computation shared by the generate itself and the dialog's
 *  live name-collision check — the two must never disagree on the target. */
export function generatedHoudiniScenePath(exportDir: string, sceneName: string): string {
  const name = cleanFileName(sceneName)
  const dir = exportDir.trim().replace(/\\/g, '/')
  if (!name || !dir) return ''
  return joinPath(dir, `${name}.hiplc`)
}

export interface GeneratedHoudiniProject {
  /** Absolute path of the saved `.hiplc` — the caller links it. */
  scenePath: string
  /** The project folder `$JOB` was baked to. */
  projectDir: string
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
  const exportDir = character.exportPath.trim()
  if (!exportDir) {
    throw new Error('Generate project needs an export directory — set one in the Export directory panel.')
  }
  const projectFolder = character.houdiniProjectFolder.trim()
  if (!projectFolder) {
    throw new Error(
      'Generate project needs a Houdini project folder — set one in the Export directory panel.',
    )
  }

  // Layout: the scene FILE lives in the houdini folder (the export dir),
  // NEXT TO the project folder it Set-Projects into — the project folder
  // itself holds only project data (dth-export/…):
  //   houdini/<name>.hiplc            ← the scene
  //   houdini/<projectFolder>/        ← $JOB (Set Project)
  //   houdini/<projectFolder>/dth-export/
  const exportDirNorm = exportDir.replace(/\\/g, '/')
  const projectDir = joinPath(exportDirNorm, projectFolder)
  const scenePath = generatedHoudiniScenePath(exportDir, sceneName)
  if (!scenePath) throw new Error('The project name cannot be empty.')
  if (await exists(scenePath)) {
    throw new Error(
      `A scene with that name already exists:\n${scenePath}\nPick a different name, or open the existing project instead.`,
    )
  }

  // The project's dth-export/ folder exists from generation on — the bulk
  // export delivers into it later, but browsing the fresh project (and wiring
  // $JOB/dth-export/... imports) shouldn't have to wait for a first export.
  // Same literal as the generated scripts' <project>/dth-export nesting.
  await mkdir(joinPath(projectDir, 'dth-export'), { recursive: true })

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
 * Delete a GENERATED Houdini project's files from disk: the scene file plus
 * the character's Houdini project folder (`<exportPath>/<houdiniProjectFolder>`
 * — including everything exported into its dth-export/). The remove dialog's
 * "Keep houdini files" toggle guards this; the caller unlinks the card
 * afterwards. Safety: the scene must live DIRECTLY in the character's export
 * dir (the generated layout) — anything else refuses, so a hand-linked
 * project can never be deleted through this path.
 */
export async function removeGeneratedHoudiniProject({ data }: { data: unknown }): Promise<void> {
  const { projectId, id, hipPath } = removeInput.parse(data)
  if (!isTauri()) return
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!character) throw new Error(`Character ${id} not found`)
  const exportDir = character.exportPath.trim().replace(/\\/g, '/')
  if (!exportDir) throw new Error('No export directory — nothing the studio manages here.')

  const norm = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()
  const hipNorm = norm(hipPath)
  const dirNorm = norm(exportDir)
  const hipParent = hipNorm.slice(0, hipNorm.lastIndexOf('/'))
  if (hipParent !== dirNorm) {
    throw new Error(
      'Only generated projects (living in the character’s houdini folder) can be deleted from here — unlink instead.',
    )
  }

  if (await exists(hipPath)) await remove(hipPath)
  const projectFolder = character.houdiniProjectFolder.trim()
  if (projectFolder) {
    const folderAbs = joinPath(exportDir, projectFolder)
    if (await exists(folderAbs)) await remove(folderAbs, { recursive: true })
  }
}
