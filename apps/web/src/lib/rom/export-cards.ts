import { EXPORT_MODE_LABELS } from './execute-jobs.ts'

import type { ExportTask } from '#/components/character/export-pipeline-panel.tsx'
import type { ExportMode } from './execute-jobs.ts'
import type { HoudiniRunState } from './houdini-jobs.ts'

/**
 * The run's task list, built leg by leg — one row per JOB, which is the whole
 * rule this module exists to keep:
 *
 * - one row per selected **Daz scene**, saying what the run does to it;
 * - one row per **DazToHue network**, not per `.hip` (a project can hold
 *   several, and the meters always counted them);
 * - one row per **export set going into one Unreal project** — two characters
 *   re-imported into the same project are two imports, so they are two rows.
 *
 * Pure, so the "what does the column say at this moment" question is answered
 * by tests rather than by a run in three applications.
 */

/** One selected Daz scene of the run. */
export interface DazSceneTarget {
  path: string
  label: string
}

/**
 * The Daz leg's rows: the batch's scenes in job order, each naming the mode the
 * run was started in ("ROM + Export", "Export only", …).
 *
 * `mode` is optional because one caller genuinely cannot know it: a run this
 * window merely ADOPTED for display was started elsewhere, and the job file it
 * reads carries rows, not the panel's choice. Those rows then say what is
 * being worked without claiming what it will do.
 */
export function dazTaskCards(
  scenes: ReadonlyArray<DazSceneTarget>,
  mode: ExportMode | undefined,
  /** Rows the Runner has already worked (done + failed). */
  processed: number,
  /** The whole Daz batch is over — every row is done, whatever the counter
   *  last said (the job file is deleted at the end, taking the count with it). */
  finished: boolean,
  /** A Runner is working the batch right now — only then can a row be active. */
  running: boolean,
): Array<ExportTask> {
  const detail = mode ? EXPORT_MODE_LABELS[mode] : undefined
  return scenes.map((scene, index) => ({
    id: `daz:${scene.path}`,
    label: scene.label,
    ...(detail ? { detail } : {}),
    kind: 'daz' as const,
    status:
      finished || processed > index
        ? ('done' as const)
        : processed === index && running
          ? ('active' as const)
          : ('waiting' as const),
  }))
}

/**
 * The Houdini half: one row per DazToHue NETWORK.
 *
 * Where the names come from, in the order they become available:
 *
 * 1. **The run's own targets** (`live.networks`), once 456.py has collected
 *    them: the title of the network box around each node, which is what the
 *    USER called it. Authoritative — it is the list actually being exported.
 * 2. **The stored scan** (`sets`, each export node's `character_name`) before
 *    that. It is what the project WRITES, so it can name the rows while hython
 *    is still opening the file — the stretch this was reported in.
 * 3. Neither: one row for the project, as it always was.
 *
 * The scan's list can disagree with the run's — a network whose scene was not
 * selected is not exported — so the run replaces it the moment it speaks. That
 * is a row disappearing mid-run, which is honest: it says "that network is not
 * in this run" instead of leaving one that never starts.
 */
export function houdiniTaskCards(
  project: { path: string; label: string; networks: Array<string>; sets?: Array<string> },
  index: number,
  live: Extract<HoudiniRunState, { state: 'running' }> | null,
  isActive: boolean,
  finishedProjects: number,
): Array<ExportTask> {
  const single = (): Array<ExportTask> => [
    {
      id: `hou:${project.path}`,
      label: project.label,
      detail: 'DazToHue export',
      kind: 'houdini',
      status: index < finishedProjects ? 'done' : isActive ? 'active' : 'waiting',
    },
  ]
  if (live && live.total > 1) {
    const running = live.networks.filter((one) => one.status !== 'waiting').length
    return Array.from({ length: live.total }, (_, n) => {
      const network = live.networks[n]
      const done = network !== undefined && network.status !== 'waiting'
      return {
        id: `hou:${project.path}#${n}`,
        label: network?.label || (n === running ? live.activity?.scene || '' : '') || `Network ${n + 1}`,
        detail: 'DazToHue network',
        context: project.label,
        kind: 'houdini',
        // 456.py answers per network — and a network that FAILED is finished,
        // not fine. Ticking it off beside the ones that worked was the report's
        // only trace of the failure disappearing into a green list; the run's
        // toast still names it, but the row the user is watching said nothing.
        // `skipped` stays `done`: it finished with nothing to do, which is not
        // a failure.
        status: done
          ? network.status === 'failed'
            ? 'failed'
            : 'done'
          : n === running
            ? 'active'
            : 'waiting',
      }
    })
  }
  const sets = project.sets ?? []
  if (live || sets.length < 2) return single()
  // Not running yet, and the scan knows what this project writes: name the rows
  // now rather than showing one for two networks.
  return sets.map((name, n) => ({
    id: `hou:${project.path}#${n}`,
    label: name,
    detail: 'DazToHue network',
    context: project.label,
    kind: 'houdini',
    status: index < finishedProjects ? 'done' : 'waiting',
  }))
}

/** One Unreal project of the run, and what it is getting. */
export interface UnrealTarget {
  path: string
  label: string
  /** The export sets handed to THIS project — one import job each. Empty means
   *  the names are not known here (a run restored into a window that never saw
   *  the dialog), not "nothing is sent". */
  sets: Array<UnrealTargetSet>
}

export interface UnrealTargetSet {
  /** The export set's name — the HDA's `character_name`, which is what the
   *  asset folder in Unreal is called. The "final character", in other words. */
  name: string
  /** The studio found this set's assets already in that project, so the import
   *  lands on top of them — a re-import. `undefined` = not probed (a restored
   *  run), which must not be reported either way. */
  existing?: boolean
}

/**
 * The Unreal leg's rows: **one per export set per project**, because that is
 * one import job each. One project taking two characters shows two rows, both
 * naming that project.
 *
 * The `detail` is the honest three-way answer to "what will this do": a
 * re-import when the studio located those assets in that project, a first
 * import when it looked and found none, and a plain "Import" when nobody
 * looked (a run restored after a reload carries the set names, not the probe).
 */
export function unrealTaskCards(
  target: UnrealTarget,
  status: ExportTask['status'],
): Array<ExportTask> {
  if (target.sets.length === 0) {
    return [
      {
        id: `ue:${target.path}`,
        label: target.label,
        detail: 'Import',
        kind: 'unreal',
        status,
      },
    ]
  }
  return target.sets.map((set) => ({
    id: `ue:${target.path}#${set.name}`,
    label: set.name,
    detail: set.existing === true ? 'Re-import' : set.existing === false ? 'First import' : 'Import',
    context: target.label,
    kind: 'unreal',
    status,
  }))
}

/**
 * The one meter's percentage: how much of the whole run is behind us.
 *
 * Rows are counted as equal, which they are not — a ROM build is tens of
 * minutes and an Unreal import is seconds — but nothing here can measure them
 * against each other, and a bar that moves in equal steps is at least
 * predictable. `activeFraction` (0–1) is the row being worked, from whatever
 * that leg can actually report: the Runner's own per-scene percent, the HDA's
 * phase lines, or a flat guess for a leg with no signal at all.
 *
 * With no rows to count (a run adopted before its job file is readable) the
 * active fraction IS the answer — there is nothing else to say.
 */
export function runPercent(
  tasks: ReadonlyArray<Pick<ExportTask, 'status'>>,
  activeFraction: number,
): number {
  const fraction = Math.min(1, Math.max(0, activeFraction))
  if (tasks.length === 0) return Math.round(fraction * 100)
  // A FAILED row is behind us too. The bar measures how much of the list is
  // over, not how much of it worked — counting only `done` would leave a run
  // with one bad network stuck short of 100% forever, reading as still running
  // when nothing is. The failure is said by the row and the report, which is
  // where it belongs; a bar cannot carry it.
  const done = tasks.filter((task) => task.status === 'done' || task.status === 'failed').length
  const active = tasks.some((task) => task.status === 'active') ? fraction : 0
  return Math.min(100, Math.round(((done + active) / tasks.length) * 100))
}
