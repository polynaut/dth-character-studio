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
  // the export panel, which passes the character's stored paths verbatim. Any
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
 * Did this scene's Daz export actually LAND — judged from the export folder's
 * own state, because every report channel above it can lie. The Runner marks a
 * job row `done` when the script it started returns, success or not; the ROM
 * run log is stamped by the ROM leg BEFORE the export block; and a script that
 * dies at the C++ level (measured 2026-08-21: the DTH Exporter crashed Daz's
 * script engine 2 s into the Alembic export — `dzscript.cpp(1192): Unhandled
 * error`) runs neither its own failure alert nor its backup restore. What that
 * death cannot fake is the disk: the `.dthprev` backups the export sweep took
 * are still sitting there (only the script's finish step removes them), and
 * the `.dth` the exporter opens first is 0 bytes. Feeding that folder to the
 * Houdini leg produced a 17-second "success" over garbage — this verdict is
 * what stops the cascade.
 *
 * Pure — the caller lists the folder and stats the `.dth`; this only judges.
 * Returns '' when the set looks landed, else the reason it did not.
 */
export interface ExportSetVerdict {
  /** Why the set did NOT land ('' = it did). Fails the scene. */
  dead: string
  /** Something is off but the export itself landed — reported, never fatal. */
  warning: string
}

export function exportSetDeath(
  /** File names in the scene's export folder (names only, no paths). */
  entryNames: ReadonlyArray<string>,
  /** The set's `.dth` file name, e.g. `LaraCroft_G81.dth` — its stem scopes
   *  which files belong to this set, same prefix rule the generated script's
   *  own sweep uses. */
  dthFileName: string,
  /** The `.dth` file's size in bytes, or null when it does not exist. Pass
   *  undefined to skip the `.dth` checks entirely — the hair-only mode never
   *  touches it, so its absence proves nothing there. */
  dthSize?: number | null,
): ExportSetVerdict {
  const base = dthFileName.replace(/\.dth$/i, '')
  const lower = base.toLowerCase()
  const leftover = entryNames.find(
    (name) => name.toLowerCase().startsWith(lower) && name.toLowerCase().endsWith('.dthprev'),
  )
  // A leftover backup is a WARNING, never a verdict. It says the export
  // script's finish step did not complete — which is not the same claim as
  // "this export did not land", and reading it as one cost a healthy scene its
  // Houdini leg (measured 2026-08-21: a successful export whose backups the
  // runtime failed to purge was reported as a failure, while its `.abc` and
  // `.dth` sat there full-size and correct). The runtime bug behind that is
  // fixed in v100, but every older generated script in the field still leaves
  // them, so the rule has to be honest on its own. The `.dth` is the witness
  // that actually answers the question.
  const warning = leftover
    ? `the export folder still holds backup files from an earlier run (${leftover}) — harmless, but a sign the export script did not finish cleanly`
    : ''
  if (dthSize === undefined) return { dead: '', warning }
  if (dthSize === null) {
    return { dead: `no ${dthFileName} was written — the export never produced its manifest`, warning }
  }
  if (dthSize === 0) {
    return { dead: `${dthFileName} is empty (0 bytes) — the exporter was cut off before writing it`, warning }
  }
  return { dead: '', warning }
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
      /** Every network with its FINAL status — the running state's list, held
       *  through the finish. The counts above can say "1 ok, 1 failed" but not
       *  WHICH; the task cards need which, and they need it precisely at the
       *  moment the running state (their previous source) disappears. */
      networks: Array<{ label: string; status: 'ok' | 'skipped' | 'failed' | 'waiting' }>
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
/** The run's OWN narration — the step lines 456.py and the HDA print. Only
 *  these count as "the run was demonstrably still working": generic cook
 *  chatter says a node was busy, these say the batch itself moved forward. */
const DEATH_STEP_LINE = /^(?:DazToHue|DTH Character Studio): /

/** How much of a quoted line a death reason may carry — it ends up in a toast,
 *  and a step line naming an absolute `.hiplc` path is as long as any error. */
const DEATH_LINE_CAP = 160
const clampLine = (line: string): string =>
  line.length > DEATH_LINE_CAP ? `${line.slice(0, DEATH_LINE_CAP - 1)}…` : line

/** The exit-code clause appended to a death reason when the spawn recorded
 *  one. Negative codes on Windows are NTSTATUS values (a crash, not a return)
 *  — the hex spelling is the one crash databases and search engines know. */
function exitCodeClause(exitCode: number | null | undefined): string {
  if (exitCode === null || exitCode === undefined || exitCode === 0) return ''
  const hex = exitCode < 0 ? ` / 0x${(exitCode >>> 0).toString(16).toUpperCase()}` : ''
  return ` (hython exit code ${exitCode}${hex})`
}

export function houdiniDeathReason(consoleText: string, exitCode: number | null = null): string {
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
  const lastIndexMatching = (pattern: RegExp): number => {
    for (let i = tail.length - 1; i >= 0; i--) {
      if (pattern.test(tail[i] ?? '')) return i
    }
    return -1
  }
  const lastError = lastIndexMatching(DEATH_ERROR_LINE)
  const lastStep = lastIndexMatching(DEATH_STEP_LINE)
  // A run that kept narrating AFTER its newest error-shaped line did not die
  // of that line — it survived it. Naming the last step it reached is the
  // honest answer, where quoting the stale "error" was a confident wrong one
  // (measured 2026-08-21: hython died silently mid "exporting animation
  // curves" and the toast blamed a benign HDA load warning from minutes
  // earlier). Same rule when there is no error-shaped line at all: the step
  // is the run's own last word, not cook chatter dressed up as a diagnosis.
  if (lastStep >= 0 && lastStep > lastError) {
    const step = clampLine(tail[lastStep] ?? '')
    return `Houdini exited during "${step}"${exitCodeClause(exitCode)}`
  }
  // The newest error-shaped line in the tail; failing that, the last line of a
  // log too short to have said anything else.
  const spoken =
    (lastError >= 0 ? tail[lastError] : undefined) ??
    (lines.length <= DEATH_SHORT_LOG ? (lines[lines.length - 1] ?? '') : '')
  if (!spoken) {
    // Nothing quotable at all — the exit code is then the only witness left.
    const clause = exitCodeClause(exitCode)
    return clause ? `Houdini exited${clause}` : ''
  }
  return `${clampLine(spoken)}${exitCodeClause(exitCode)}`
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
 * A finished result that claims NOTHING went wrong — no failed node, no
 * run-level error, a clean `done`. This is the shape of the false success,
 * and the ONE place {@link houdiniRunStateFrom} consults the console log for:
 * a result already reporting a failure explains itself.
 */
function houdiniResultClaimsClean(result: HoudiniResult): boolean {
  return (
    result.state === 'done' &&
    !result.error &&
    result.nodes.every((node) => node.status !== 'failed')
  )
}

/**
 * Whether this poll should spend a file read on the console log before calling
 * {@link houdiniRunStateFrom} — the api layer's read guard, kept here for the
 * same reason as {@link houdiniRunLooksDead}: two copies of the condition
 * would drift, and the failure would be silent. Two cases earn the read: a
 * DEAD run (the log is its only witness), and a finished run claiming to be
 * clean (the log is what catches the false success — a backstop that is never
 * fed its channel is no backstop, which is exactly how the first version of
 * this fix shipped dead). A live run, or a finished one already reporting a
 * failure, explains itself — no read on the 2.5 s poll.
 */
export function houdiniConsoleWorthReading(
  result: HoudiniResult | null,
  houdiniRunning: boolean,
): boolean {
  if (houdiniRunLooksDead(result, houdiniRunning)) return true
  return result !== null && houdiniResultClaimsClean(result)
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

/**
 * Houdini's own headings for an exception it CAUGHT and printed, plus the
 * Python traceback banner — the twin of `SWALLOWED_FAILURE_MARKERS` in
 * `456.py`, kept here because this side reads a channel that one cannot.
 */
const CONSOLE_FAILURE_MARKERS =
  /error running callback|error running event handler|traceback \(most recent call last\)/i

/**
 * The first line of the console log that says something blew up behind
 * Houdini's callback wrapper — '' when it reads clean.
 *
 * This is the BACKSTOP for the false-success bug. 456.py catches the same
 * thing from the tee'd stdout/stderr and marks the node failed, but the tee is
 * an in-process capture and the console log is the process's real stdout+stderr
 * (see HOUDINI_CONSOLE_FILE): anything Houdini prints from C++, or before the
 * capture is entered, reaches only this file. Measured 2026-08-19 — a run
 * whose `.hip` could not load its PoseAsset CSV logged two
 * "Error running event handler" tracebacks at LOAD time, then exported nothing
 * and reported "2 exported".
 */
export function houdiniConsoleFailure(consoleText: string): string {
  for (const line of consoleText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed && CONSOLE_FAILURE_MARKERS.test(trimmed)) {
      return trimmed.length > 160 ? `${trimmed.slice(0, 159)}…` : trimmed
    }
  }
  return ''
}

export function houdiniRunStateFrom(
  result: HoudiniResult | null,
  houdiniRunning: boolean,
  /** The console log's contents, when the caller could read them. Consulted for
   *  a DEAD run — and, since the false-success bug, for a FINISHED one that
   *  claims nothing went wrong: "a finished run explains itself" was the
   *  assumption that let an export of nothing be reported as an export. */
  consoleText = '',
  /** The dead hython's exit code, when the spawn recorded one (null = alive,
   *  never tracked, or killed without a code). Only the dead branch reads it. */
  exitCode: number | null = null,
): HoudiniRunState {
  const dead = (): HoudiniRunState => {
    const reason = houdiniDeathReason(consoleText, exitCode)
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
  // A run that reports NO failure of any kind — node, run-level state or
  // error — but whose console carries a traceback is the shape of the false
  // success: say so rather than let the toast's green checkmark stand alone.
  // A result already reporting a failure explains itself, and this would just
  // repeat it. Same predicate the api layer's read guard uses, so the one
  // case that needs the console is exactly the one that got the file read.
  const swallowed = houdiniResultClaimsClean(result) ? houdiniConsoleFailure(consoleText) : ''
  return {
    state: 'finished',
    ...counts,
    // Same list the running state carried, now with every status final —
    // 456.py resolves every node before writing `done` (unreached ones are
    // `skipped` on an interrupt), so nothing here should still be `waiting`.
    networks: houdiniNetworks(result),
    summary: houdiniResultSummary(result),
    cancelled: result.cancelled,
    // A 'done' run with a failed NODE carries its cause on the node, not the
    // top level — surface it, or the toast says "1 failed" and nothing else
    // (the result file holding the cause is deleted as this run ends).
    error:
      result.state === 'failed'
        ? result.error || 'the run failed in Houdini'
        : result.error || result.nodes.find((node) => node.status === 'failed')?.error || '',
    problems: [
      ...result.nodes.flatMap((node) =>
        node.problems.map((problem) => `${node.scene || node.node}: ${problem}`),
      ),
      ...(swallowed
        ? [
            `Houdini logged an error this run did not attribute to a node — check the console log: ${swallowed}`,
          ]
        : []),
    ],
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
