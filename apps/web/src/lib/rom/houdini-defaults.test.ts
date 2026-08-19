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

// The timeline row. DazToHue's import node sets the FPS when it LOADS the files
// (mrpdean), so this is about the projects where that has not happened: one the
// studio generated headlessly, and one built by hand before any import.
describe('defaultsRowsFor — the timeline row', () => {
  const rowFor = (fps: number | undefined) =>
    defaultsRowsFor({ job: ITA, fps }, ITA).find((row) => row.key === 'fps')

  it('is absent when the scan has no FPS at all', () => {
    // An older stored scan predates the field entirely — it must not produce a
    // verdict about something nobody read.
    expect(rowFor(undefined)).toBeUndefined()
  })

  it('flags Houdini’s own 24 as differing, and is actionable', () => {
    const row = rowFor(24)
    expect(row?.status).toBe('differs')
    expect(row?.current).toBe('24')
    expect(row?.expected).toBe('30')
    expect(row?.actionable).toBe(true)
  })

  it('reports 30 as matching', () => {
    expect(rowFor(30)?.status).toBe('matches')
    expect(rowFor(30)?.matches).toBe(true)
  })

  it('calls a 0 unknown, not different', () => {
    // 0 is what a project that would not open reports. "differs" invites a
    // repair over a value nobody managed to read.
    expect(rowFor(0)?.status).toBe('unknown')
    expect(rowFor(0)?.verdict).toBe('could not be read')
    expect(rowFor(0)?.current).toBe('')
  })

  it('keeps a real broadcast rate legible rather than rounding it away', () => {
    expect(rowFor(29.97)?.status).toBe('differs')
    expect(rowFor(29.97)?.current).toBe('29.97')
  })
})

describe('defaultsRowsFor — the range row', () => {
  const rowFor = (timeline: Parameters<typeof defaultsRowsFor>[0]['timeline']) =>
    defaultsRowsFor({ job: ITA, timeline }, ITA).find((row) => row.key === 'range')

  it('is absent when the scan has no timeline field at all', () => {
    // An older stored scan predates the field entirely — same rule as the FPS.
    expect(rowFor(undefined)).toBeUndefined()
  })

  it("flags a playbar still on Houdini's default over a longer Alembic, and is actionable", () => {
    const row = rowFor({ start: 1, end: 240, known: true, abcStart: 0, abcEnd: 981, abcKnown: true })
    expect(row?.status).toBe('differs')
    expect(row?.current).toBe('1 – 240')
    expect(row?.expected).toContain('0 – 981')
    expect(row?.actionable).toBe(true)
  })

  it('reports a matching range as matching, float noise included', () => {
    const row = rowFor({
      start: 0,
      end: 981.0000001,
      known: true,
      abcStart: 0,
      abcEnd: 981,
      abcKnown: true,
    })
    expect(row?.status).toBe('matches')
    expect(row?.matches).toBe(true)
  })

  it('calls a missing Alembic unknown — and NOT actionable, with the reason', () => {
    // A project generated before its Daz export has no file to read the range
    // off; there is nothing to write, and the row says what to do instead.
    const row = rowFor({ start: 1, end: 240, known: true, abcStart: 0, abcEnd: 0, abcKnown: false })
    expect(row?.status).toBe('unknown')
    expect(row?.verdict).toBe('no Alembic to read it from yet')
    expect(row?.actionable).toBe(false)
    expect(row?.reason).toContain('Daz export')
  })

  it('calls an unreadable playbar unknown, not different', () => {
    const row = rowFor({ start: 0, end: 0, known: false, abcStart: 0, abcEnd: 981, abcKnown: true })
    expect(row?.status).toBe('unknown')
    expect(row?.verdict).toBe('could not be read')
    expect(row?.current).toBe('')
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

  it('queues a project whose $JOB is fine but whose timeline is not', () => {
    // The two are judged independently: one run opens the file once and writes
    // whichever of them is actually off. Missing this is what would leave the
    // card badging a 24 fps project while the button sat disabled.
    expect(
      projectsNeedingRepair([{ hipPath: 'a.hiplc', ok: true, job: ITA, fps: 24 }], ITA),
    ).toEqual(['a.hiplc'])
    expect(
      projectsNeedingRepair([{ hipPath: 'a.hiplc', ok: true, job: ITA, fps: 30 }], ITA),
    ).toEqual([])
  })

  it('never queues a project whose FPS could not be read', () => {
    expect(
      projectsNeedingRepair([{ hipPath: 'a.hiplc', ok: true, job: ITA, fps: 0 }], ITA),
    ).toEqual([])
  })

  it('queues a project whose only fault is the playbar range — and skips an unknown one', () => {
    // Same independence as the FPS: the range alone is enough to open the file,
    // and an unknown side (no Alembic yet, old stored scan) is never queued.
    expect(
      projectsNeedingRepair(
        [
          {
            hipPath: 'a.hiplc',
            ok: true,
            job: ITA,
            fps: 30,
            timeline: { start: 1, end: 240, known: true, abcStart: 0, abcEnd: 981, abcKnown: true },
          },
        ],
        ITA,
      ),
    ).toEqual(['a.hiplc'])
    expect(
      projectsNeedingRepair(
        [
          {
            hipPath: 'a.hiplc',
            ok: true,
            job: ITA,
            fps: 30,
            timeline: { start: 1, end: 240, known: true, abcStart: 0, abcEnd: 0, abcKnown: false },
          },
        ],
        ITA,
      ),
    ).toEqual([])
  })

  it('queues a project with an unreadable $JOB for its timeline alone', () => {
    // The queue is per PROJECT but the write is per VALUE: this one is sent for
    // its 24 fps, and `op_defaults` must still leave the unread $JOB alone —
    // the smoke's timeline-only spec pins the visible half of that.
    expect(
      projectsNeedingRepair([{ hipPath: 'a.hiplc', ok: true, job: '', fps: 24 }], ITA),
    ).toEqual(['a.hiplc'])
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
  const HIP_REL_DTU = '/obj/DazToHue/DazToHueImport import_character_dtu_file'
  /** Measured with the pre-v0.64 $JOB still in place. */
  const STALE_REFS = { collapsible: 0, foreign: 2, broken: [BROKEN_DTU], hipRelative: [] }
  /** The same file, measured again after the $JOB repair. */
  const REPAIRED_REFS = { collapsible: 2, foreign: 0, broken: [BROKEN_DTU], hipRelative: [] }
  const CLEAN_REFS = { collapsible: 0, foreign: 0, broken: [], hipRelative: [] }

  it('refuses to run while $JOB is still stale, and says why', () => {
    const plan = planRepath([{ hipPath: HIP, ok: true, job: ITA_STALE_JOB, refs: STALE_REFS }], ITA)

    expect(plan.targets).toEqual([])
    expect(plan.blockedByJob).toEqual([HIP])
    // Named after the BUTTON, which repairs more than `$JOB` since the timeline
    // joined it — a tooltip pointing at a button that no longer exists is a
    // dead end.
    expect(plan.reason).toContain('Repair the project settings first')
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
    const plan = planRepath(
      [
        { hipPath: 'a.hiplc', ok: true, job: ITA, refs: CLEAN_REFS },
        { hipPath: 'b.hiplc', ok: true, job: ITA, refs: REPAIRED_REFS },
      ],
      ITA,
    )
    expect(plan.targets).toEqual(['b.hiplc'])
  })

  it('says so when there is genuinely nothing left to fix', () => {
    const plan = planRepath([{ hipPath: 'a.hiplc', ok: true, job: ITA, refs: CLEAN_REFS }], ITA)
    expect(plan.targets).toEqual([])
    expect(plan.reason).toContain('already relative')
  })

  it('counts a project with only BROKEN refs as work, not as clean', () => {
    // Nothing to collapse, but a dangling import is still a repair. This is the
    // ONLY signal a project whose export folder moved gives off: every import
    // path broke at once, and nothing absolute is left to collapse.
    const plan = planRepath(
      [
        {
          hipPath: 'a.hiplc',
          ok: true,
          job: ITA,
          refs: { collapsible: 0, foreign: 0, broken: [BROKEN_DTU], hipRelative: [] },
        },
      ],
      ITA,
    )
    expect(plan.targets).toEqual(['a.hiplc'])
    expect(plan.broken).toBe(1)
  })

  it('counts a project with only $HIP-relative refs as work too', () => {
    // A pre-v63 project: its paths RESOLVE and none is absolute, so `collapsible`
    // and `broken` are both 0 and the plan used to call it clean — while the
    // card's own `hip-relative` badge told the user "Make paths portable
    // rewrites them" and the button sat disabled. The run re-anchors them and
    // reports them as collapsed, so the plan counts them the same way.
    const plan = planRepath(
      [
        {
          hipPath: 'a.hiplc',
          ok: true,
          job: ITA,
          refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: [HIP_REL_DTU] },
        },
      ],
      ITA,
    )
    expect(plan.targets).toEqual(['a.hiplc'])
    expect(plan.collapsible).toBe(1)
    expect(plan.reason).toBe('')
  })

  it('ignores a project the scan could not read', () => {
    const plan = planRepath(
      [
        {
          hipPath: 'gone.hiplc',
          ok: false,
          job: '',
          refs: { collapsible: 9, foreign: 9, broken: [], hipRelative: [] },
        },
      ],
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
          refs: { collapsible: 3, foreign: 5, broken: [], hipRelative: [] },
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
