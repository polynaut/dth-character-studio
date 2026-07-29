import { exists, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
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
  parseJobFileCsv,
} from '../execute-jobs'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

import type { ExecuteStamp, ExecuteStamps, ExporterJob } from '../execute-jobs'
import type { CharacterLocation } from '../storage'
import type { Character } from '@dth/rom'

// The DTH Export feature: hand the character's ROM/export runs to the DTH
// Exporter Plugin as a job file (scene path + script path rows) in the Daz
// library, then start Daz Studio — the plugin finds the file on startup, deletes
// it (the transfer ack) and works through the rows. Contract:
// docs/exporter-plugin-job-file.md. The pure parts (CSV text, signatures) live
// in ../execute-jobs.ts. The scene choice is the export DIALOG's (the studio
// pre-checks the affected scenes via fetchExecuteScenes); this module takes the
// chosen list verbatim.

/** Resolve the character + its on-disk location for either entry point. */
async function loadCharacter(
  projectId: string,
  id: string,
): Promise<{
  project: Awaited<ReturnType<typeof resolveProject>>
  location: CharacterLocation
  character: Character
}> {
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!location || !character) throw new Error(`Character ${id} not found`)
  return { project, location, character }
}

/** Read a character's stored handoff stamps (missing/corrupt = empty). */
async function readStamps(location: CharacterLocation): Promise<ExecuteStamps> {
  const stampsPath = joinPath(location.folderAbs, EXECUTE_STAMPS_FILE)
  try {
    if (await exists(stampsPath)) return parseExecuteStamps(await readTextFile(stampsPath))
  } catch {
    // unreadable stamps = no stamps — worst case a scene re-runs needlessly
  }
  return { version: 1, scenes: {} }
}

/** Absolute path of the (one, global) job file — null when the desktop app /
 *  Daz library aren't available, i.e. there can be no job file to speak of. */
async function exporterJobFilePath(): Promise<string | null> {
  if (!isTauri()) return null
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) return null
  return joinPath(storage.studioScriptsDir(settings.dazLibraryFolder), EXPORTER_JOB_FILE)
}

/**
 * Whether a job file is currently waiting for Daz Studio to pick it up. Drives
 * the header button's Abort state — the plugin deletes the file once parsed,
 * so "exists" IS "pending". Best-effort false on any read problem.
 */
export async function exporterJobsPending(): Promise<boolean> {
  const path = await exporterJobFilePath()
  if (!path) return false
  try {
    return await exists(path)
  } catch {
    return false
  }
}

/**
 * Abort a pending handoff: delete the job file before Daz consumes it, and roll
 * the aborted scenes' handoff stamps back on THIS character (they were stamped
 * at handoff; without the rollback they'd read "unchanged" in the next dialog
 * despite never having run). Rows belonging to another character's handoff
 * simply don't match this character's stamp keys — the file still goes away,
 * which is what Abort promises.
 */
export async function abortExporterJobs({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  const path = await exporterJobFilePath()
  if (!path) return
  let rows: ReturnType<typeof parseJobFileCsv> = []
  try {
    if (!(await exists(path))) return
    rows = parseJobFileCsv(await readTextFile(path))
  } catch {
    // unreadable job file — still delete it below; stamps stay (worst case a
    // scene reads "unchanged" until its next real change or a manual re-check)
  }
  await remove(path)
  if (rows.length === 0) return
  try {
    const { location } = await loadCharacter(projectId, id)
    const stored = await readStamps(location)
    const aborted = new Set(rows.map((row) => normalizeSceneKey(row.scenePath)))
    const scenes = Object.fromEntries(
      Object.entries(stored.scenes).filter(([key]) => !aborted.has(key)),
    )
    await storage.writeTextFileAtomic(
      joinPath(location.folderAbs, EXECUTE_STAMPS_FILE),
      JSON.stringify({ version: 1, scenes }, null, 2),
    )
  } catch {
    // stamp rollback is best-effort — the abort itself (the delete) succeeded
  }
}

/** One linked scene's state for the DTH Export dialog. */
export interface ExecuteSceneStatus {
  scenePath: string
  primary: boolean
  /** Inputs changed since the last handoff (or never handed off) — the dialog's
   *  default check. Always false when the `.duf` is missing. */
  affected: boolean
  /** The `.duf` can't be read — the row can't be exported. */
  missing: boolean
}

/**
 * Every linked scene with its affected-state — what the DTH Export dialog
 * pre-checks. Per-scene tolerant: an unreadable `.duf` reports `missing`
 * instead of throwing (the dialog disables that row).
 */
export async function fetchExecuteScenes({ data }: { data: unknown }): Promise<Array<ExecuteSceneStatus>> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return []
  const { location, character } = await loadCharacter(projectId, id)
  const stored = await readStamps(location)
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  return Promise.all(
    linked.map(async (scenePath, index) => {
      const primary = index === 0
      let info: Awaited<ReturnType<typeof stat>>
      try {
        info = await stat(scenePath)
      } catch {
        return { scenePath, primary, affected: false, missing: true }
      }
      const prev = stored.scenes[normalizeSceneKey(scenePath)]
      const affected =
        prev === undefined ||
        prev.mtimeMs !== (info.mtime?.getTime() ?? 0) ||
        prev.size !== info.size ||
        prev.signature !== executeSceneSignature(character, scenePath)
      return { scenePath, primary, affected, missing: false }
    }),
  )
}

const executeInput = charScopeInput.extend({
  /** The scenes to enqueue, chosen in the DTH Export dialog — each must be one
   *  of the character's linked scenes. */
  scenes: z.array(z.string().min(1)).min(1),
})

export interface ExecuteJobsSummary {
  /** Absolute path of the job file written. */
  jobFile: string
  /** Scenes whose jobs were enqueued, in job order. */
  scenes: Array<string>
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
 * Write the DTH Exporter job file for the chosen scenes and start Daz Studio.
 *
 * Each scene contributes its script rows in run order (the ROM script, plus the
 * split Export script when the export is split off). The job file replaces any
 * pending one (last write wins). Scenes are stamped at handoff — the job file
 * is the delivery, the plugin deletes it once parsed.
 *
 * Throws with a user-facing message when preconditions fail: no DAZ library
 * configured, no export directory, generated scripts missing (save first), or
 * a scene file that can't be read.
 */
export async function executeCharacterJobs({ data }: { data: unknown }): Promise<ExecuteJobsSummary> {
  const { projectId, id, scenes: chosen } = executeInput.parse(data)
  if (!isTauri()) throw new Error('DTH Export needs the desktop app (Daz Studio is launched natively).')

  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the generated scripts live there.')
  }

  const { project, location, character } = await loadCharacter(projectId, id)
  if (!character.scenePath) {
    throw new Error('No primary Daz scene is linked — link one before exporting.')
  }
  // The runs exist to deliver exports — without an export directory the ROM
  // would build and export nothing. The UI disables the button; backstop here.
  if (!character.exportPath.trim()) {
    throw new Error('DTH Export needs an export directory — set one in the Export directory panel.')
  }

  // Resolve each chosen scene to its linked spelling (the dialog passes them
  // verbatim, but be tolerant of separator/case differences).
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const scenes = chosen.map((scene) => {
    const match = linked.find((s) => normalizeSceneKey(s) === normalizeSceneKey(scene))
    if (!match) throw new Error(`The scene is not linked to this character anymore:\n${scene}`)
    return match
  })

  // The generated scripts must exist on disk — the export runs what generation
  // wrote, so an unsaved/never-generated character has nothing to hand off.
  const scriptsDir = storage.studioCharScriptsDir(
    settings.dazLibraryFolder,
    project.name,
    character.name,
  )
  const scriptPaths = characterJobScriptNames(character).map((name) => joinPath(scriptsDir, name))
  for (const path of scriptPaths) {
    if (!(await exists(path))) {
      throw new Error(`The generated script is missing:\n${path}\nSave the character to regenerate it, then try again.`)
    }
  }

  // Current stamps for every chosen scene (also validates the .duf files exist).
  const stamps = new Map<string, ExecuteStamp>()
  for (const scene of scenes) {
    stamps.set(scene, await currentStamp(character, scene))
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
  const stored = await readStamps(location)
  const nextStamps: ExecuteStamps = { version: 1, scenes: { ...stored.scenes } }
  for (const scene of scenes) {
    const stamp = stamps.get(scene)
    if (stamp) nextStamps.scenes[normalizeSceneKey(scene)] = stamp
  }
  await storage.writeTextFileAtomic(
    joinPath(location.folderAbs, EXECUTE_STAMPS_FILE),
    JSON.stringify(nextStamps, null, 2),
  )

  // Start Daz scene-less so the plugin's startup check finds the job file. A
  // running instance can't be used — the plugin only checks at startup — so we
  // leave it alone and tell the user to restart Daz instead.
  const dazWasRunning = await invoke<boolean>('daz_studio_running').catch(() => false)
  let dazLaunched = false
  if (!dazWasRunning) {
    await invoke<string>('launch_daz_studio')
    dazLaunched = true
  }
  return { jobFile, scenes, dazLaunched, dazWasRunning }
}
