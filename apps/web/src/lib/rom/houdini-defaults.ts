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
 * | `<char>` (the character folder) | `$JOB/daz3d/dth-exports/…` |
 *
 * A path above `$HIP` collapses only when it sits under `$JOB`, and the old
 * value sits BELOW the exports, so it could never help. `$HIP` still wins for
 * paths inside the houdini folder, so repointing `$JOB` disturbs nothing.
 *
 * The rows are computed here rather than in the panel so the decision is
 * testable, and so the "does this project differ?" comparison is the same one
 * `op_defaults` (`houdini-runtime/material_utils.py`) makes before it writes.
 */

/** A folder-valued setting the studio can check, and sometimes repair. */
export interface DefaultsRow {
  key: 'job' | 'hip'
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
  matches: boolean
  /**
   * Whether the studio can write this.
   *
   * `$HIP` is DERIVED from where the `.hip` sits, so "repairing" it would mean
   * moving the user's scene file — which the studio has no safe way to do (the
   * project may be open, referenced, or under version control). That row
   * reports and stops there, which is what #701 asks for.
   */
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
 * one a repair writes. `houdiniDir` is where the studio puts a generated
 * scene, which is all `$HIP` is ever compared against.
 */
export function defaultsRowsFor(
  scanned: { job: string; hipDir: string },
  charFolder: string,
  houdiniDir: string,
): Array<DefaultsRow> {
  const row = (
    key: DefaultsRow['key'],
    label: string,
    current: string,
    expected: string,
    actionable: boolean,
    reason: string,
  ): DefaultsRow => {
    const matches = sameFolder(current, expected)
    return {
      key,
      label,
      current,
      expected,
      status: current.trim() === '' ? 'unknown' : matches ? 'matches' : 'differs',
      matches,
      actionable,
      reason,
    }
  }
  return [
    row('job', 'Project folder ($JOB)', scanned.job, charFolder, true, ''),
    row(
      'hip',
      'Scene location ($HIP)',
      scanned.hipDir,
      houdiniDir,
      false,
      '$HIP is wherever the scene file sits — moving it is your call, not something the studio can do safely.',
    ),
  ]
}

/** What the scan reports about a project's stored file references. */
export interface ScannedRefs {
  collapsible: number
  foreign: number
  broken: ReadonlyArray<string>
}

/** A project as the Defaults tab sees it. */
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
 */
export function planRepath(
  projects: ReadonlyArray<ScannedProject>,
  charFolder: string,
): {
  /** Projects a run would be sent — readable, `$JOB` correct, something to do. */
  targets: Array<string>
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
  const targets = eligible
    .filter((project) => project.refs.collapsible > 0 || project.refs.broken.length > 0)
    .map((project) => project.hipPath)
  const sum = (pick: (refs: ScannedRefs) => number) =>
    eligible.reduce((total, project) => total + pick(project.refs), 0)

  return {
    targets,
    collapsible: sum((refs) => refs.collapsible),
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
 * The projects a repair would actually write — those whose `$JOB` differs.
 *
 * A project the scan could not read, or that reported no `$JOB` at all, is
 * never queued: its value is UNKNOWN, not wrong, and writing one would be a
 * guess over something nobody managed to look at.
 */
export function projectsNeedingRepair(
  projects: ReadonlyArray<{ hipPath: string; ok: boolean; job: string }>,
  charFolder: string,
): Array<string> {
  return projects
    .filter((p) => p.ok && p.job.trim() !== '' && !sameFolder(p.job, charFolder))
    .map((project) => project.hipPath)
}
