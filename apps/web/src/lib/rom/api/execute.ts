import { exists, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  EXECUTE_STAMPS_FILE,
  EXPORTER_JOB_FILE,
  RUNNING_JOB_FILE,
  characterJobScriptNames,
  executeSceneSignature,
  jobFileJson,
  normalizeSceneKey,
  openSceneJobFileJson,
  parseExecuteStamps,
  parseJobFileJson,
  romAnimationPath,
} from '../execute-jobs'
import { BUILD_ROM_ANIMATION_SCRIPT } from '@dth/rom'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

import type { ExecuteStamp, ExecuteStamps, ExporterJob } from '../execute-jobs'
import type { CharacterLocation } from '../storage'
import type { Character } from '@dth/rom'

// The DTH Export feature (job-file contract v2): hand the character's
// ROM+export runs to the DTH Character Studio Runner as a JSON job file in
// the Daz library, starting Daz Studio when it isn't running. The Runner
// polls for the file (startup + regularly, so a running instance accepts new
// batches), RENAMES it (`running_` prefix — the "started" signal; only an
// un-renamed file can still be aborted by deletion), then works through the
// rows while updating the file's `progress` + per-job statuses. The studio
// polls the renamed file, deletes it at progress 100 and toasts the outcome.
// Contract: docs/exporter-plugin-job-file.md. The pure parts (JSON text,
// signatures) live in ../execute-jobs.ts. The scene choice is the export
// DIALOG's (the studio pre-checks the affected scenes via
// fetchExecuteScenes); this module takes the chosen list verbatim.

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

/** Absolute paths of the (one, global) job file pair — the pending file the
 *  studio writes and the `running_` one the Runner renames it to. Null when
 *  the desktop app / Daz library aren't available. */
async function exporterJobFilePaths(): Promise<{ pending: string; running: string } | null> {
  if (!isTauri()) return null
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) return null
  const dir = storage.studioScriptsDir(settings.dazLibraryFolder)
  return { pending: joinPath(dir, EXPORTER_JOB_FILE), running: joinPath(dir, RUNNING_JOB_FILE) }
}

/**
 * Whether a job file is currently waiting for Daz Studio to pick it up. Drives
 * the header button's Abort state — the Runner RENAMES the file when it starts
 * (contract v2), so "the un-renamed file exists" IS "pending / abortable".
 * Best-effort false on any read problem.
 */
export async function exporterJobsPending(): Promise<boolean> {
  const paths = await exporterJobFilePaths()
  if (!paths) return false
  try {
    return await exists(paths.pending)
  } catch {
    return false
  }
}

/** How long to wait for the Runner to claim an `open-scene` handoff, and how
 *  often to look. The plugin polls "every few seconds", so this has to cover a
 *  full poll interval plus slack — but it is also a user waiting on a click, so
 *  it can't be generous. ~10s: long enough that a working Runner always wins,
 *  short enough that the fallback dialog doesn't feel hung. */
const OPEN_SCENE_PICKUP_TIMEOUT_MS = 10_000
const OPEN_SCENE_POLL_MS = 400

/**
 * Ask a RUNNING Daz Studio to open `scenePath`, via the Runner's `open-scene`
 * job (contract v3 — docs/exporter-plugin-job-file.md). Daz drops a forwarded
 * command-line open once a scene is loaded, so this is the only way to switch
 * the scene of an instance that is already up; the Runner also raises the Daz
 * window, which the studio can't do from outside (Windows blocks
 * SetForegroundWindow for a background process).
 *
 * Returns whether the Runner CLAIMED the job — the caller falls back to the
 * "Daz is already open" dialog when it didn't. Non-pickup is the expected path
 * on an old or missing Runner: an unknown `type` is foreign to it, so it leaves
 * the file alone and we take it back. That is the whole capability handshake;
 * there is no version check.
 *
 * Claimed only means the Runner started — the scene load itself happens after
 * we return (a big `.duf` takes a while, and blocking the click on it would be
 * worse than useless). The finished `running_` file is swept by the next
 * handoff, exactly like a batch nobody watched.
 */
export async function openSceneInRunningDaz({
  data,
}: {
  data: unknown
}): Promise<{ pickedUp: boolean }> {
  const { scenePath } = z.object({ scenePath: z.string().min(1) }).parse(data)
  if (!isTauri()) throw new Error('Opening a scene in a running Daz needs the desktop app.')
  const paths = await exporterJobFilePaths()
  if (!paths) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file lives there.')
  }
  if (!(await exists(scenePath))) throw new Error(`The scene file is missing:\n${scenePath}`)
  // One global job file, and the Runner works one batch at a time: never
  // overwrite an export handoff with a scene open.
  if (await exists(paths.pending)) {
    throw new Error('An export batch is waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    // A batch in flight owns the Runner; a FINISHED one (progress 100) is just
    // litter nobody swept, so clear that and continue.
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      // Unreadable or torn: assume a live batch — refusing is the safe guess.
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through an export batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }

  await storage.writeTextFileAtomic(paths.pending, openSceneJobFileJson(scenePath))
  const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
    // The rename IS the claim (contract v2 lifecycle, shared by every type).
    if (!(await exists(paths.pending).catch(() => true))) return { pickedUp: true }
  }
  // Nobody claimed it — take the file back so it can't be picked up minutes
  // later, out of nowhere, and yank the user's scene out from under them.
  await remove(paths.pending).catch(() => {})
  return { pickedUp: false }
}

/**
 * The handed-off run, kept IN MEMORY until it finishes or is aborted/dismissed
 * — it scopes the job file's global state to the character whose button
 * started it. All actual progress lives IN the (renamed) job file, written by
 * the Runner. Per-window state (one run at a time; a new handoff replaces
 * it), gone on a window close — a finished `running_` file nobody watched is
 * cleaned up by the next handoff.
 */
interface ActiveExportRun {
  characterId: string
  total: number
}
let activeRun: ActiveExportRun | null = null

export type ExportRunProgress =
  /** Daz hasn't picked the file up yet (it can still be aborted). */
  | { state: 'pending'; characterId: string; total: number }
  /** The Runner renamed the file and is working — `progress` is its 0–100. */
  | { state: 'running'; characterId: string; total: number; progress: number; done: number; failed: number }
  /** progress hit 100 — the studio has DELETED the file; final snapshot. */
  | { state: 'finished'; characterId: string; total: number; failed: number; errors: Array<string> }
  /** The run died (Daz gone mid-run / file vanished) — watch ended. */
  | { state: 'dead'; characterId: string; total: number }

/**
 * The active run's live state (null when none), straight from the job-file
 * pair: pending file still there → 'pending'; `running_` file there → parse
 * its Runner-owned progress — at 100 the studio deletes the file and returns
 * the one 'finished' snapshot (the caller toasts the outcome). A running file
 * whose Daz has EXITED below 100 is a dead run: deleted + reported 'dead'
 * once. A torn read (the Runner rewrites the file between rows) just reports
 * the last state again — the next poll gets a clean parse.
 */
export async function fetchExportRunProgress(): Promise<ExportRunProgress | null> {
  const run = activeRun
  if (!run) return null
  const paths = await exporterJobFilePaths()
  if (!paths) return null
  try {
    if (await exists(paths.pending)) {
      return { state: 'pending', characterId: run.characterId, total: run.total }
    }
    if (await exists(paths.running)) {
      const parsed = parseJobFileJson(await readTextFile(paths.running))
      if (!parsed) {
        // Torn read mid-rewrite — report "still running" and retry next poll.
        return { state: 'running', characterId: run.characterId, total: run.total, progress: 0, done: 0, failed: 0 }
      }
      const done = parsed.jobs.filter((j) => j.status === 'done').length
      const failed = parsed.jobs.filter((j) => j.status === 'failed').length
      if (parsed.progress >= 100) {
        // The batch is complete — the studio owns the cleanup + the toast.
        try {
          await remove(paths.running)
        } catch {
          // locked file — the next handoff's stale-cleanup retries
        }
        if (activeRun === run) activeRun = null
        return {
          state: 'finished',
          characterId: run.characterId,
          total: parsed.jobs.length || run.total,
          failed,
          errors: parsed.jobs.filter((j) => j.error).map((j) => `${j.scenePath}: ${j.error ?? ''}`),
        }
      }
      // Below 100 with Daz gone = the run died (crash / user quit) — it will
      // never finish; clean up and report once.
      const dazRunning = await invoke<boolean>('daz_studio_running').catch(() => true)
      if (!dazRunning) {
        try {
          await remove(paths.running)
        } catch {
          // best effort
        }
        if (activeRun === run) activeRun = null
        return { state: 'dead', characterId: run.characterId, total: run.total }
      }
      return {
        state: 'running',
        characterId: run.characterId,
        total: parsed.jobs.length || run.total,
        progress: parsed.progress,
        done,
        failed,
      }
    }
  } catch {
    // transient fs error — keep the watch alive, retry next poll
    return { state: 'pending', characterId: run.characterId, total: run.total }
  }
  // Neither file exists: aborted externally or cleaned behind our back.
  if (activeRun === run) activeRun = null
  return { state: 'dead', characterId: run.characterId, total: run.total }
}

/** Stop watching the active run (the run in Daz is unaffected — the watch is
 *  an observer only). The escape hatch for a batch that errored in Daz and
 *  will never deliver its remaining scenes. */
export function dismissExportRun(): void {
  activeRun = null
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
  const paths = await exporterJobFilePaths()
  if (!paths) return
  let rows: Array<ExporterJob> = []
  try {
    if (!(await exists(paths.pending))) return
    rows = parseJobFileJson(await readTextFile(paths.pending))?.jobs ?? []
  } catch {
    // unreadable job file — still delete it below; stamps stay (worst case a
    // scene reads "unchanged" until its next real change or a manual re-check)
  }
  await remove(paths.pending)
  // The aborted handoff will never run — stop the export watch with it.
  activeRun = null
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
  /** True when Daz was already running — the plugin's regular poll picks the
   *  job file up in that instance, no restart needed. */
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
 * Write the DTH Exporter job file (JSON, contract v2) for the chosen scenes
 * and start Daz Studio.
 *
 * One row per scene: the hidden bulk script (.Bulk_ROM_Export.dsa) — it
 * always builds the ROM and always exports everything (the split/hair toggles
 * only govern the visible per-character scripts). The job file replaces any
 * pending one (last write wins), and a stale `running_` file from an earlier
 * unwatched/dead batch is cleaned up first (the Runner never deletes it —
 * cleanup is the studio's). Scenes are stamped at handoff.
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

  // One row per (scene, script) in run order — today that's one bulk-script
  // row per scene (see characterJobScriptNames).
  const jobs: Array<ExporterJob> = scenes.flatMap((scene) =>
    scriptPaths.map((scriptPath) => ({ scenePath: scene, scriptPath })),
  )
  const scriptsRoot = storage.studioScriptsDir(settings.dazLibraryFolder)
  const jobFile = joinPath(scriptsRoot, EXPORTER_JOB_FILE)
  // A leftover `running_` file (a finished batch nobody watched, or a dead
  // one) would block the Runner's rename — the studio owns its cleanup.
  try {
    const staleRunning = joinPath(scriptsRoot, RUNNING_JOB_FILE)
    if (await exists(staleRunning)) await remove(staleRunning)
  } catch {
    // best effort — the Runner also clears a stale running file before renaming
  }
  await storage.writeTextFileAtomic(jobFile, jobFileJson(jobs))

  // Arm the watch: the run's identity only — all live state (progress,
  // per-job statuses) is Runner-owned inside the renamed job file.
  activeRun = { characterId: character.id, total: jobs.length }

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

  // Start Daz scene-less when it isn't running; a running instance needs
  // nothing — the plugin polls for the job file and picks it up in place.
  const dazWasRunning = await invoke<boolean>('daz_studio_running').catch(() => false)
  let dazLaunched = false
  if (!dazWasRunning) {
    await invoke<string>('launch_daz_studio')
    dazLaunched = true
  }
  return { jobFile, scenes, dazLaunched, dazWasRunning }
}

const generateRomInput = charScopeInput.extend({
  /** The linked scene to build + save the ROM animation for. */
  scenePath: z.string().min(1),
})

/**
 * Hand a ROM-ANIMATION build for ONE scene to the Runner: a one-row
 * bulk-export batch pointing at the hidden ROM-only script
 * ({@link BUILD_ROM_ANIMATION_SCRIPT}, runtime v43) — it builds the ROM and
 * saves the reopenable `.ROM_Animations/<stem>_ROM.duf`, exporting nothing.
 * The scene card polls for that file (its path is returned) and opens it when
 * it appears. Same handoff mechanics as {@link executeCharacterJobs} — stale
 * `running_` cleanup, Daz launched when closed — but NO handoff stamps: this
 * run delivers no export, so it must not mark the scene "exported".
 */
export async function generateRomAnimation({
  data,
}: {
  data: unknown
}): Promise<{ romPath: string; dazWasRunning: boolean; startedAt: number }> {
  const { projectId, id, scenePath } = generateRomInput.parse(data)
  if (!isTauri()) throw new Error('Generating a ROM animation needs the desktop app.')
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the generated scripts live there.')
  }
  const { project, character } = await loadCharacter(projectId, id)
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const scene = linked.find((s) => normalizeSceneKey(s) === normalizeSceneKey(scenePath))
  if (!scene) throw new Error(`The scene is not linked to this character anymore:\n${scenePath}`)
  const scriptPath = joinPath(
    storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name),
    BUILD_ROM_ANIMATION_SCRIPT,
  )
  if (!(await exists(scriptPath))) {
    throw new Error(
      `The generated script is missing:\n${scriptPath}\nSave the character to regenerate it, then try again.`,
    )
  }
  const paths = await exporterJobFilePaths()
  if (!paths) throw new Error('Set “My DAZ 3D Library” in Settings first.')
  // One global job file, one batch at a time — never clobber an export handoff.
  if (await exists(paths.pending)) {
    throw new Error('An export batch is waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      // Unreadable or torn: assume a live batch — refusing is the safe guess.
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through an export batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }
  await storage.writeTextFileAtomic(paths.pending, jobFileJson([{ scenePath: scene, scriptPath }]))
  const startedAt = Date.now()
  const dazWasRunning = await invoke<boolean>('daz_studio_running').catch(() => false)
  if (!dazWasRunning) await invoke<string>('launch_daz_studio')
  return { romPath: romAnimationPath(scene), dazWasRunning, startedAt }
}

/**
 * Whether the saved ROM animation at `romPath` is FRESH — written at/after
 * `sinceMs`. The generate flow polls this instead of bare existence, because a
 * regenerate OVERWRITES an existing file: only a new mtime means the Daz run
 * saved. Best-effort false (missing file, unreadable stat).
 */
export async function romAnimationFresh({ data }: { data: unknown }): Promise<boolean> {
  const { romPath, sinceMs } = z
    .object({ romPath: z.string().min(1), sinceMs: z.number() })
    .parse(data)
  if (!isTauri()) return false
  try {
    const info = await stat(romPath)
    return (info.mtime?.getTime() ?? 0) >= sinceMs
  } catch {
    return false
  }
}
