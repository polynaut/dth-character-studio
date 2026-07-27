// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import {
  geograftKinds,
  sceneCompatFailed,
  sceneCompatRows,
  SceneValidationTable,
} from './scene-compat'

import type { SceneWearables } from '#/lib/rom/api.ts'

function wearable(id: string, label: string) {
  return { id, label, conformTarget: '#Genesis9' }
}

/** A readable G9 scene: one figure, rest-pose keys only, no wearables. */
function scan(over: Partial<SceneWearables> = {}): SceneWearables {
  return {
    items: [],
    figure: { id: 'Genesis9', label: 'Genesis 9' },
    figures: [{ id: 'Genesis9', label: 'Genesis 9' }],
    animationFrames: 1,
    error: '',
    ...over,
  }
}

const g9female = { genesis: 'G9', gender: 'female' } as const

function states(rows: ReturnType<typeof sceneCompatRows>) {
  return Object.fromEntries(rows.map((row) => [row.key, row.state]))
}

describe('geograftKinds', () => {
  it('detects GP/DK across id/label/separator variants, ignoring everything else', () => {
    expect(geograftKinds({ items: [wearable('GoldenPalace_G9', 'Golden Palace')] })).toEqual(
      new Set(['gp']),
    )
    // G8-era id without the suffix, and a label-only hit ("Golden Palace Shell").
    expect(geograftKinds({ items: [wearable('shell_1', 'Golden Palace Shell')] })).toEqual(
      new Set(['gp']),
    )
    expect(geograftKinds({ items: [wearable('DicktatorG9', 'Dicktator 9')] })).toEqual(
      new Set(['dk']),
    )
    expect(
      geograftKinds({
        items: [wearable('Crop Top_88', 'MM Crop Top'), wearable('hair_1', 'dForce Hair')],
      }),
    ).toEqual(new Set())
  })
})

describe('sceneCompatRows', () => {
  it('passes every check for a matching bare scene', () => {
    const rows = sceneCompatRows({ scan: scan(), primaryScan: scan(), character: g9female })
    expect(states(rows)).toEqual({
      generation: 'ok',
      figures: 'ok',
      timeline: 'ok',
      geograft: 'ok',
    })
    expect(sceneCompatFailed(rows)).toBe(false)
  })

  it('fails the generation check on a different Genesis (and on a gendered mismatch)', () => {
    const g81 = scan({ figures: [{ id: 'Genesis8_1Female', label: 'Genesis 8.1 Female' }] })
    const rows = sceneCompatRows({ scan: g81, primaryScan: scan(), character: g9female })
    expect(states(rows).generation).toBe('fail')
    expect(rows[0].value).toContain('G8.1')
    expect(rows[0].value).toContain('G9')

    // The gendered generations carry the gender in the figure id — compare it too.
    const male = scan({ figures: [{ id: 'Genesis8Male', label: 'Genesis 8 Male' }] })
    const genderRows = sceneCompatRows({
      scan: male,
      primaryScan: scan(),
      character: { genesis: 'G8', gender: 'female' },
    })
    expect(states(genderRows).generation).toBe('fail')
  })

  it('fails the one-character check on two figures — or none at all', () => {
    const two = scan({
      figures: [
        { id: 'Genesis9', label: 'Genesis 9' },
        { id: 'Genesis9-1', label: 'Genesis 9 (2)' },
      ],
    })
    const rows = sceneCompatRows({ scan: two, primaryScan: scan(), character: g9female })
    expect(states(rows).figures).toBe('fail')
    expect(rows[1].value).toBe('2 characters')

    const none = sceneCompatRows({
      scan: scan({ figures: [] }),
      primaryScan: scan(),
      character: g9female,
    })
    expect(states(none).figures).toBe('fail')
    // With no figure the generation can't be judged — unchecked, not a second fail.
    expect(states(none).generation).toBe('unchecked')
  })

  it('flags a filled animation timeline (rest-pose keys are fine)', () => {
    const filled = sceneCompatRows({
      scan: scan({ animationFrames: 31 }),
      primaryScan: scan(),
      character: g9female,
    })
    expect(states(filled).timeline).toBe('fail')
    expect(filled[2].value).toBe('31 frames of animation')
    for (const frames of [0, 1]) {
      const ok = sceneCompatRows({
        scan: scan({ animationFrames: frames }),
        primaryScan: scan(),
        character: g9female,
      })
      expect(states(ok).timeline).toBe('ok')
    }
  })

  it('compares the geograft SET against the primary scene', () => {
    const gp = scan({ items: [wearable('GoldenPalace_G9', 'Golden Palace')] })
    const dk = scan({ items: [wearable('DicktatorG9', 'Dicktator')] })
    const bare = scan()

    expect(states(sceneCompatRows({ scan: gp, primaryScan: gp, character: g9female })).geograft).toBe('ok')
    expect(states(sceneCompatRows({ scan: bare, primaryScan: bare, character: g9female })).geograft).toBe('ok')
    const mismatch = sceneCompatRows({ scan: dk, primaryScan: gp, character: g9female })
    expect(states(mismatch).geograft).toBe('fail')
    expect(mismatch[3].value).toBe('Dicktator — the primary scene has Golden Palace')
    expect(states(sceneCompatRows({ scan: gp, primaryScan: bare, character: g9female })).geograft).toBe('fail')
  })

  it('degrades to unchecked (never fail) when a scene could not be read', () => {
    // The candidate scene unreadable → every check unchecked, nothing blocks.
    const broken = sceneCompatRows({
      scan: scan({ error: 'not running in the desktop app', figures: [], animationFrames: 0 }),
      primaryScan: scan(),
      character: g9female,
    })
    expect(Object.values(states(broken)).every((s) => s === 'unchecked')).toBe(true)
    expect(sceneCompatFailed(broken)).toBe(false)

    // Only the primary unreadable → just the geograft compare goes unchecked.
    const noPrimary = sceneCompatRows({
      scan: scan(),
      primaryScan: scan({ error: 'boom', figures: [] }),
      character: g9female,
    })
    expect(states(noPrimary).geograft).toBe('unchecked')
    expect(noPrimary[3].value).toBe("couldn't read the primary scene")

    // Still loading (null scans) → unchecked as well.
    const loading = sceneCompatRows({ scan: null, primaryScan: null, character: g9female })
    expect(Object.values(states(loading)).every((s) => s === 'unchecked')).toBe(true)
  })
})

describe('SceneValidationTable', () => {
  it('shows the checks, and the Add-anyway switch only once one fails', () => {
    const okRows = sceneCompatRows({ scan: scan(), primaryScan: scan(), character: g9female })
    const { rerender } = render(
      <SceneValidationTable rows={okRows} loading={false} force={false} onForceChange={() => {}} />,
    )
    expect(screen.getByText('Validation')).toBeTruthy()
    expect(screen.getByText('Same generation')).toBeTruthy()
    expect(screen.queryByText(/Add anyway/)).toBeNull()

    const failRows = sceneCompatRows({
      scan: scan({ animationFrames: 31 }),
      primaryScan: scan(),
      character: g9female,
    })
    rerender(
      <SceneValidationTable rows={failRows} loading={false} force={false} onForceChange={() => {}} />,
    )
    expect(screen.getByText('31 frames of animation')).toBeTruthy()
    expect(screen.getByText(/Add anyway/)).toBeTruthy()
  })

  it('renders "checking…" while loading (no premature fail, no switch)', () => {
    const rows = sceneCompatRows({ scan: null, primaryScan: null, character: g9female })
    render(<SceneValidationTable rows={rows} loading force={false} onForceChange={() => {}} />)
    expect(screen.getAllByText('checking…')).toHaveLength(4)
    expect(screen.queryByText(/Add anyway/)).toBeNull()
  })

  it('the Add-anyway switch reports through onForceChange', () => {
    function Harness() {
      const [force, setForce] = useState(false)
      const rows = sceneCompatRows({
        scan: scan({ animationFrames: 31 }),
        primaryScan: scan(),
        character: g9female,
      })
      return (
        <SceneValidationTable rows={rows} loading={false} force={force} onForceChange={setForce} />
      )
    }
    render(<Harness />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})
