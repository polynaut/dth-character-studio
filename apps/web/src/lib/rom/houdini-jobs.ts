import { z } from 'zod'

import { characterSkinning, characterSlug, sceneExportName, sceneExportSubfolders } from '@dth/rom'

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
 * Houdini's half is `houdini-runtime/456.py`, run HEADLESS: the studio spawns
 * `hython headless_export.py`, which loads the `.hip` and execs 456.py exactly
 * once. The job path travels in the `DTH_HOUDINI_JOB` environment variable,
 * set only on the process the studio spawns. Deliberately NOT via
 * HOUDINI_SCRIPT_PATH — Houdini runs a 456.py found there on the startup
 * EMPTY scene too, which consumed the job before the project loaded (measured
 * 2026-08-11, the first headless run).
 */

/** Job + result file names, written into the character's folder beside the
 *  other dot-prefixed studio bookkeeping. */
export const HOUDINI_JOB_FILE = '.dth_houdini_job.json'
export const HOUDINI_RESULT_FILE = '.dth_houdini_result.json'

/** The headless run's console log (hython's full stdout+stderr, redirected by
 *  the Rust spawn — the C++ cook chatter the in-process tee can never see).
 *  One file per character, OVERWRITTEN each run and deliberately NOT cleared
 *  with the job/result: it is the diagnosis channel for a run that reports
 *  something puzzling (the first headless run's bare "nothing to export"
 *  proved that the hard way), and one bounded file per character is exactly
 *  the retention the housekeeping rule asks for. */
export const HOUDINI_CONSOLE_FILE = '.dth_houdini_console.log'

/** The Houdini leg's run-plan sidecar (`api/houdini.ts`'s `saveHoudiniRunPlan`)
 *  — the current project, the queue behind it, the scene scope and the report
 *  so far, so a reloaded window can pick the whole process back up. Named here
 *  beside its siblings because it is a RUN FILE of the character folder, and
 *  every consumer of that set (the zip exclusions) must see all of them. */
export const HOUDINI_RUN_FILE = '.dth_houdini_run.json'

/** The hython bootstrap (`headless_export.py`) written beside `456.py` into
 *  the app-data scripts folder before every launch — loads the `.hip`, then
 *  runs `456.py` exactly once (see its docstring). */
export const HOUDINI_HEADLESS_RUNNER = 'headless_export.py'

/** The env var 456.py reads the job path from ('' = do nothing at all). */
export const HOUDINI_JOB_ENV = 'DTH_HOUDINI_JOB'

/** App-data folder the bundled `456.py` is written into before a launch. It is
 *  NOT installed once and forgotten: the file is rewritten every run, so a
 *  deleted or half-written copy repairs itself and an app update always wins. */
export const HOUDINI_SCRIPTS_FOLDER = 'houdini-scripts'

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
  /**
   * The studio's INTERRUPT flag for this character (`EXPORT_CANCEL_FILE` in
   * the `.dcsmeta` folder — the same file the Daz leg's scripts probe, because
   * one run is one thing to stop). 456.py checks it between export nodes: a
   * node's `do_export` is synchronous and cannot be interrupted from outside,
   * so the boundary between two of them is the earliest honest stop point.
   * '' = this run cannot be interrupted (older studio, no meta folder).
   */
  cancelPath: string
  /**
   * Close Houdini again once the batch has written its final result. The DTH
   * Export flow always sets this: its Houdini instance exists only to carry
   * the batch, and a queue of projects would otherwise stack open windows.
   * 456.py exits from INSIDE that instance (never by killing processes), so a
   * Houdini session the user had open on their own is untouched.
   */
  closeWhenDone: boolean
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
  /** The tail of what the HDA emitted while THIS node exported (456.py's
   *  ActivityCapture: stdout/stderr/status-bar, capped) — the per-node record
   *  after the live `activity` window has moved on. */
  log: z.array(z.string()).default([]),
})
export type HoudiniNodeResult = z.infer<typeof houdiniNodeResultSchema>

/** The live mid-node channel: what the HDA is saying WHILE one export node's
 *  synchronous `do_export` runs (456.py streams its captured stdout/status-bar
 *  lines here, throttled + capped). Present only while a node is exporting. */
export const houdiniActivitySchema = z.object({
  node: z.string().default(''),
  /** The scene label the node belongs to — what the studio shows. */
  scene: z.string().default(''),
  /** The `.dth` the node's network imports — which export set it works through. */
  dth: z.string().default(''),
  /** Rolling tail, oldest first. */
  lines: z.array(z.string()).default([]),
  startedAtMs: z.number().default(0),
  updatedAtMs: z.number().default(0),
})
export type HoudiniActivity = z.infer<typeof houdiniActivitySchema>

/** Tolerant: the file is read WHILE it's being written to, so every field
 *  carries a default and an unknown extra is ignored rather than fatal. */
/** One network this run WILL export, named before it starts — see the running
 *  state's `networks`. */
const houdiniTargetSchema = z.object({
  node: z.string().default(''),
  /** The scene whose `.dth` its network imports. */
  scene: z.string().default(''),
  /** The title of the network box around it — the name the USER gave this
   *  network, and the only human-meaningful one a multi-network project has. */
  box: z.string().default(''),
})

export const houdiniResultSchema = z.object({
  version: z.number().default(1),
  state: z.enum(['running', 'done', 'failed']).default('running'),
  total: z.number().default(0),
  done: z.number().default(0),
  nodes: z.array(houdiniNodeResultSchema).default([]),
  /** What the run is about to work through, named up front. Empty from a 456.py
   *  older than this field — the task cards then fall back to counting, which
   *  is what they did before it existed. */
  targets: z.array(houdiniTargetSchema).default([]),
  error: z.string().default(''),
  activity: houdiniActivitySchema.optional(),
  /** 456.py saw the studio's interrupt flag and stopped between nodes. The
   *  nodes it never reached are still in `nodes`, as `skipped` — so the counts
   *  stay a complete account of the batch — and this is what tells "2 skipped
   *  because the user stopped it" apart from "2 skipped, nothing to do". */
  cancelled: z.boolean().default(false),
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
  options: {
    resultPath: string
    exportDirectory?: string
    scenesRootAbs?: string
    closeWhenDone?: boolean
    /** See {@link HoudiniJobFile.cancelPath} — omitted = uninterruptible. */
    cancelPath?: string
  },
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
    cancelPath: (options.cancelPath ?? '').replace(/\\/g, '/'),
    closeWhenDone: options.closeWhenDone ?? false,
  }
}

/**
 * Generation-time parameter prefill for the network the shelf tool just built —
 * everything the studio already knows, handed over so a generated project is
 * wired end-to-end instead of waiting for hand-typed paths. Every parm name is
 * MEASURED off the installed HDAs (hython parmTemplateGroup probe, 2026-08-04),
 * never guessed; `pose_asset_csv_file_path` ("Auto CSV File Path") comes from
 * mrpdean's CSV-path-driven PoseAsset build of the same day. On an older HDA
 * the unknown parms simply don't exist and the generation script skips them —
 * prefilling degrades, generation never fails.
 */
export interface HoudiniPrefill {
  /** `import_character_name` — set explicitly because prefilling the file
   *  paths may bypass the HDA's own auto-fill. */
  characterName: string
  /** `import_skinning_method` menu tokens (measured): studio `dqs` maps to
   *  `dualquat`, `linear` stays `linear`. */
  skinning: 'linear' | 'dualquat'
  /** `pose_asset_csv_file_path` on the PoseAsset node. '' anywhere below means
   *  "leave that parm untouched" (no export directory configured, or the
   *  primary scene resolves to no export folder). */
  csv: string
  /** `import_character_dtu_file` — also "Export too"'s network match key. */
  dth: string
  /** `import_character_fbx_file`. */
  fbx: string
  /** `import_character_alembic_file`. */
  abc: string
  /** `import_character_rom_fbx_file` — the exporter delivers it as
   *  `<name>_experimental_rom.fbx` (measured on a real DTH Exporter 2.x
   *  export folder; the name is the plugin's to change). */
  romFbx: string
  /** `export_directory` — where Houdini WRITES its Unreal-bound output, i.e. the
   *  character's `export/` folder, NOT the `daz-export` the imports read from.
   *  Trailing slash REQUIRED: the HDA concatenates `export_directory +
   *  character_name` naively (456.py's measured facts). */
  exportDirectory: string
}

/**
 * Build the prefill for ONE of the character's scenes — the shelf tool creates
 * one network, and that network imports one scene's export set.
 *
 * `scenePath` picks it; omitted (or naming a scene this character doesn't link)
 * falls back to the PRIMARY, which every character has. A character with several
 * outfit scenes gets a project per scene, each wired to its own
 * `daz-export/<subfolder>/` — before v0.68 every generated project pointed at
 * the primary's, and re-aiming it was a hand edit of five paths.
 *
 * With a `hipRefPrefix` (e.g. `$HIP/daz-export`, computed by
 * `hipRefPrefixFor` for the hip being generated) the import paths ride it;
 * absolute otherwise — the same style split the generated CSVs use. Name +
 * skinning are always filled; the path fields are '' when the character has no
 * export directory to point into.
 *
 * `exportDirectory` is a DIFFERENT folder from the import paths and must not be
 * derived from them: the imports read the Daz→Houdini intermediates under
 * `daz-export`, while this is where Houdini WRITES for Unreal — the character's
 * own `export/` folder (the project's `exportSubdir`). It came from the caller
 * because only the host knows that subdir. Until v0.68 it was the export ROOT,
 * which quietly aimed Houdini's output into the regenerable Daz-side tree.
 */
export function buildHoudiniPrefill(
  character: Character,
  options: {
    hipRefPrefix: string
    scenesRootAbs?: string
    /** Which linked scene to wire up; default (or unknown) = the primary. */
    scenePath?: string
    /** The character's FINAL export folder, in whichever style the caller
     *  resolved (`$HIP/../export` or absolute). '' leaves the parm alone. */
    finalExportDir?: string
  },
): HoudiniPrefill {
  const finalExport = stripTrailingSeparators((options.finalExportDir ?? '').trim().replace(/\\/g, '/'))
  const base: HoudiniPrefill = {
    characterName: characterSlug(character),
    skinning: characterSkinning(character) === 'dqs' ? 'dualquat' : 'linear',
    csv: '',
    dth: '',
    fbx: '',
    abc: '',
    romFbx: '',
    // Trailing slash: the HDA concatenates it with the character name.
    exportDirectory: finalExport ? `${finalExport}/` : '',
  }
  const exportRoot = stripTrailingSeparators(character.exportPath.trim().replace(/\\/g, '/'))
  const linked = new Set(
    [character.scenePath, ...character.extraScenes]
      .map((scene) => scene.trim().replace(/\\/g, '/').toLowerCase())
      .filter(Boolean),
  )
  const asked = (options.scenePath ?? '').trim().replace(/\\/g, '/').toLowerCase()
  const key = asked && linked.has(asked) ? asked : character.scenePath.trim().replace(/\\/g, '/').toLowerCase()
  if (!exportRoot || !key) return base
  const entry = sceneExportFolderRel(character, options.scenesRootAbs)[key]
  if (!entry) return base
  const subfolders = sceneExportSubfolders(character, options.scenesRootAbs)
  const stem = (key.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  const name = sceneExportName(character, key, subfolders[key] ?? stem)
  const root = options.hipRefPrefix || exportRoot
  const dir = [root, entry.folder].filter(Boolean).join('/')
  return {
    ...base,
    csv: `${dir}/${name}_pose_asset.csv`,
    dth: `${dir}/${name}.dth`,
    fbx: `${dir}/${name}.fbx`,
    abc: `${dir}/${name}.abc`,
    romFbx: `${dir}/${name}_experimental_rom.fbx`,
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
  /** The timing fields are merged in by `fetchHoudiniRunProgress` (the arm
   *  time lives on the in-memory watch, not in the result file) — the pure
   *  {@link houdiniRunStateFrom} never sets them. */
  | { state: 'starting'; startedAtMs?: number }
  | {
      state: 'running'
      done: number
      total: number
      startedAtMs?: number
      /** Every network of this project, in run order — named from the run's
       *  own target list, with `status` filling in as each finishes. The task
       *  cards are built from this; counts alone could only say "3 of 5", and
       *  a network nobody has reached yet would read as "Network 2" where the
       *  user has a name for it. */
      networks: Array<{ label: string; status: 'ok' | 'skipped' | 'failed' | 'waiting' }>
      /** The live mid-node channel, when 456.py has streamed any — what the
       *  currently exporting node is SAYING (see {@link houdiniActivitySchema}). */
      activity?: HoudiniActivity
    }
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
      /** The run stopped because the studio interrupted it — the counts are
       *  real, but they are not the whole batch. */
      cancelled: boolean
      /** Handoff → finish, for the toast's "in 12m 34s". */
      elapsedMs?: number
    }
  | {
      state: 'dead'
      /** What the console log says killed it, when it says anything — see
       *  {@link houdiniDeathReason}. '' when there is nothing to go on. */
      reason?: string
    }

/**
 * The headline for a run that died without a result, read out of the console
 * log the launch streams into `.dth_houdini_console.log`.
 *
 * The studio ALREADY writes this file (it is why it survives the run's own
 * cleanup) and used to report "Houdini is no longer running" regardless —
 * true, useless, and actively misleading when the log said something specific.
 * MEASURED 2026-08-12 on a real failed run: a machine that could not reach its
 * license server produced two lines of "No licenses could be found to run this
 * application", and the user was told Houdini had stopped.
 *
 * Licensing is special-cased because headless hython needs a license of its
 * own and this is the one failure that says nothing about the project, the
 * scene or the studio.
 *
 * Everything else is read out of the log's TAIL only, and only when the line
 * looks like an error. The file is the FULL console — the DazToHue HDA's cook
 * chatter included — so both of the obvious shortcuts are wrong on a long run:
 * scanning the whole text for "license server" lets one informational line at
 * startup relabel a crash forty minutes later, and taking the last line
 * whatever it is hands a progress message to the user as the cause of death.
 * A run that printed real work and then died with nothing error-shaped to say
 * gets NO reason — the plain "Houdini is no longer running" is the honest
 * answer there, and the log is one click away. The one exception is a log short
 * enough to BE the failure (hython died on startup): there the last line is the
 * whole story, which is exactly the measured licensing case.
 */
/** How many trailing lines count as "how it ended". */
const DEATH_TAIL_LINES = 40
/** A log no longer than this never got going — all of it is the failure. */
const DEATH_SHORT_LOG = 8
/** What a line that is worth quoting looks like. Deliberately broad: a raw
 *  error line beats a confident wrong summary, but it has to be an error. */
const DEATH_ERROR_LINE =
  /\b(error|fatal|traceback|exception|segmentation fault|aborted|cannot|could not|unable to|not found|denied|refused|failed)\b/i

export function houdiniDeathReason(consoleText: string): string {
  const lines = consoleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return ''
  const tail = lines.slice(-DEATH_TAIL_LINES)
  if (
    /no licen[sc]es? could be found|license server|no licen[sc]e available/i.test(tail.join(' '))
  ) {
    return 'Houdini could not get a license'
  }
  // The newest error-shaped line in the tail; failing that, the last line of a
  // log too short to have said anything else.
  const spoken =
    [...tail].reverse().find((line) => DEATH_ERROR_LINE.test(line)) ??
    (lines.length <= DEATH_SHORT_LOG ? (lines[lines.length - 1] ?? '') : '')
  return spoken.length > 160 ? `${spoken.slice(0, 159)}…` : spoken
}

/**
 * Whether this snapshot is the DEAD one — no Houdini behind a run that has not
 * reported a finish.
 *
 * Exported because the caller has to know BEFORE calling
 * {@link houdiniRunStateFrom}: reading the console log costs a file read, and
 * doing it on every 2.5 s poll would re-read a growing file for nothing. Two
 * copies of this condition (one here, one in the api layer's read guard) would
 * drift the moment either changes — and the failure would be silent, a dead run
 * that never gets its reason.
 */
export function houdiniRunLooksDead(
  result: HoudiniResult | null,
  houdiniRunning: boolean,
): boolean {
  if (houdiniRunning) return false
  return !result || result.state === 'running'
}

/**
 * Every network of the running project, in run order: named from the run's own
 * target list, `status` filled in as each finishes.
 *
 * The two lists are matched BY POSITION, which is exactly how 456.py works
 * through them — it collects its targets, then exports them in that order,
 * appending one node result each time. A run from a 456.py older than the
 * target list reports none, and then this can only name what has finished:
 * the caller's fallback ("Network 2") is the honest answer there, not a guess.
 */
function houdiniNetworks(
  result: HoudiniResult,
): Array<{ label: string; status: 'ok' | 'skipped' | 'failed' | 'waiting' }> {
  if (result.targets.length === 0) {
    return result.nodes.map((node) => ({ label: node.scene || node.node, status: node.status }))
  }
  return result.targets.map((target, index) => {
    const finished = result.nodes[index]
    return {
      // The user's own name for the network first — that is what they are
      // looking at in Houdini.
      label: target.box || target.scene || finished?.scene || target.node || `Network ${index + 1}`,
      status: finished ? finished.status : ('waiting' as const),
    }
  })
}

export function houdiniRunStateFrom(
  result: HoudiniResult | null,
  houdiniRunning: boolean,
  /** The console log's contents, when the caller could read them. Only ever
   *  consulted for a DEAD run — a live or finished one explains itself. */
  consoleText = '',
): HoudiniRunState {
  const dead = (): HoudiniRunState => {
    const reason = houdiniDeathReason(consoleText)
    return reason ? { state: 'dead', reason } : { state: 'dead' }
  }
  if (!result) return houdiniRunning ? { state: 'starting' } : dead()
  if (result.state === 'running') {
    if (!houdiniRunning) return dead()
    return {
      state: 'running',
      done: result.done,
      total: result.total,
      // One entry per network the run will touch, named before it starts and
      // marked as it finishes. The box title is what the USER called this
      // network; the scene is the studio's name for it; the node path always
      // exists. A run from an older 456.py reports no targets, so this falls
      // back to naming only what has finished.
      networks: houdiniNetworks(result),
      // Only a channel with something to say rides along — an empty one would
      // make the UI clear its "last activity" line between nodes for nothing.
      ...(result.activity && result.activity.lines.length > 0
        ? { activity: result.activity }
        : {}),
    }
  }
  const counts = { ok: 0, skipped: 0, failed: 0 }
  for (const node of result.nodes) counts[node.status] += 1
  return {
    state: 'finished',
    ...counts,
    summary: houdiniResultSummary(result),
    cancelled: result.cancelled,
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
  // The console log ({@link HOUDINI_CONSOLE_FILE}) is deliberately NOT in this
  // list — see its doc: it survives as the last run's diagnosis channel.
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
