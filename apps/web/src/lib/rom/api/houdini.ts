import { exists } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

// "Generate project": create a ready-made DazToHue Houdini project for a
// character. hython loads the user's template scene (a saved DazToHue
// network), bakes $JOB to <exportPath>/<houdiniProjectFolder> — the folder the
// bulk export delivers into as $JOB/dth-export/<scene>/ — and saves it as
// <name>.hiplc at the project root, so every import in the template stays
// JOB-relative and the project is moveable. Path resolution lives here; the
// folder-create + hython run are native (create_houdini_project, houdini.rs).

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
  const templatePath = settings.houdiniTemplateScene.trim()
  if (!templatePath) {
    throw new Error(
      'Set the DazToHue template scene in Settings first — save any working DazToHue scene once and point the setting at it.',
    )
  }
  if (!(await exists(templatePath))) {
    throw new Error(`The template scene was not found:\n${templatePath}\nCheck the setting.`)
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

  await invoke('create_houdini_project', {
    request: { hythonPath, templatePath, projectDir, scenePath },
  })
  return { scenePath, projectDir }
}
