import { describe, expect, it } from 'vitest'

import { dazTaskCards, houdiniTaskCards, runPercent, unrealTaskCards } from './export-cards.ts'

// ONE ROW PER JOB — the rule the whole task list is built on. A `.hip` can hold
// several DazToHue networks; one Unreal project can take several export sets.
// Both used to show a single row, which reads as "one thing is happening" about
// work that is two.

const HIP = 'D:/p/Lara/houdini/LaraCroft_G81.hiplc'
const project = (over: Partial<Parameters<typeof houdiniTaskCards>[0]> = {}) => ({
  path: HIP,
  label: 'LaraCroft_G81',
  networks: ['LaraCroft_G8_1'],
  ...over,
})
const running = (
  over: Partial<{
    total: number
    networks: Array<{ label: string; status: 'ok' | 'skipped' | 'failed' | 'waiting' }>
    activity: { scene: string }
  }> = {},
) =>
  ({
    state: 'running' as const,
    done: 0,
    total: 2,
    networks: [],
    ...over,
  }) as Parameters<typeof houdiniTaskCards>[2]

describe('dazTaskCards', () => {
  const scenes = [
    { path: 'D:/p/Lara/daz3d/Casual.duf', label: 'Casual' },
    { path: 'D:/p/Lara/daz3d/Naked.duf', label: 'Naked' },
  ]

  it('says what the run DOES to each scene', () => {
    // The mode is chosen once, in a dropdown that is long closed by the time
    // the run is being watched — so the row carries it.
    expect(dazTaskCards(scenes, 'export-only', 0, false, true).map((c) => c.detail)).toEqual([
      'Export only',
      'Export only',
    ])
    expect(dazTaskCards(scenes, 'rom-export', 0, false, true)[0].detail).toBe('ROM + Export')
  })

  it('leaves the detail OFF when the mode is not known', () => {
    // An adopted run: this window reads a job file, which carries rows and no
    // trace of the dialog's choice. Saying "ROM + Export" there would be a
    // guess dressed as a fact.
    expect(dazTaskCards(scenes, undefined, 0, false, true)[0].detail).toBeUndefined()
  })

  it('walks the active row with the Runner, and only while one is working', () => {
    expect(dazTaskCards(scenes, 'rom-export', 0, false, true).map((c) => c.status)).toEqual([
      'active',
      'waiting',
    ])
    expect(dazTaskCards(scenes, 'rom-export', 1, false, true).map((c) => c.status)).toEqual([
      'done',
      'active',
    ])
    // Handed off but not yet claimed — nothing is being worked, so nothing is
    // active.
    expect(dazTaskCards(scenes, 'rom-export', 0, false, false).map((c) => c.status)).toEqual([
      'waiting',
      'waiting',
    ])
    // The batch is over: the job file (and its count) is deleted with it.
    expect(dazTaskCards(scenes, 'rom-export', 0, true, false).map((c) => c.status)).toEqual([
      'done',
      'done',
    ])
  })
})

describe('houdiniTaskCards', () => {
  it('names the networks from the SCAN before the run can', () => {
    // The reported stretch: the status line still says "Opening Houdini
    // (hython)", so there is no run to ask — but the stored scan knows what
    // this project writes, and that is a name per network.
    const cards = houdiniTaskCards(project({ sets: ['LaraClassic', 'LaraNaked'] }), 0, null, true, 0)
    expect(cards.map((c) => [c.label, c.status])).toEqual([
      ['LaraClassic', 'waiting'],
      ['LaraNaked', 'waiting'],
    ])
    // The project name rides along as the row's context: with several projects
    // queued, the network name alone would not say which `.hip` it belongs to.
    expect(cards.every((c) => c.context === 'LaraCroft_G81')).toBe(true)
    expect(cards.every((c) => c.detail === 'DazToHue network')).toBe(true)
    expect(new Set(cards.map((c) => c.id)).size).toBe(2)
  })

  it('lets the RUN replace the scan — it is the list actually being exported', () => {
    // The scan says what the project writes; the run says what this run does
    // (a network whose scene was not selected is not exported). The run wins
    // the moment it speaks.
    const cards = houdiniTaskCards(
      project({ sets: ['LaraClassic', 'LaraNaked'] }),
      0,
      running({
        total: 2,
        networks: [
          { label: 'LaraClassic', status: 'ok' },
          { label: 'LaraNaked', status: 'waiting' },
        ],
      }),
      true,
      0,
    )
    expect(cards.map((c) => [c.label, c.status])).toEqual([
      ['LaraClassic', 'done'],
      ['LaraNaked', 'active'],
    ])
  })

  it('does not tick off a network that FAILED', () => {
    // 456.py answers per network, and a failed one is finished-but-wrong. It
    // used to render exactly like a good one — a green list with the failure
    // living only in a toast the user may already have dismissed. `skipped`
    // stays `done`: it finished with nothing to do, which is not a failure.
    const cards = houdiniTaskCards(
      project(),
      0,
      running({
        total: 3,
        networks: [
          { label: 'LaraClassic', status: 'ok' },
          { label: 'LaraNaked', status: 'failed' },
          { label: 'LaraThick', status: 'skipped' },
        ],
      }),
      true,
      0,
    )
    expect(cards.map((c) => [c.label, c.status])).toEqual([
      ['LaraClassic', 'done'],
      ['LaraNaked', 'failed'],
      ['LaraThick', 'done'],
    ])
  })

  it('falls back to the live activity, then to counting', () => {
    // A run whose targets predate this feature names only what has finished —
    // the active one comes off the activity channel, and anything past that
    // has nothing honest to be called.
    const cards = houdiniTaskCards(
      project(),
      0,
      running({ total: 3, networks: [], activity: { scene: 'KiraDefault' } }),
      true,
      0,
    )
    expect(cards.map((c) => c.label)).toEqual(['KiraDefault', 'Network 2', 'Network 3'])
    expect(cards.map((c) => c.status)).toEqual(['active', 'waiting', 'waiting'])
  })

  it('stays ONE row when nothing knows better', () => {
    // No scan, no run: a single project row, which is what shipped before any
    // of this — named by the project, saying what it is there to do.
    expect(houdiniTaskCards(project(), 0, null, false, 0)).toEqual([
      {
        id: `hou:${HIP}`,
        label: 'LaraCroft_G81',
        detail: 'DazToHue export',
        kind: 'houdini',
        status: 'waiting',
      },
    ])
  })

  it('does not split a project with one network', () => {
    // A lone network IS the project — two rows saying the same thing is worse
    // than one.
    expect(houdiniTaskCards(project({ sets: ['LaraClassic'] }), 0, null, false, 0)).toHaveLength(1)
    expect(houdiniTaskCards(project(), 0, running({ total: 1 }), true, 0)).toHaveLength(1)
  })

  it('marks a project the queue has already passed as done', () => {
    expect(houdiniTaskCards(project(), 0, null, false, 1)[0].status).toBe('done')
    expect(
      houdiniTaskCards(project({ sets: ['A', 'B'] }), 0, null, false, 1).map((c) => c.status),
    ).toEqual(['done', 'done'])
  })
})

describe('unrealTaskCards', () => {
  const UPROJECT = 'D:/ue/workflow3d/workflow3d.uproject'

  it('gives ONE row per export set — two characters into one project are two imports', () => {
    const cards = unrealTaskCards(
      {
        path: UPROJECT,
        label: 'workflow3d',
        sets: [
          { name: 'LaraClassic', existing: true },
          { name: 'LaraNaked', existing: true },
        ],
      },
      'waiting',
    )
    expect(cards.map((c) => c.label)).toEqual(['LaraClassic', 'LaraNaked'])
    // Both name the project they are going into — the rows are only telling
    // the truth if you can see WHERE each one lands.
    expect(cards.every((c) => c.context === 'workflow3d')).toBe(true)
    expect(new Set(cards.map((c) => c.id)).size).toBe(2)
  })

  it('says re-import, first import, or neither — never a guess', () => {
    const detail = (existing?: boolean) =>
      unrealTaskCards(
        { path: UPROJECT, label: 'workflow3d', sets: [{ name: 'Lara', existing }] },
        'waiting',
      )[0].detail
    // The studio located those assets in that project: the bridge imports on
    // top of them.
    expect(detail(true)).toBe('Re-import')
    // It looked and found none.
    expect(detail(false)).toBe('First import')
    // Nobody looked (a run restored after a reload carries the set names, not
    // the probe) — so the row claims neither.
    expect(detail(undefined)).toBe('Import')
  })

  it('falls back to the project when the sets are unknown', () => {
    const cards = unrealTaskCards({ path: UPROJECT, label: 'workflow3d', sets: [] }, 'active')
    expect(cards).toEqual([
      { id: `ue:${UPROJECT}`, label: 'workflow3d', detail: 'Import', kind: 'unreal', status: 'active' },
    ])
  })
})

describe('runPercent', () => {
  const rows = (...statuses: Array<'waiting' | 'active' | 'done' | 'failed'>) =>
    statuses.map((status) => ({ status }))

  it('counts a FAILED row as behind us, like a finished one', () => {
    // The bar measures how much of the list is OVER, not how much of it worked
    // — counting only `done` leaves a run with one bad network short of 100%
    // forever, which reads as "still going" when nothing is. The failure is
    // said by the row and the report; a percentage cannot carry it.
    expect(runPercent(rows('done', 'failed'), 0)).toBe(100)
    expect(runPercent(rows('failed', 'active', 'waiting', 'waiting'), 0.5)).toBe(38)
  })

  it('counts finished rows and the active one’s own share', () => {
    expect(runPercent(rows('done', 'active', 'waiting', 'waiting'), 0.5)).toBe(38)
    expect(runPercent(rows('done', 'done'), 0)).toBe(100)
    expect(runPercent(rows('waiting', 'waiting'), 0.5)).toBe(0)
  })

  it('ignores the active fraction when no row is active', () => {
    // A leg between two units (the Daz→Houdini baton, a project opening) must
    // not credit its share to a row nobody is working.
    expect(runPercent(rows('done', 'waiting'), 0.9)).toBe(50)
  })

  it('is the active fraction alone when there are no rows to count', () => {
    // A run adopted before its job file is readable — there is nothing else to
    // say, and a flat 0% would read as "stuck".
    expect(runPercent([], 0.4)).toBe(40)
  })
})
