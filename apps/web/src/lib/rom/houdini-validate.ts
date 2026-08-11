import { DTH_FPS, formatFps, sameFolder, sameFps } from './houdini-defaults.ts'

import type { MaterialScanProject } from './api/native-types.ts'

/**
 * Is this Houdini project actually wired up?
 *
 * Everything here is read off a scan the studio already has (`job`, `fps`,
 * `refs`, `prefill` on {@link MaterialScanProject}) — no extra hython trip. The point is
 * the card badge: a project that will fail when you open it should say so on the
 * character page, not the first time an import comes up empty in Houdini.
 *
 * It is also what makes COPYING a project safe to offer. A copied `.hip` carries
 * the source's `$JOB` and its absolute file references, so it is broken on
 * arrival in exactly the ways checked here — and every one of them has a repair
 * in the Utils drawer.
 *
 * **What it does NOT check**, so nobody reads a clean badge as more than it is:
 * material texture paths. `refs.broken` is deliberately scoped to the DazToHue
 * IMPORT parms, because "the file is missing" is not a usable definition of
 * broken in general — a healthy project reports four of Houdini's own scratch
 * files that simply don't exist until used. Texture breakage needs its own
 * signal from the Python side before it can be reported honestly.
 */

/** One thing wrong with a project. `code` is for tests and styling, `label` is
 *  what the card's tooltip shows. */
export interface HoudiniProjectProblem {
  code:
    | 'unreadable'
    | 'job-unknown'
    | 'job-differs'
    | 'fps-differs'
    | 'broken-refs'
    | 'hip-relative'
    | 'blank-parms'
  label: string
}

export interface HoudiniProjectHealth {
  ok: boolean
  problems: Array<HoudiniProjectProblem>
  /** One line for the card tooltip — every problem, joined. */
  summary: string
}

/** A healthy project, and the answer for one that has not been scanned yet:
 *  absence of data is not a fault, and a badge that appears while the background
 *  scan is still running would cry wolf on every page load. */
export const HEALTHY: HoudiniProjectHealth = { ok: true, problems: [], summary: '' }

export function validateHoudiniProject(
  project: MaterialScanProject | null | undefined,
  /** The character folder — what `$JOB` has to be (v0.64). */
  charFolder: string,
): HoudiniProjectHealth {
  if (!project) return HEALTHY
  const problems: Array<HoudiniProjectProblem> = []

  if (!project.ok) {
    problems.push({
      code: 'unreadable',
      label: project.error.trim() || 'The project could not be read.',
    })
    // Nothing below is meaningful for a project that never opened — reporting
    // "$JOB is empty" for a file hython could not read would blame the wrong
    // thing.
    return finish(problems)
  }

  if (project.job.trim() === '') {
    problems.push({ code: 'job-unknown', label: 'The project reports no $JOB.' })
  } else if (!sameFolder(project.job, charFolder)) {
    // Load-bearing, not cosmetic: paths collapse against whatever $JOB the scene
    // carries, so a wrong one makes every picked export store absolutely — and
    // it is what the Utils drawer gates its repath on.
    problems.push({
      code: 'job-differs',
      label: `$JOB points at ${project.job} instead of the character folder.`,
    })
  }

  // The timeline. Only when the scan actually READ one: `0` is an older stored
  // scan or a project that never opened, and badging that would be inventing a
  // fault. DazToHue's own import node sets this when it loads the files (per
  // mrpdean), so a wrong value here is a project where that has not happened
  // yet — including one the studio generated headlessly, where nothing loads a
  // file at all.
  if (project.fps > 0 && !sameFps(project.fps)) {
    problems.push({
      code: 'fps-differs',
      label: `The timeline runs at ${formatFps(project.fps)} fps instead of ${DTH_FPS} — the ROM is one pose per frame at ${DTH_FPS}.`,
    })
  }

  if (project.refs.broken.length > 0) {
    const n = project.refs.broken.length
    problems.push({
      code: 'broken-refs',
      label: `${n} import path${n === 1 ? ' does' : 's do'} not resolve: ${project.refs.broken.join(', ')}.`,
    })
  }

  if (project.refs.hipRelative.length > 0) {
    // NOT broken — these resolve today. They are flagged because `$HIP` encodes
    // the scene's DEPTH (move the .hip one folder down and every one of them
    // points elsewhere) and because Houdini's own picker writes `$JOB/…`, so a
    // project mixes two spellings of the same folder. Everything the studio
    // generates has been `$JOB`-anchored since runtime v63; Make paths portable
    // re-anchors the rest.
    const n = project.refs.hipRelative.length
    problems.push({
      code: 'hip-relative',
      label:
        `${n} path${n === 1 ? '' : 's'} still anchored on $HIP instead of $JOB — ` +
        `Utils → Make paths portable rewrites ${n === 1 ? 'it' : 'them'}.`,
    })
  }

  if (project.prefill.fillable.length > 0) {
    // Blank, not wrong — the studio knows the value and can fill it. Worth a
    // badge because an unset import/export path is a project that does nothing
    // when you press the button.
    problems.push({
      code: 'blank-parms',
      label: `Not filled in yet: ${project.prefill.fillable.join(', ')}.`,
    })
  }

  return finish(problems)
}

function finish(problems: Array<HoudiniProjectProblem>): HoudiniProjectHealth {
  return {
    ok: problems.length === 0,
    problems,
    summary: problems.map((p) => p.label).join(' '),
  }
}
