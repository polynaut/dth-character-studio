import { exists, readTextFile, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  EXECUTE_STAMPS_FILE,
  EXPORTER_JOB_FILE,
  characterJobScriptNames,
  executeSceneSignature,
  jobFileCsv,
  normalizeSceneKey,
  parseExecuteStamps,
} from '../execute-jobs'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

import type { ExecuteStamp, ExecuteStamps, ExporterJob } from '../execute-jobs'
import type { Character } from '@dth/rom'

// The Execute / Execute-all feature: hand the character's ROM/Export runs to the
// DTH Exporter Plugin as a job file (scene path + script path rows) in the Daz
// library, then start Daz Studio — the plugin finds the file on startup, deletes
// it (the transfer ack) and works through the rows. Contract:
// docs/exporter-plugin-job-file.md. The pure parts (CSV text, signatures) live
// in ../execute-jobs.ts.

const executeInput = charScopeInput.extend({
  /** `scene` = the one selected scene, unconditionally. `all` = every linked
   *  scene, filtered to the ones whose inputs changed since the last handoff
   *  (unless `force`). */
  scope: z.enum(['scene', 'all']),
  /** The selected scene (scope `scene` only) — must be one of the linked scenes. */
  scenePath: z.string().optional(),
  /** Skip the affected-check (Ctrl+click on Execute all). */
  force: z.boolean().default(false),
})

export interface ExecuteJobsSummary {
  /** Absolute path of the job file written ('' when nothing was enqueued). */
  jobFile: string
  /** Scenes whose jobs were enqueued, in job order. Empty = everything was
   *  already up to date (execute-all without force). */
  scenes: Array<string>
  /** Scenes skipped as unchanged since the last handoff. */
  skipped: Array<string>
  /** True when a fresh Daz Studio was started for the jobs. */
  dazLaunched: boolean
  /** True when Daz was already running — the job file is in place, but the
   *  plugin only checks at startup, so Daz must be restarted to pick it up. */
  dazWasRunning: boolean
}

/** A scene's current stamp: the `.duf` file identity + the definition signature. */
async function currentStamp(character: Character, scenePath: string): Promise<ExecuteStamp> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(scenePath)
  } catch {
    throw new Error(
      `The Daz scene file could not be read:\n${scenePath}\nRelink or restore the scene, then try again.`,
    )
  }
  return {
    mtimeMs: info.mtime?.getTime() ?? 0,
    size: info.size,
    signature: executeSceneSignature(character, scenePath),
  }
}

/**
 * Write the DTH Exporter job file for this character and start Daz Studio.
 *
 *  - scope `scene`: the selected scene's jobs, ALWAYS (no affected-check).
 *  - scope `all`: every linked scene's jobs, but only the scenes whose inputs
 *    changed since the last handoff — the `.duf` (mtime+size) or the definition
 *    signature (base params; plus the scene's own override record for
 *    non-primary scenes). First run = everything; `force` = everything.
 *
 * Each enqueued scene contributes its script rows in run order (the ROM script,
 * plus the split Export script when the export is split off). The job file
 * replaces any pending one (last write wins). Scenes are stamped at handoff —
 * the job file is the delivery, the plugin deletes it once parsed.
 *
 * Throws with a user-facing message when preconditions fail: no DAZ library
 * configured, no primary scene, generated scripts missing (save first), or a
 * scene file that can't be read.
 */
export async function executeCharacterJobs({ data }: { data: unknown }): Promise<ExecuteJobsSummary> {
  const { projectId, id, scope, scenePath, force } = executeInput.parse(data)
  if (!isTauri()) throw new Error('Execute needs the desktop app (Daz Studio is launched natively).')

  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the generated scripts live there.')
  }

  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!location || !character) throw new Error(`Character ${id} not found`)
  if (!character.scenePath) {
    throw new Error('No primary Daz scene is linked — link one before executing.')
  }

  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)

  // The generated scripts must exist on disk — Execute runs what generation
  // wrote, so an unsaved/never-generated character has nothing to hand off.
  const scriptsDir = storage.studioCharScriptsDir(
    settings.dazLibraryFolder,
    project.name,
    character.name,
  )
  const scriptNames = characterJobScriptNames(character)
  const scriptPaths = scriptNames.map((name) => joinPath(scriptsDir, name))
  for (const path of scriptPaths) {
    if (!(await exists(path))) {
      throw new Error(`The generated script is missing:\n${path}\nSave the character to regenerate it, then try again.`)
    }
  }

  // Which scenes to enqueue.
  let candidates: Array<string>
  if (scope === 'scene') {
    const wanted = normalizeSceneKey(scenePath ?? character.scenePath)
    const match = linked.find((s) => normalizeSceneKey(s) === wanted)
    if (!match) throw new Error('The selected scene is not linked to this character anymore.')
    candidates = [match]
  } else {
    // Execute all is only meaningful when the runs deliver something — the
    // export directory. The UI disables the button; this is the backstop.
    if (!character.exportPath.trim()) {
      throw new Error('Execute all needs an export directory — set one in the Export directory panel.')
    }
    candidates = linked
  }

  // Current stamps for every candidate (also validates the .duf files exist).
  const stamps = new Map<string, ExecuteStamp>()
  for (const scene of candidates) {
    stamps.set(scene, await currentStamp(character, scene))
  }

  // Affected-filter (execute-all without force): skip scenes whose stored stamp
  // matches. A missing stamps file means first run — everything is affected.
  const stampsPath = joinPath(location.folderAbs, EXECUTE_STAMPS_FILE)
  let stored: ExecuteStamps = { version: 1, scenes: {} }
  try {
    if (await exists(stampsPath)) stored = parseExecuteStamps(await readTextFile(stampsPath))
  } catch {
    // unreadable stamps = no stamps — worst case we re-run scenes needlessly
  }
  const skipped: Array<string> = []
  let scenes = candidates
  if (scope === 'all' && !force) {
    scenes = candidates.filter((scene) => {
      const prev = stored.scenes[normalizeSceneKey(scene)]
      const now = stamps.get(scene)
      const unchanged =
        prev !== undefined &&
        now !== undefined &&
        prev.mtimeMs === now.mtimeMs &&
        prev.size === now.size &&
        prev.signature === now.signature
      if (unchanged) skipped.push(scene)
      return !unchanged
    })
  }
  if (scenes.length === 0) {
    return { jobFile: '', scenes: [], skipped, dazLaunched: false, dazWasRunning: false }
  }

  // One row per (scene, script) in run order. Consecutive same-scene rows run in
  // the same Daz session (the plugin only reopens on a path change), which is
  // what lets the split Export script see the ROM the previous row built.
  const jobs: Array<ExporterJob> = scenes.flatMap((scene) =>
    scriptPaths.map((scriptPath) => ({ scenePath: scene, scriptPath })),
  )
  const jobFile = joinPath(storage.studioScriptsDir(settings.dazLibraryFolder), EXPORTER_JOB_FILE)
  await storage.writeTextFileAtomic(jobFile, jobFileCsv(jobs))

  // Stamp the handoff (merge — untouched scenes keep their stamps).
  const nextStamps: ExecuteStamps = { version: 1, scenes: { ...stored.scenes } }
  for (const scene of scenes) {
    const stamp = stamps.get(scene)
    if (stamp) nextStamps.scenes[normalizeSceneKey(scene)] = stamp
  }
  await storage.writeTextFileAtomic(stampsPath, JSON.stringify(nextStamps, null, 2))

  // Start Daz scene-less so the plugin's startup check finds the job file. A
  // running instance can't be used — the plugin only checks at startup — so we
  // leave it alone and tell the user to restart Daz instead.
  const dazWasRunning = await invoke<boolean>('daz_studio_running').catch(() => false)
  let dazLaunched = false
  if (!dazWasRunning) {
    await invoke<string>('launch_daz_studio')
    dazLaunched = true
  }
  return { jobFile, scenes, skipped, dazLaunched, dazWasRunning }
}
