import { describe, expect, it } from 'vitest'

import {
  defaultsRowsFor,
  planRepath,
  projectsNeedingRepair,
  sameFolder,
} from './houdini-defaults.ts'

/**
 * The `$JOB` values are REAL, read out of the two projects with hython:
 *
 *   PlaygroundAssets_Ita.hiplc  $JOB = …/characters/Ita/houdini/houdini-project
 *   KiraDefault_G9_GP.hiplc     $JOB = …/characters/kira/houdini/KiraDefault_G9_GP
 *
 * Ita is the case #701 exists for — a project created before v0.64, still
 * carrying the folder that sits BELOW the exports and so can never collapse a
 * picked export path.
 */

const ITA = 'D:/Perforce/playground__assets/characters/Ita'
const ITA_STALE_JOB = `${ITA}/houdini/houdini-project`
const ITA_HIP_DIR = `${ITA}/houdini`

describe('sameFolder', () => {
  it('ignores separator style and case — these are Windows paths', () => {
    expect(sameFolder('D:\\chars\\Ita', 'D:/chars/ita')).toBe(true)
  })

  it('ignores one trailing separator', () => {
    expect(sameFolder('D:/chars/Ita/', 'D:/chars/Ita')).toBe(true)
  })

  it('does not call two different folders the same', () => {
    expect(sameFolder(ITA_STALE_JOB, ITA)).toBe(false)
    // A prefix is not a match — the stale value is literally under the right one.
    expect(sameFolder(`${ITA}/houdini`, ITA)).toBe(false)
  })

  it('treats an unreadable value as no match rather than a match', () => {
    // Both empty would compare equal by string, and would then render as
    // "matches" for a project nothing could be read from.
    expect(sameFolder('', '')).toBe(false)
    expect(sameFolder('', ITA)).toBe(false)
  })
})

describe('defaultsRowsFor', () => {
  it('flags the pre-v0.64 $JOB', () => {
    const [job] = defaultsRowsFor({ job: ITA_STALE_JOB }, ITA)

    expect(job?.matches).toBe(false)
    expect(job?.current).toBe(ITA_STALE_JOB)
    expect(job?.expected).toBe(ITA)
    expect(job?.actionable).toBe(true)
  })

  it('reports a repaired project as matching', () => {
    const [job] = defaultsRowsFor({ job: ITA }, ITA)
    expect(job?.matches).toBe(true)
    expect(job?.status).toBe('matches')
  })

  it('calls an unreadable value unknown, not different', () => {
    // "differs" invites a repair; nobody managed to read this one, so the
    // honest state is its own.
    const [job] = defaultsRowsFor({ job: '' }, ITA)
    expect(job?.status).toBe('unknown')
    expect(job?.matches).toBe(false)
  })

  it('reports $JOB and nothing else', () => {
    // $HIP was a second row until v0.68. It is derived from where the `.hip`
    // sits, so it could never differ from itself and could never be actioned —
    // a check that cannot fail beside an action that cannot run.
    const rows = defaultsRowsFor({ job: ITA }, ITA)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('job')
  })
})

describe('projectsNeedingRepair', () => {
  const projects = [
    { hipPath: `${ITA_HIP_DIR}/PlaygroundAssets_Ita.hiplc`, ok: true, job: ITA_STALE_JOB },
    { hipPath: `${ITA_HIP_DIR}/Already.hiplc`, ok: true, job: ITA },
    { hipPath: `${ITA_HIP_DIR}/Broken.hiplc`, ok: false, job: '' },
  ]

  it('names only the projects whose $JOB differs', () => {
    expect(projectsNeedingRepair(projects, ITA)).toEqual([
      `${ITA_HIP_DIR}/PlaygroundAssets_Ita.hiplc`,
    ])
  })

  it('never queues a project the scan could not read', () => {
    // Its `$JOB` is unknown, not wrong — writing one would be a guess, and the
    // scan failure is the thing to fix first.
    expect(projectsNeedingRepair(projects, ITA)).not.toContain(`${ITA_HIP_DIR}/Broken.hiplc`)
  })

  it('never queues a project that reported no $JOB at all', () => {
    // ok, but nothing was read — same reasoning, different symptom.
    expect(
      projectsNeedingRepair([{ hipPath: 'blank.hiplc', ok: true, job: '' }], ITA),
    ).toEqual([])
  })

  it('returns nothing once every project is repaired', () => {
    expect(projectsNeedingRepair([{ hipPath: 'a.hiplc', ok: true, job: ITA }], ITA)).toEqual([])
  })
})

/**
 * The repath gate.
 *
 * The two `refs` fixtures are the SAME real project measured twice with hython —
 * before and after its `$JOB` was repaired. Same file, opposite answer, which is
 * exactly why the order is enforced rather than suggested.
 */
describe('planRepath', () => {
  const HIP = `${ITA_HIP_DIR}/PlaygroundAssets_Ita.hiplc`
  const BROKEN_DTU = '/obj/DazToHue/DazToHueImport import_character_dtu_file'
  /** Measured with the pre-v0.64 $JOB still in place. */
  const STALE_REFS = { collapsible: 0, foreign: 2, broken: [BROKEN_DTU] }
  /** The same file, measured again after the $JOB repair. */
  const REPAIRED_REFS = { collapsible: 2, foreign: 0, broken: [BROKEN_DTU] }

  it('refuses to run while $JOB is still stale, and says why', () => {
    const plan = planRepath([{ hipPath: HIP, ok: true, job: ITA_STALE_JOB, refs: STALE_REFS }], ITA)

    expect(plan.targets).toEqual([])
    expect(plan.blockedByJob).toEqual([HIP])
    expect(plan.reason).toContain('Repair $JOB first')
    // Nothing is counted from a blocked project — its numbers describe a state
    // the user is about to change.
    expect(plan.collapsible).toBe(0)
    expect(plan.broken).toBe(0)
  })

  it('runs once $JOB matches, counting what the same file then reports', () => {
    const plan = planRepath([{ hipPath: HIP, ok: true, job: ITA, refs: REPAIRED_REFS }], ITA)

    expect(plan.targets).toEqual([HIP])
    expect(plan.blockedByJob).toEqual([])
    expect(plan.collapsible).toBe(2)
    expect(plan.broken).toBe(1)
    expect(plan.foreign).toBe(0)
    expect(plan.reason).toBe('')
  })

  it('sends only the projects with something to do', () => {
    const clean = { collapsible: 0, foreign: 0, broken: [] }
    const plan = planRepath(
      [
        { hipPath: 'a.hiplc', ok: true, job: ITA, refs: clean },
        { hipPath: 'b.hiplc', ok: true, job: ITA, refs: REPAIRED_REFS },
      ],
      ITA,
    )
    expect(plan.targets).toEqual(['b.hiplc'])
  })

  it('says so when there is genuinely nothing left to fix', () => {
    const clean = { collapsible: 0, foreign: 0, broken: [] }
    const plan = planRepath([{ hipPath: 'a.hiplc', ok: true, job: ITA, refs: clean }], ITA)
    expect(plan.targets).toEqual([])
    expect(plan.reason).toContain('already relative')
  })

  it('counts a project with only BROKEN refs as work, not as clean', () => {
    // Nothing to collapse, but a dangling import is still a repair.
    const plan = planRepath(
      [
        {
          hipPath: 'a.hiplc',
          ok: true,
          job: ITA,
          refs: { collapsible: 0, foreign: 0, broken: [BROKEN_DTU] },
        },
      ],
      ITA,
    )
    expect(plan.targets).toEqual(['a.hiplc'])
    expect(plan.broken).toBe(1)
  })

  it('ignores a project the scan could not read', () => {
    const plan = planRepath(
      [{ hipPath: 'gone.hiplc', ok: false, job: '', refs: { collapsible: 9, foreign: 9, broken: [] } }],
      ITA,
    )
    expect(plan.targets).toEqual([])
    expect(plan.blockedByJob).toEqual([])
    expect(plan.collapsible).toBe(0)
  })

  it('reports foreign paths without letting them block the run', () => {
    // They cannot be made portable, but that is not a reason to withhold the
    // fixes that CAN be applied.
    const plan = planRepath(
      [
        {
          hipPath: 'a.hiplc',
          ok: true,
          job: ITA,
          refs: { collapsible: 3, foreign: 5, broken: [] },
        },
      ],
      ITA,
    )
    expect(plan.targets).toEqual(['a.hiplc'])
    expect(plan.foreign).toBe(5)
    expect(plan.reason).toBe('')
  })
})

// The PoseAsset CSV-path row. It exists because "not filled in" and "your
// DazToHue hasn't got that parameter" are different answers, and only the first
// one is something the user can act on.
describe('defaultsRowsFor — the CSV path row', () => {
  const CHAR = 'D:/proj/Kira'
  const scanned = (fillable: Array<string>, missing: Array<string>) => ({
    job: CHAR,
    prefill: { fillable, missing },
  })

  it('is absent when the scan says nothing about prefill at all', () => {
    // An older scan shape (or a project that failed to open) must not invent a
    // verdict about a parameter nobody looked at.
    expect(defaultsRowsFor({ job: CHAR }, CHAR).map((r) => r.key)).toEqual(['job'])
  })

  it('reports a blank parm as actionable — Fill network writes it', () => {
    const row = defaultsRowsFor(scanned(['pose_asset_csv_file_path'], []), CHAR)[1]
    expect(row.key).toBe('csv')
    expect(row.status).toBe('differs')
    expect(row.verdict).toBe('not filled in')
    expect(row.actionable).toBe(true)
  })

  it('reports a DazToHue without the parm as NOT actionable, and says why', () => {
    const row = defaultsRowsFor(scanned([], ['pose_asset_csv_file_path']), CHAR)[1]
    expect(row.status).toBe('unknown')
    expect(row.verdict).toBe('your DazToHue has no such parameter')
    expect(row.actionable).toBe(false)
    expect(row.reason).toMatch(/Update DazToHue/)
  })

  it('reports a filled parm as matching', () => {
    const row = defaultsRowsFor(scanned([], []), CHAR)[1]
    expect(row.status).toBe('matches')
    expect(row.matches).toBe(true)
    expect(row.actionable).toBe(false)
  })
})
