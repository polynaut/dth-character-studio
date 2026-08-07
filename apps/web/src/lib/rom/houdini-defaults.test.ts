import { describe, expect, it } from 'vitest'

import { defaultsRowsFor, projectsNeedingRepair, sameFolder } from './houdini-defaults.ts'

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
  it('flags the pre-v0.64 $JOB and leaves $HIP matching', () => {
    const [job, hip] = defaultsRowsFor(
      { job: ITA_STALE_JOB, hipDir: ITA_HIP_DIR },
      ITA,
      ITA_HIP_DIR,
    )

    expect(job?.matches).toBe(false)
    expect(job?.current).toBe(ITA_STALE_JOB)
    expect(job?.expected).toBe(ITA)
    expect(job?.actionable).toBe(true)

    expect(hip?.matches).toBe(true)
    // $HIP is derived from where the scene sits — reported, never rewritten.
    expect(hip?.actionable).toBe(false)
    expect(hip?.reason).not.toBe('')
  })

  it('reports a repaired project as matching', () => {
    const [job] = defaultsRowsFor({ job: ITA, hipDir: ITA_HIP_DIR }, ITA, ITA_HIP_DIR)
    expect(job?.matches).toBe(true)
    expect(job?.status).toBe('matches')
  })

  it('calls an unreadable value unknown, not different', () => {
    // "differs" invites a repair; nobody managed to read this one, so the
    // honest state is its own.
    const [job] = defaultsRowsFor({ job: '', hipDir: ITA_HIP_DIR }, ITA, ITA_HIP_DIR)
    expect(job?.status).toBe('unknown')
    expect(job?.matches).toBe(false)
  })

  it('flags a scene that lives outside the studio’s houdini folder', () => {
    // Kira's scene sits one level deeper, in its own subfolder — legitimate
    // for a linked project, and exactly what a report-only row is for.
    const kira = 'D:/Perforce/thick-raider__assets/characters/kira'
    const [, hip] = defaultsRowsFor(
      { job: `${kira}/houdini/KiraDefault_G9_GP`, hipDir: `${kira}/houdini/KiraDefault_G9_GP` },
      kira,
      `${kira}/houdini`,
    )
    expect(hip?.matches).toBe(false)
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
