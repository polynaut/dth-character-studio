import { describe, expect, it } from 'vitest'

import { houdiniTaskCards } from './export-cards.ts'

// One task card per DazToHue NETWORK. A `.hip` can hold several, the meters
// have always counted them, and the column showed one row — which reads as "one
// thing is happening" about work the bar says is two.

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

describe('houdiniTaskCards', () => {
  it('names the networks from the SCAN before the run can', () => {
    // The reported stretch: the log still says "Opening Houdini (hython)", so
    // there is no run to ask — but the stored scan knows what this project
    // writes, and that is a name per network.
    const cards = houdiniTaskCards(project({ sets: ['LaraClassic', 'LaraNaked'] }), 0, null, true, 0)
    expect(cards.map((c) => [c.label, c.status])).toEqual([
      ['LaraClassic', 'waiting'],
      ['LaraNaked', 'waiting'],
    ])
    // The project name stays as the tooltip: with several projects queued, the
    // network name alone would not say which `.hip` it belongs to.
    expect(cards.every((c) => c.detail === 'LaraCroft_G81')).toBe(true)
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

  it('stays ONE card when nothing knows better', () => {
    // No scan, no run: a single project card, which is what shipped before any
    // of this. The scene list rides along as its tooltip.
    expect(houdiniTaskCards(project(), 0, null, false, 0)).toEqual([
      {
        id: `hou:${HIP}`,
        label: 'LaraCroft_G81',
        detail: 'LaraCroft_G8_1',
        kind: 'houdini',
        status: 'waiting',
      },
    ])
  })

  it('does not split a project with one network', () => {
    // A lone network IS the project — two rows saying the same thing is worse
    // than one, and the meters agree (no overall bar for a single unit).
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
