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
 * Material TEXTURE paths are checked too, but by their own scoped signal
 * (`refs.missingTextures`) rather than by `refs.broken` — "the file is missing"
 * is not a usable definition of broken in general, since a healthy project
 * reports four of Houdini's own scratch files that simply don't exist until
 * used. The texture set dodges that by being scoped to the DazToHue material
 * node's baker layer parms, measured at zero false positives on a real project.
 *
 * That one is the exception to the repair rule above, and deliberately so: a
 * missing texture is fixed OUTSIDE the studio (reinstall the product, restore
 * the library), so the badge only reports it. It earns the badge anyway because
 * nothing else in the pipeline does — measured on DazToHue 2.5 / Houdini 22.0,
 * baking with a layer texture pointed at a file that does not exist prints
 * `export finished in 0:00:02` and raises nothing at all.
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
    | 'csv-mismatch'
    | 'hip-relative'
    | 'blank-parms'
    | 'missing-textures'
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

  // The PoseAsset CSV must be the sibling `<name>_pose_asset.csv` of the
  // `.dth` its OWN network imports: the export run always delivers the CSV
  // beside the set it belongs to under the set's base name (csvCopyBlock in
  // @dth/rom's dsa.ts), and the delivered CSV bakes per-set reference paths —
  // so a PoseAsset reading another set's CSV gets that set's frame layout the
  // moment the scenes' ROMs diverge (a per-scene override), and that set's
  // baked paths even while they don't. This is what catches an older project
  // still pointed at the primary scene's CSV after its scene grew overrides.
  // A blank csv is the blank-parms story; an unwired network ('' dth) is
  // unjudgeable; an empty list means "not known" (old stored scan, or a
  // DazToHue without the CSV parm) — never "consistent".
  const csvMismatches = project.poseAssets.filter((pair) => {
    const dth = normalizeScanPath(pair.dth)
    const csv = normalizeScanPath(pair.csv)
    if (dth === '' || csv === '' || !dth.endsWith('.dth')) return false
    return csv !== `${dth.slice(0, -'.dth'.length)}_pose_asset.csv`
  })
  if (csvMismatches.length > 0) {
    const first = csvMismatches[0]
    const expected = `${normalizeScanPath(first.dth).slice(0, -'.dth'.length)}_pose_asset.csv`
    const n = csvMismatches.length
    const [got, want] = contrastNames(first.csv, expected)
    problems.push({
      code: 'csv-mismatch',
      label:
        `${n === 1 ? 'A PoseAsset node reads' : `${n} PoseAsset nodes read`} another export set's CSV ` +
        `(${got} instead of ${want}) — wrong frames the moment the scenes' ROMs differ. ` +
        // Each mismatched node has its OWN sibling target, so a plural label
        // must not command one path for all of them.
        (n === 1
          ? `Point it at ${expected}.`
          : `Each belongs beside its own network's .dth — the first at ${expected}.`),
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

  if (project.refs.missingTextures.length > 0) {
    // Last, and the only problem here with no button to point at: the fix is
    // outside the studio. It is still worth the badge — this is the one failure
    // in the list that the rest of the pipeline reports as SUCCESS, so without
    // it the first sign is a wrong-looking character in Unreal.
    const n = project.refs.missingTextures.length
    problems.push({
      code: 'missing-textures',
      label:
        `${n} baker texture${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} missing ` +
        `(${nameList(project.refs.missingTextures)}) — DazToHue bakes without ` +
        `${n === 1 ? 'it' : 'them'} and still reports success.`,
    })
  }

  return finish(problems)
}

/** The scan's own normalization (material_utils.py `_norm_path` + lowercase),
 *  re-applied defensively: stored entries predate any TS-side guarantees. */
function normalizeScanPath(path: string): string {
  return path.trim().replace(/\\/g, '/').toLowerCase()
}

/** Both paths' file names for the "(got instead of want)" contrast — with the
 *  parent folder prepended when the file names alone are identical: two sets
 *  delivering the same base name, or a project moved from an old export root,
 *  would otherwise read "(x_pose_asset.csv instead of x_pose_asset.csv)". */
function contrastNames(actual: string, expected: string): [string, string] {
  const a = baseName(actual)
  const e = baseName(expected)
  if (a !== e) return [a, e]
  return [tailName(actual), tailName(expected)]
}

/** One path's file name — for the tooltip; the full path is in the label once. */
function baseName(path: string): string {
  const norm = normalizeScanPath(path)
  return norm.slice(norm.lastIndexOf('/') + 1)
}

/** The last two segments of a path — `<set folder>/<file>`. */
function tailName(path: string): string {
  const parts = normalizeScanPath(path).split('/')
  return parts.slice(-2).join('/')
}

/** Basenames, capped — this goes in a tooltip, and a project missing a whole
 *  product can be missing dozens of files. Full paths live in the Utils drawer. */
function nameList(paths: ReadonlyArray<string>, cap = 3): string {
  const names = paths.map((p) => p.slice(p.lastIndexOf('/') + 1))
  const shown = names.slice(0, cap).join(', ')
  return names.length > cap ? `${shown} +${names.length - cap} more` : shown
}

function finish(problems: Array<HoudiniProjectProblem>): HoudiniProjectHealth {
  return {
    ok: problems.length === 0,
    problems,
    summary: problems.map((p) => p.label).join(' '),
  }
}
