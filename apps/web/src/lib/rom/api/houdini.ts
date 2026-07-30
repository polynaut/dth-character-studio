import { exists } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
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

export interface GeneratedHoudiniProject {
  /** Absolute path of the saved `.hiplc` — the caller links it. */
  scenePath: string
  /** The project folder `$JOB` was baked to. */
  projectDir: string
  /** Whether the DazToHue network was created from the installed HDA (false =
   *  hython couldn't see the HDA — the scene saved empty, `$JOB` still baked;
   *  the user adds the network from the DazToHue shelf). */
  networkAdded: boolean
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

  const name = cleanFileName(sceneName)
  if (!name) throw new Error('The project name cannot be empty.')

  const projectDir = joinPath(exportDir.replace(/\\/g, '/'), projectFolder)
  const scenePath = joinPath(projectDir, `${name}.hiplc`)
  if (await exists(scenePath)) {
    throw new Error(
      `A scene with that name already exists:\n${scenePath}\nPick a different name, or open the existing project instead.`,
    )
  }

  // zod-parsed, not a bare invoke<T>() cast (primitive shape — no fixture needed).
  const networkAdded = z
    .boolean()
    .parse(await invoke('create_houdini_project', { request: { hythonPath, projectDir, scenePath } }))
  return { scenePath, projectDir, networkAdded }
}
