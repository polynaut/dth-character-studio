import { exists, mkdir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  UNREAL_BRIDGE_UPLUGIN,
  bridgeUpluginJson,
  parseUnrealResult,
  unrealDestinationFor,
  unrealImportStateFrom,
  unrealJobJson,
  unrealJobPaths,
} from '../unreal-jobs'
import type { UnrealImportState } from '../unreal-jobs'
import { charScopeInput, joinPath, locateCharacter, charsRoot, resolveProject } from './core'
import { normalizeRelFolder } from '../library'
// The bridge, bundled as source and rewritten into the project before every
// run — the same self-repairing rule as 456.py and the Daz runtime: small,
// must track the app version, and needs no install ritual.
import bridgeScript from '../unreal-runtime/dth_bridge.py?raw'
import bridgeInit from '../unreal-runtime/init_unreal.py?raw'

// The Unreal leg of the round trip: hand a `.dth` to a watching editor.
//
// Nothing here decides what an import DOES — that is mrpdean's DazToHue
// pipeline, unmodified. This module resolves paths, installs the studio's own
// bridge plugin, writes the job file and reads the result: the same division of
// labour as the Houdini leg.

/**
 * Write the bridge plugin into an Unreal project.
 *
 * Rewritten before EVERY run rather than installed once, so a project can never
 * hold a bridge older than the app that talks to it — the trap the Daz Runner
 * and 456.py both taught. Cheap: three small text files.
 */
export async function installUnrealBridge(uprojectPath: string): Promise<string> {
  const { bridgeDir } = unrealJobPaths(uprojectPath)
  const pythonDir = `${bridgeDir}/Content/Python`
  await mkdir(pythonDir, { recursive: true })
  await storage.writeTextFileAtomic(`${bridgeDir}/${UNREAL_BRIDGE_UPLUGIN}`, bridgeUpluginJson())
  await storage.writeTextFileAtomic(`${pythonDir}/dth_bridge.py`, bridgeScript)
  await storage.writeTextFileAtomic(`${pythonDir}/init_unreal.py`, bridgeInit)
  return bridgeDir
}

const importInput = charScopeInput.extend({
  /** The linked `.uproject` to import into. */
  uprojectPath: z.string().min(1),
})

export interface UnrealImportStarted {
  /** The `.dth` handed over. */
  dth: string
  /** The Unreal content path it imports into. */
  destination: string
  /** Where the bridge was (re)written. */
  bridgeDir: string
  /** True when a previous job was still sitting unclaimed — the editor was not
   *  watching, and this run replaced it rather than queueing behind it. */
  replacedPending: boolean
}

/**
 * The `.dth` Houdini wrote for Unreal.
 *
 * NOT the Daz-side `.dth` the Houdini imports read: that one names the
 * Daz→Houdini intermediates. This is the END of the pipeline — the file
 * Houdini's own export writes into the character's `export/` folder, naming
 * the skeletal meshes, textures and animation curves Unreal consumes.
 */
async function houdiniDthFor(exportRoot: string, characterName: string): Promise<string> {
  // `<export>/<CharacterName>/DTH_<CharacterName>.dth` — measured on a real
  // export. The folder inside `export/` is the HDA's `character_name`, which
  // the studio sets itself, so this resolves without a scan and reports
  // honestly when it is not there.
  const candidate = joinPath(exportRoot, characterName, `DTH_${characterName}.dth`)
  if (await exists(candidate)) return candidate
  return ''
}

/**
 * Hand a character's Houdini output to a watching Unreal editor.
 *
 * Returns as soon as the job file is written — the editor claims it on its next
 * tick (about a second), and the caller polls {@link fetchUnrealImportProgress}.
 */
export async function startUnrealImport({ data }: { data: unknown }): Promise<UnrealImportStarted> {
  const input = importInput.parse(data)
  if (!isTauri()) {
    throw new Error('Importing into Unreal needs the desktop app.')
  }
  const project = await resolveProject(input.projectId)
  const location = await locateCharacter(charsRoot(project), input.id)
  if (!location) throw new Error('Character not found.')
  const character = await storage.readCharacterAt(location.definitionAbs)
  if (!character) throw new Error('Could not read the character definition.')
  if (!(await exists(input.uprojectPath))) {
    throw new Error('That Unreal project file is no longer on disk.')
  }

  // The character's FINAL export folder — where Houdini WRITES for Unreal.
  // Never `daz-export`, which is the regenerable Daz→Houdini intermediate the
  // Houdini imports READ (the same distinction `startHoudiniExport` draws).
  const exportRoot = joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir))
  const dth = await houdiniDthFor(exportRoot, character.name)
  if (!dth) {
    throw new Error(
      `No Houdini export found for ${character.name} — run the Houdini export first (looked in ${exportRoot}).`,
    )
  }

  const paths = unrealJobPaths(input.uprojectPath)
  const bridgeDir = await installUnrealBridge(input.uprojectPath)
  await mkdir(paths.jobDir, { recursive: true })

  // A result from an earlier run would be read as this one's before the editor
  // has written anything. The studio owns that cleanup, exactly as it does for
  // the Houdini result file.
  try {
    if (await exists(paths.resultFile)) await remove(paths.resultFile)
  } catch {
    // locked — the state rule tolerates a stale read until it is rewritten
  }
  const replacedPending = await exists(paths.jobFile).catch(() => false)

  const destination = unrealDestinationFor(character.name)
  await storage.writeTextFileAtomic(
    paths.jobFile,
    unrealJobJson({ dth, destination, character: character.name }),
  )
  return { dth, destination, bridgeDir, replacedPending }
}

/**
 * Poll one Unreal project's import.
 *
 * Reads only files, so it costs nothing when nothing is happening — and unlike
 * the other two legs it has no liveness probe: "is THAT project open in an
 * editor" is not answerable from a process list, so a closed editor leaves the
 * run reported as running rather than guessed dead.
 */
export async function fetchUnrealImportProgress({
  data,
}: {
  data: unknown
}): Promise<UnrealImportState | null> {
  const { uprojectPath } = z.object({ uprojectPath: z.string().min(1) }).parse(data)
  if (!isTauri()) return null
  const paths = unrealJobPaths(uprojectPath)
  const jobStillPending = await exists(paths.jobFile).catch(() => false)
  let result = null
  try {
    if (await exists(paths.resultFile)) {
      result = parseUnrealResult(await readTextFile(paths.resultFile))
    }
  } catch {
    result = null
  }
  if (!jobStillPending && result === null) {
    // Neither file: nothing was ever started for this project (or the caller
    // already dismissed it). Nothing to report rather than a made-up state.
    const claimed = await exists(paths.claimedFile).catch(() => false)
    if (!claimed) return null
  }
  return unrealImportStateFrom(jobStillPending, result)
}

/** Clear a finished run's files so the next poll reports nothing. */
export async function dismissUnrealImport({ data }: { data: unknown }): Promise<void> {
  const { uprojectPath } = z.object({ uprojectPath: z.string().min(1) }).parse(data)
  if (!isTauri()) return
  const paths = unrealJobPaths(uprojectPath)
  // Independent deletes, so they go together — and each swallows its own
  // failure: a file the editor has locked is cleared by the next run anyway.
  await Promise.all(
    [paths.resultFile, paths.jobFile, paths.claimedFile].map(async (path) => {
      try {
        if (await exists(path)) await remove(path)
      } catch {
        // locked by the editor — the next run overwrites them
      }
    }),
  )
}
