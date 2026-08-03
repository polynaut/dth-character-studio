import { z } from 'zod'

import { sceneExportName, sceneExportSubfolders } from '@dth/rom'

import { sceneExportFolderRel } from './execute-jobs.ts'
import { stripTrailingSeparators } from '#/lib/path.ts'

import type { Character } from '@dth/rom'

/**
 * The Houdini export handoff — the studio's second job-file contract, and a
 * deliberate mirror of the Daz one ({@link ExporterJobFile} in execute-jobs.ts):
 * the studio writes a JSON job, the other side works through it and writes
 * results back, the studio polls. Same shape, same failure story, so there is
 * one handoff pattern in this codebase rather than two.
 *
 * Houdini's half is `houdini-runtime/456.py`, which Houdini runs after a scene
 * loads when the studio's scripts folder is on HOUDINI_SCRIPT_PATH. The job path
 * travels in the `DTH_HOUDINI_JOB` environment variable, set only on the process
 * the studio spawns.
 */

/** Job + result file names, written into the character's folder beside the
 *  other dot-prefixed studio bookkeeping. */
export const HOUDINI_JOB_FILE = '.dth_houdini_job.json'
export const HOUDINI_RESULT_FILE = '.dth_houdini_result.json'

/** The env var 456.py reads the job path from ('' = do nothing at all). */
export const HOUDINI_JOB_ENV = 'DTH_HOUDINI_JOB'

/** App-data folder the bundled `456.py` is written into before a launch. It is
 *  NOT installed once and forgotten: the file is rewritten every run, so a
 *  deleted or half-written copy repairs itself and an app update always wins. */
export const HOUDINI_SCRIPTS_FOLDER = 'houdini-scripts'

/**
 * What to set `HOUDINI_SCRIPT_PATH` to so Houdini runs OUR `456.py` after a
 * scene loads — `<our folder>;&`.
 *
 * The `&` is load-bearing and easy to miss: in a Houdini path variable it
 * stands for the path Houdini would have used by itself. Setting the variable
 * to our folder ALONE replaces the default, which would silently disable the
 * user's own startup scripts (and Houdini's) for the whole session. Windows
 * separates entries with `;`.
 */
export function houdiniScriptPathValue(scriptsDir: string): string {
  const dir = stripTrailingSeparators(scriptsDir.trim().replace(/\\/g, '/'))
  return dir ? `${dir};&` : '&'
}

export interface HoudiniJobScene {
  /**
   * Absolute path of the `.dth` this scene exported — the MATCH KEY. A
   * DazToHueImport node stores it in `import_character_dtu_file`, and since the
   * studio wrote that exact file, comparing paths identifies which network
   * belongs to which Daz scene. A name match would break the moment the user
   * renames a network; this doesn't.
   */
  dth: string
  /** The scene's display label, echoed back in the result for the report. */
  label: string
}

export interface HoudiniJobFile {
  version: 1
  scenes: Array<HoudiniJobScene>
  /**
   * Fallback export directory for a node that has NONE set. Never overrides a
   * directory the user configured on the node — the Houdini project is theirs,
   * and its output location is a deliberate choice.
   */
  exportDirectory: string
  /** Where 456.py writes progress + results for the studio to poll. */
  resultPath: string
}

/** One export node's outcome, as 456.py reports it. */
export const houdiniNodeResultSchema = z.object({
  node: z.string(),
  type: z.string().default(''),
  scene: z.string().default(''),
  dth: z.string().default(''),
  status: z.enum(['ok', 'skipped', 'failed']),
  /** What the HDA's own pre-flight check reported. The studio answers its
   *  "Continue anyway?" with Yes, so these must surface in the report or they
   *  would simply vanish. */
  problems: z.array(z.string()).default([]),
  error: z.string().default(''),
  seconds: z.number().default(0),
})
export type HoudiniNodeResult = z.infer<typeof houdiniNodeResultSchema>

/** Tolerant: the file is read WHILE it's being written to, so every field
 *  carries a default and an unknown extra is ignored rather than fatal. */
export const houdiniResultSchema = z.object({
  version: z.number().default(1),
  state: z.enum(['running', 'done', 'failed']).default('running'),
  total: z.number().default(0),
  done: z.number().default(0),
  nodes: z.array(houdiniNodeResultSchema).default([]),
  error: z.string().default(''),
})
export type HoudiniResult = z.infer<typeof houdiniResultSchema>

/** Parse a result file, tolerating a torn read (returns null — the caller polls
 *  again rather than treating one bad read as a failed run). */
export function parseHoudiniResult(text: string): HoudiniResult | null {
  try {
    return houdiniResultSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * The absolute `.dth` path a linked scene exports to — the SAME rule the export
 * watch uses for its expected files: `<exportPath>/<scene folder>/<name>.dth`,
 * where the name is {@link sceneExportName} (the primary scene keeps the bare
 * character name; extras carry their subfolder). Returns '' when the character
 * has no export directory.
 */
export function sceneDthPath(
  character: Character,
  sceneKey: string,
  scenesRootAbs?: string,
): string {
  const root = stripTrailingSeparators(character.exportPath.trim().replace(/\\/g, '/'))
  if (!root) return ''
  // NORMALIZE what we were handed. `sceneExportFolderRel`/`sceneExportSubfolders`
  // key by `normalizeSceneKey` (lowercased, forward slashes) — and the caller is
  // the export dialog, which passes the character's stored paths verbatim. Any
  // Windows path has a capital letter in it, so looking up the raw string missed
  // EVERY scene: the job came out empty and "Export too" died on "none of these
  // scenes has an export path" every single time. Accept either spelling here
  // rather than making every caller remember.
  const key = sceneKey.trim().replace(/\\/g, '/').toLowerCase()
  const folders = sceneExportFolderRel(character, scenesRootAbs)
  const entry = folders[key]
  if (!entry) return ''
  const subfolders = sceneExportSubfolders(character, scenesRootAbs)
  const stem = (key.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  const name = sceneExportName(character, key, subfolders[key] ?? stem)
  return [root, entry.folder, `${name}.dth`].filter(Boolean).join('/')
}

/**
 * Build the job for a set of SELECTED scenes. Only scenes that resolve to a
 * `.dth` path are included — a scene with no export path has nothing for a
 * Houdini network to have imported, so there is nothing to match it against.
 */
export function buildHoudiniJob(
  character: Character,
  sceneKeys: ReadonlyArray<string>,
  options: { resultPath: string; exportDirectory?: string; scenesRootAbs?: string },
): HoudiniJobFile {
  // Scene KEYS are normalized (lowercased) for matching, so a label taken from
  // one would read "kirasummertide". Recover the original spelling from the
  // character's own linked paths.
  const original = new Map<string, string>()
  for (const scene of [character.scenePath, ...character.extraScenes]) {
    const path = scene.trim().replace(/\\/g, '/')
    if (path) original.set(path.toLowerCase(), path)
  }
  const scenes: Array<HoudiniJobScene> = []
  const seen = new Set<string>()
  for (const key of sceneKeys) {
    const dth = sceneDthPath(character, key, options.scenesRootAbs)
    if (!dth) continue
    const lower = dth.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    // Same normalization as sceneDthPath — a caller may hand us either
    // spelling, and the label map is keyed lowercase.
    const source = original.get(key.trim().replace(/\\/g, '/').toLowerCase()) ?? key
    scenes.push({ dth, label: (source.split('/').pop() ?? '').replace(/\.[^.]+$/, '') || key })
  }
  return {
    version: 1,
    scenes,
    exportDirectory: (options.exportDirectory ?? '').replace(/\\/g, '/'),
    resultPath: options.resultPath.replace(/\\/g, '/'),
  }
}

/**
 * The live state of a Houdini run, derived from what the result file says (or
 * doesn't yet). Pure, so the polling rule is testable without a Houdini:
 *
 *  - no file yet → `starting` (Houdini is loading; it writes the file as soon
 *    as 456.py runs, which is AFTER the scene finishes opening — on a big
 *    project that is a while, and it is not an error)
 *  - `running` → progress, `done` of `total`
 *  - `done`/`failed` → `finished`, with the summary the toast shows
 *
 * `houdiniRunning` is the liveness check: a run whose Houdini has EXITED
 * without ever finishing is dead (the user closed the window, or Houdini
 * crashed), and must stop the poll rather than spin forever.
 */
export type HoudiniRunState =
  | { state: 'starting' }
  | { state: 'running'; done: number; total: number }
  | {
      state: 'finished'
      ok: number
      skipped: number
      failed: number
      summary: string
      error: string
      /** What the HDA's pre-flight check complained about, per node
       *  ("<scene>: <problem>"). The studio answered its "Continue anyway?"
       *  with Yes, so this is the ONLY place those warnings ever surface — and
       *  the result file they came from is deleted right after this snapshot. */
      problems: Array<string>
    }
  | { state: 'dead' }

export function houdiniRunStateFrom(
  result: HoudiniResult | null,
  houdiniRunning: boolean,
): HoudiniRunState {
  if (!result) return houdiniRunning ? { state: 'starting' } : { state: 'dead' }
  if (result.state === 'running') {
    if (!houdiniRunning) return { state: 'dead' }
    return { state: 'running', done: result.done, total: result.total }
  }
  const counts = { ok: 0, skipped: 0, failed: 0 }
  for (const node of result.nodes) counts[node.status] += 1
  return {
    state: 'finished',
    ...counts,
    summary: houdiniResultSummary(result),
    error: result.state === 'failed' ? result.error || 'the run failed in Houdini' : result.error,
    problems: result.nodes.flatMap((node) =>
      node.problems.map((problem) => `${node.scene || node.node}: ${problem}`),
    ),
  }
}

/**
 * Which of the run's two files the studio should delete now that the poll has
 * reached `state`. The handoff owns its litter: both files live in the
 * character folder, and leaving them there after a finished run was pure
 * leftovers — the next run only ever overwrote the job and cleared the result.
 *
 * The one subtlety is the JOB file, and it is why this is a rule rather than an
 * unconditional delete: it may only go once 456.py has written a result, which
 * is the proof it READ the job. A `dead` verdict with no result at all can be a
 * Houdini that merely hasn't registered with the liveness probe yet — deleting
 * the job under it would break the run it is about to pick up. So an
 * unconsumed job is left for the next run to overwrite.
 */
export function houdiniRunFilesToClear(options: {
  state: HoudiniRunState['state']
  /** Whether 456.py has written a parseable result file for this run. */
  hasResult: boolean
  jobPath: string
  resultPath: string
}): Array<string> {
  if (options.state !== 'finished' && options.state !== 'dead') return []
  if (!options.hasResult) return []
  return [options.resultPath, options.jobPath].filter(Boolean)
}

/** A finished run's one-line summary for the toast, e.g.
 *  "2 exported, 1 skipped". '' when nothing ran. */
export function houdiniResultSummary(result: HoudiniResult): string {
  const counts = { ok: 0, skipped: 0, failed: 0 }
  for (const node of result.nodes) counts[node.status] += 1
  const parts: Array<string> = []
  if (counts.ok) parts.push(`${counts.ok} exported`)
  if (counts.skipped) parts.push(`${counts.skipped} skipped`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  return parts.join(', ')
}
