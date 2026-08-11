/**
 * The per-project Houdini settings the studio knows the right value for.
 *
 * `$JOB` is scene state — `hou.putenv('JOB', …)` saved with the `.hip` — so a
 * project keeps whatever it was created with, forever. That is the whole reason
 * this exists: v0.64 bakes `$JOB` to the CHARACTER folder for newly generated
 * projects, but every project that already exists still carries
 * `<char>/houdini/houdini-project`.
 *
 * Why it matters (measured with `hou.text.collapseCommonVars`, the call
 * Houdini's own file picker uses to turn a chosen path back into a variable):
 *
 * | `$JOB` | a picked export collapses to |
 * | --- | --- |
 * | `<char>/houdini/houdini-project` | an ABSOLUTE path |
 * | `<char>` (the character folder) | `$JOB/houdini/daz-export/…` |
 *
 * A path above `$HIP` collapses only when it sits under `$JOB`, and the old
 * value sits BELOW the exports, so it could never help. `$HIP` still wins for
 * paths inside the houdini folder, so repointing `$JOB` disturbs nothing.
 *
 * The scene's **FPS** is the second value of this kind, and it is scene state in
 * exactly the same way. `$HIP` is not: it is derived from the scene's own
 * location and was never actionable, so reporting it was noise (dropped in
 * v0.68).
 *
 * The rows are computed here rather than in the panel so the decision is
 * testable, and so the "does this project differ?" comparison is the same one
 * `op_defaults` (`houdini-runtime/material_utils.py`) makes before it writes.
 */

/**
 * The timeline the DazToHue pipeline runs at.
 *
 * A ROM is one pose per FRAME, and the Daz side emits its keys in SECONDS —
 * `apps/desktop/src/poses.rs` turns a `.duf`'s key times back into frames with
 * the same 30, and the PoseAsset CSV names frame numbers. So a Houdini scene on
 * Houdini's own default (24) lands every imported ROM frame somewhere between
 * two of its own, and the CSV's frame numbers stop naming the poses they were
 * generated for.
 *
 * DazToHue itself sets this: per mrpdean, *"the DTH import node sets the FPS for
 * you when you load the files"*. That is the load-bearing detail for the studio —
 * it means the value is only ever wrong where that trigger has not run, which is
 * precisely a project the studio generated HEADLESSLY (hython builds the network
 * and sets the parms directly; nothing loads a file), and a project the user
 * built before importing anything. Both are covered here: generation sets it
 * (`create_houdini_project`), the scan reads it back, and this checks it.
 */
export const DTH_FPS = 30

/** Whether a scanned FPS is the pipeline's. Tolerant because Houdini's FPS is a
 *  float (23.976, 29.97 are real values) and an exact `===` on a value that made
 *  the JSON round trip is the wrong kind of strict. */
export function sameFps(value: number, expected: number = DTH_FPS): boolean {
  return Number.isFinite(value) && Math.abs(value - expected) < 0.001
}

/** How a scanned FPS reads on screen — `30` rather than `30.0`, but `29.97`
 *  intact. */
export function formatFps(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : ''
}

/** A per-project setting the studio can check, and sometimes repair. */
export interface DefaultsRow {
  key: 'job' | 'fps' | 'csv'
  label: string
  /** What the scene carries today ('' when the scan could not read it). */
  current: string
  /** What the studio expects. */
  expected: string
  /**
   * `unknown` is NOT `differs`. An unreadable value is a scan problem, and
   * offering to "repair" it would be writing a guess over something nobody
   * looked at — so the row says so and the action skips it.
   */
  status: 'matches' | 'differs' | 'unknown'
  /** What the status reads as on screen. Spelled per row because "unknown"
   *  means different things: nobody could READ the $JOB, versus a DazToHue
   *  release that simply has no such parameter. */
  verdict: string
  matches: boolean
  /** Whether the studio can write this. */
  actionable: boolean
  /** Why this row cannot be actioned, for the disabled state. */
  reason: string
}

/** Windows path compare: separators and case are not differences. */
export function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) =>
    p
      .trim()
      .replace(/\\/g, '/')
      // Not /\/+$/ — that shape is a polynomial-ReDoS CodeQL alert. Trim one
      // separator at a time instead (see lib/path-trim.ts for the same rule).
      .replace(/[^/]\/$/, (m) => m[0] ?? '')
      .toLowerCase()
  const left = norm(a)
  const right = norm(b)
  return left !== '' && left === right
}

/**
 * The Defaults rows for one scanned project.
 *
 * `charFolder` is the character's own folder — the value v0.64 bakes and the
 * one a repair writes.
 *
 * `$HIP` used to be reported here beside `$JOB`. It was dropped in v0.68: it is
 * DERIVED from where the `.hip` sits and can never be anything else, so the row
 * could only ever restate the scene's own location — a check that cannot fail,
 * next to an action that could never run.
 */
export function defaultsRowsFor(
  scanned: {
    job: string
    /** The scene's FPS. `0` = the scan has no value (an older stored scan, or a
     *  project it could not open) and the row reads `unknown` — never
     *  `differs`, which would offer to write over something nobody read. */
    fps?: number
    prefill?: { fillable: ReadonlyArray<string>; missing: ReadonlyArray<string> }
  },
  charFolder: string,
): Array<DefaultsRow> {
  const matches = sameFolder(scanned.job, charFolder)
  const jobStatus = scanned.job.trim() === '' ? 'unknown' : matches ? 'matches' : 'differs'
  const rows: Array<DefaultsRow> = [
    {
      key: 'job',
      label: 'Project folder ($JOB)',
      current: scanned.job,
      expected: charFolder,
      status: jobStatus,
      verdict: jobStatus === 'unknown' ? 'could not be read' : jobStatus,
      matches,
      actionable: true,
      reason: '',
    },
  ]
  // The timeline. A scan that has no number for it (0) says so rather than
  // guessing — the same rule as an unreadable `$JOB`.
  const fps = scanned.fps
  if (fps !== undefined) {
    const fpsKnown = Number.isFinite(fps) && fps > 0
    const fpsMatches = sameFps(fps)
    const fpsStatus = !fpsKnown ? 'unknown' : fpsMatches ? 'matches' : 'differs'
    rows.push({
      key: 'fps',
      label: 'Timeline (FPS)',
      current: fpsKnown ? formatFps(fps) : '',
      expected: formatFps(DTH_FPS),
      status: fpsStatus,
      verdict: fpsStatus === 'unknown' ? 'could not be read' : fpsStatus,
      matches: fpsMatches,
      // Repaired by the same run as `$JOB` — one file open, one backup.
      actionable: true,
      reason: '',
    })
  }
  // The PoseAsset CSV path — reported only once the scan has an opinion about
  // it. Three states, and the middle one is why this row exists at all: the
  // parameter arrived in a later DazToHue, so "not filled in" and "your version
  // hasn't got it" are different answers and only one of them is actionable.
  const prefill = scanned.prefill
  if (prefill) {
    const missing = prefill.missing.includes(CSV_PARM)
    const fillable = prefill.fillable.includes(CSV_PARM)
    rows.push({
      key: 'csv',
      label: 'PoseAsset CSV path',
      current: missing ? '' : fillable ? '(not set)' : '(set)',
      expected: 'the character’s generated CSV',
      status: missing ? 'unknown' : fillable ? 'differs' : 'matches',
      verdict: missing
        ? 'your DazToHue has no such parameter'
        : fillable
          ? 'not filled in'
          : 'filled in',
      matches: !missing && !fillable,
      // Fill network writes it — but only when the parm is actually there.
      actionable: fillable,
      reason: missing
        ? 'Update DazToHue to the release with the CSV-path-driven PoseAsset node.'
        : '',
    })
  }
  return rows
}

/** The DazToHue PoseAsset node's CSV-path parameter (absent before the
 *  CSV-path-driven release — `PREFILL_PARMS` in material_utils.py). */
export const CSV_PARM = 'pose_asset_csv_file_path'

/** What the scan reports about a project's stored file references. */
export interface ScannedRefs {
  collapsible: number
  foreign: number
  broken: ReadonlyArray<string>
  /** Pre-v63 `$HIP/../…` paths — they RESOLVE, but leave the houdini folder,
   *  so the repath re-anchors them on `$JOB`. Counted separately by the scan
   *  (`_project_ref_info` puts a path in one bucket or the other), and folded
   *  back into the plan's `collapsible` because the run treats them the same. */
  hipRelative: ReadonlyArray<string>
}

/** A project as the General tab sees it. */
export interface ScannedProject {
  hipPath: string
  ok: boolean
  job: string
  refs: ScannedRefs
}

/**
 * What a repath would do across the selected projects, and whether it may run.
 *
 * **Gated on `$JOB` being correct**, and that is not a formality: a path is
 * collapsed against whatever `$JOB` the scene currently carries, so repathing a
 * project whose `$JOB` is still the pre-v0.64 `houdini/houdini-project` would
 * store every export path relative to the wrong folder. Measured on a real
 * project: with the stale `$JOB` the scan reports 0 collapsible references and
 * 2 foreign ones; after the `$JOB` repair the same file reports 2 collapsible
 * and 0 foreign. Same file, opposite answer — so the order is load-bearing, and
 * the row says so rather than letting the user find out.
 *
 * The Python refuses a mismatch too; this is what stops the user reaching it.
 *
 * **Everything the run can fix must be counted here**, because this is also the
 * gate: the button is disabled on an empty `targets`. Two separate bugs came
 * from counting less than the run does — a `$HIP/../` project (flagged by the
 * card, nothing else to do) and a project whose export root MOVED (every import
 * broken, nothing absolute left) both reported "nothing to do" while their own
 * badges told the user to press the button.
 */
export function planRepath(
  projects: ReadonlyArray<ScannedProject>,
  charFolder: string,
): {
  /** Projects a run would be sent — readable, `$JOB` correct, something to do. */
  targets: Array<string>
  /** References the run will rewrite so they sit under a root: the absolute ones
   *  it can collapse PLUS the pre-v63 `$HIP/../…` it re-anchors on `$JOB`. One
   *  number because `op_repath` does one thing to both and reports them as one
   *  `collapsed` count — and because leaving the second out is what made the
   *  button refuse the very projects the card's `hip-relative` badge sends here. */
  collapsible: number
  broken: number
  foreign: number
  /** Projects held back because their `$JOB` still differs. */
  blockedByJob: Array<string>
  reason: string
} {
  const readable = projects.filter((project) => project.ok)
  const blockedByJob = readable
    .filter((project) => project.job.trim() !== '' && !sameFolder(project.job, charFolder))
    .map((project) => project.hipPath)
  const eligible = readable.filter(
    (project) => project.job.trim() !== '' && sameFolder(project.job, charFolder),
  )
  // Three kinds of work, and ALL THREE have to be here: a project can need only
  // the `$HIP/../…` re-anchor (its paths resolve and none is absolute), and one
  // whose export folder moved has nothing else either — every import broke, and
  // `refs.broken` is the only trace of it. Miss one and the button greys out
  // while the card's own badge tells the user to press it.
  const work = (refs: ScannedRefs) =>
    refs.collapsible + refs.hipRelative.length + refs.broken.length
  const targets = eligible.filter((project) => work(project.refs) > 0).map((project) => project.hipPath)
  const sum = (pick: (refs: ScannedRefs) => number) =>
    eligible.reduce((total, project) => total + pick(project.refs), 0)

  return {
    targets,
    collapsible: sum((refs) => refs.collapsible + refs.hipRelative.length),
    broken: sum((refs) => refs.broken.length),
    foreign: sum((refs) => refs.foreign),
    blockedByJob,
    reason:
      blockedByJob.length > 0
        ? 'Repair $JOB first — until then these paths would be stored relative to the old project folder.'
        : targets.length === 0
          ? 'Every reference is already relative, and nothing is broken.'
          : '',
  }
}

/**
 * The projects a repair would actually write — those whose `$JOB` or FPS
 * differs.
 *
 * A project the scan could not read, or that reported no `$JOB`/no FPS at all,
 * is never queued for THAT value: it is UNKNOWN, not wrong, and writing one
 * would be a guess over something nobody managed to look at. The two are judged
 * independently, so a project with a correct `$JOB` and a 24 fps timeline is
 * still queued — one run opens the file once and fixes whichever of the two is
 * actually off (`op_defaults` compares each before it writes).
 */
export function projectsNeedingRepair(
  projects: ReadonlyArray<{ hipPath: string; ok: boolean; job: string; fps?: number }>,
  charFolder: string,
): Array<string> {
  return projects
    .filter((p) => {
      if (!p.ok) return false
      const staleJob = p.job.trim() !== '' && !sameFolder(p.job, charFolder)
      const staleFps = p.fps !== undefined && p.fps > 0 && !sameFps(p.fps)
      return staleJob || staleFps
    })
    .map((project) => project.hipPath)
}
