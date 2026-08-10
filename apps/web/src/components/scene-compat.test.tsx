// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { SceneValidationTable } from './scene-compat'
import {
  charactersLinkedScenes,
  genderForScan,
  genEnabledForScan,
  geograftKinds,
  primarySceneDerivation,
  sceneCompatFailed,
  sceneCompatHardFailed,
  sceneCompatRows,
  sceneCreateRows,
  sceneNotLinkedRow,
  sceneScanRows,
} from '#/lib/scene-compat.ts'
import { defaultSections } from '@dth/rom'

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
const GP = wearable('GoldenPalace_G9', 'Golden Palace')
const DK = wearable('DicktatorG9', 'Dicktator')

function states(rows: ReturnType<typeof sceneCompatRows>) {
  return Object.fromEntries(rows.map((row) => [row.key, row.state]))
}

describe('geograftKinds', () => {
  it('detects GP/DK across id/label/separator variants, ignoring everything else', () => {
    expect(geograftKinds({ items: [GP] })).toEqual(new Set(['gp']))
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

describe('scene-driven derivation (GEN gate + gender)', () => {
  it('genEnabledForScan: on with a geograft, off without, null when unreadable', () => {
    expect(genEnabledForScan(scan({ items: [GP] }))).toBe(true)
    expect(genEnabledForScan(scan())).toBe(false)
    expect(genEnabledForScan(scan({ error: 'boom' }))).toBeNull()
  })

  it('genderForScan: gendered figure id first, then the geograft, else null', () => {
    // The gendered generations answer directly from the figure id (G3 included).
    expect(
      genderForScan(scan({ figures: [{ id: 'Genesis8Male', label: 'Genesis 8 Male' }] })),
    ).toBe('male')
    expect(
      genderForScan(scan({ figures: [{ id: 'Genesis3Female', label: 'Genesis 3 Female' }] })),
    ).toBe('female')
    // The neutral G9 figure answers via the geograft.
    expect(genderForScan(scan({ items: [DK] }))).toBe('male')
    expect(genderForScan(scan({ items: [GP] }))).toBe('female')
    expect(genderForScan(scan({ items: [GP, DK] }))).toBe('female')
    // A bare neutral figure (or an unreadable scene) decides nothing.
    expect(genderForScan(scan())).toBeNull()
    expect(genderForScan(scan({ error: 'boom', items: [DK] }))).toBeNull()
  })

  it('primarySceneDerivation patches GEN.enabled + gender only when they change', () => {
    const sections = defaultSections() // GEN disabled
    // A GP scene on a female character: GEN turns on, gender already matches.
    const gp = primarySceneDerivation(scan({ items: [GP] }), {
      genesis: 'G9',
      gender: 'female',
      sections,
    })
    expect(gp.gender).toBeUndefined()
    expect(gp.sections?.GEN.enabled).toBe(true)
    // A DK scene on that female character flips the gender too.
    const dk = primarySceneDerivation(scan({ items: [DK] }), {
      genesis: 'G9',
      gender: 'female',
      sections,
    })
    expect(dk.gender).toBe('male')
    expect(dk.sections?.GEN.enabled).toBe(true)
    // No geograft + gender already right → nothing to patch.
    expect(
      primarySceneDerivation(scan(), { genesis: 'G9', gender: 'female', sections }),
    ).toEqual({})
    // Unreadable scene decides nothing.
    expect(
      primarySceneDerivation(scan({ error: 'boom', items: [GP] }), {
        genesis: 'G9',
        gender: 'male',
        sections,
      }),
    ).toEqual({})
  })

  it('a BOTH-grafts G9 scene selects the two GEN preset assets explicitly', () => {
    // The gender-based "auto" default (empty presetAssets) would include only
    // one block — a GP+DK scene needs both spelled out.
    const derived = primarySceneDerivation(scan({ items: [GP, DK] }), {
      genesis: 'G9',
      gender: 'female',
      sections: defaultSections(),
    })
    expect(derived.sections?.GEN.enabled).toBe(true)
    expect(derived.sections?.GEN.presetAssets).toEqual([
      'GP9 - Golden Palace.duf',
      'DK9 - Dicktator.duf',
    ])
  })
})

describe('sceneCompatRows (add-scene checks)', () => {
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
    // A passing check needs no "1 character" echo — the label says it all.
    const ok = sceneCompatRows({ scan: scan(), primaryScan: scan(), character: g9female })
    expect(ok[1].value).toBe('')

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
    const gp = scan({ items: [GP] })
    const dk = scan({ items: [DK] })
    const bare = scan()

    expect(states(sceneCompatRows({ scan: gp, primaryScan: gp, character: g9female })).geograft).toBe('ok')
    expect(states(sceneCompatRows({ scan: bare, primaryScan: bare, character: g9female })).geograft).toBe('ok')
    const mismatch = sceneCompatRows({ scan: dk, primaryScan: gp, character: g9female })
    expect(states(mismatch).geograft).toBe('fail')
    expect(mismatch[3].value).toBe('Dicktator, but the primary scene has Golden Palace')
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

describe('sceneCreateRows (create-dialog checks)', () => {
  it('is the character-independent subset: one character + empty timeline', () => {
    const rows = sceneCreateRows(scan())
    expect(rows.map((row) => row.key)).toEqual(['figures', 'timeline'])
    expect(states(rows)).toEqual({ figures: 'ok', timeline: 'ok' })

    const bad = sceneCreateRows(scan({ figures: [], animationFrames: 31 }))
    expect(states(bad)).toEqual({ figures: 'fail', timeline: 'fail' })
    expect(sceneCompatFailed(bad)).toBe(true)

    // Loading / unreadable → unchecked, never blocking.
    expect(states(sceneCreateRows(null))).toEqual({ figures: 'unchecked', timeline: 'unchecked' })
  })
})

describe('sceneNotLinkedRow (scene already belongs to a character)', () => {
  const owners = charactersLinkedScenes([
    { id: 'kira-1', name: 'Kira', scenePath: 'X:/p/Kira/daz3d/Kira.duf', extraScenes: ['X:/p/Kira/daz3d/Beach.duf'] },
    { id: 'matt-1', name: 'Matt', scenePath: 'X:/p/Matt/Matt.duf', extraScenes: [] },
  ])

  it('flattens every linked scene (primary + extras) with its owner', () => {
    expect(owners).toEqual([
      { path: 'X:/p/Kira/daz3d/Kira.duf', character: 'Kira', characterId: 'kira-1' },
      { path: 'X:/p/Kira/daz3d/Beach.duf', character: 'Kira', characterId: 'kira-1' },
      { path: 'X:/p/Matt/Matt.duf', character: 'Matt', characterId: 'matt-1' },
    ])
  })

  it('a linked scene is a HARD fail naming the owner — case/slash-insensitively', () => {
    const row = sceneNotLinkedRow('x:\\p\\kira\\daz3d\\BEACH.duf', owners)
    expect(row.state).toBe('fail')
    expect(row.hard).toBe(true)
    expect(row.problem).toBe('This scene is already linked to “Kira”.')
    expect(row.ownerId).toBe('kira-1')
    expect(sceneCompatHardFailed([row])).toBe(true)
  })

  it('an unclaimed scene passes; a loading owner list stays unchecked', () => {
    expect(sceneNotLinkedRow('X:/p/other/New.duf', owners).state).toBe('ok')
    const pending = sceneNotLinkedRow('X:/p/other/New.duf', null)
    expect(pending.state).toBe('unchecked')
    expect(sceneCompatHardFailed([pending])).toBe(false)
  })
})

describe('SceneValidationTable', () => {
  it('shows the checks, and the escape switch (with its label) only once one fails', () => {
    const okRows = sceneCompatRows({ scan: scan(), primaryScan: scan(), character: g9female })
    const { rerender } = render(
      <SceneValidationTable
        rows={okRows}
        loading={false}
        force={false}
        onForceChange={() => {}}
        forceLabel="Add anyway — test label"
      />,
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
      <SceneValidationTable
        rows={failRows}
        loading={false}
        force={false}
        onForceChange={() => {}}
        forceLabel="Add anyway — test label"
      />,
    )
    // A failed row reads as ONE sentence, not "label — detail".
    const failText = screen.getByText(/carries 31 frames of animation/)
    expect(failText).toBeTruthy()
    expect(screen.queryByText('Empty timeline')).toBeNull()
    expect(screen.getByText('Add anyway — test label')).toBeTruthy()
    // The failed row explains itself on hover; passing rows carry no tooltip
    // and no detail — the label + check icon say it all.
    expect(failText.closest('li')?.title).toContain('fills the animation timeline')
    expect(screen.queryByText('1 character')).toBeNull()
    expect(screen.getByText('One character').closest('li')?.getAttribute('title')).toBeNull()
  })

  it('renders "checking…" while loading (no premature fail, no switch)', () => {
    const rows = sceneCompatRows({ scan: null, primaryScan: null, character: g9female })
    render(
      <SceneValidationTable
        rows={rows}
        loading
        force={false}
        onForceChange={() => {}}
        forceLabel="Add anyway"
      />,
    )
    expect(screen.getAllByText('checking…')).toHaveLength(4)
    expect(screen.queryByText(/Add anyway/)).toBeNull()
  })

  it('a failed HARD row shows red but hides the escape switch (no escape exists)', () => {
    const rows = [
      ...sceneCompatRows({ scan: scan(), primaryScan: scan(), character: g9female }),
      sceneNotLinkedRow('X:/p/Kira/daz3d/Kira.duf', [
        { path: 'X:/p/Kira/daz3d/Kira.duf', character: 'Kira', characterId: 'kira-1' },
      ]),
    ]
    render(
      <SceneValidationTable
        rows={rows}
        loading={false}
        force={false}
        onForceChange={() => {}}
        forceLabel="Add anyway — test label"
      />,
    )
    // Without a projectId there's no router context — the plain sentence renders.
    expect(screen.getByText('This scene is already linked to “Kira”.')).toBeTruthy()
    expect(screen.queryByText(/Add anyway/)).toBeNull()
  })

  it('the owner link is suppressed when the owner IS the open character', () => {
    const rows = [
      sceneNotLinkedRow('X:/p/Kira/daz3d/Kira.duf', [
        { path: 'X:/p/Kira/daz3d/Kira.duf', character: 'Kira', characterId: 'kira-1' },
      ]),
    ]
    // projectId set AND owner === currentCharacterId → no <Link> renders (this
    // would crash outside a router otherwise), just the sentence.
    render(
      <SceneValidationTable
        rows={rows}
        loading={false}
        force={false}
        onForceChange={() => {}}
        forceLabel="Add anyway"
        projectId="X:/p"
        currentCharacterId="kira-1"
      />,
    )
    expect(screen.getByText('This scene is already linked to “Kira”.')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('the escape switch reports through onForceChange', () => {
    function Harness() {
      const [force, setForce] = useState(false)
      const rows = sceneCompatRows({
        scan: scan({ animationFrames: 31 }),
        primaryScan: scan(),
        character: g9female,
      })
      return (
        <SceneValidationTable
          rows={rows}
          loading={false}
          force={force}
          onForceChange={setForce}
          forceLabel="Create anyway"
        />
      )
    }
    render(<Harness />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})

describe('sceneScanRows — the Import-from-Daz-scene checks', () => {
  const KIRA = { genesis: 'G9', gender: 'female' } as const
  const rowFor = (rows: ReturnType<typeof sceneScanRows>, key: string) =>
    rows.find((row) => row.key === key)

  it('passes a one-figure G9 scene that HAS animation', () => {
    const rows = sceneScanRows(scan({ animationFrames: 240 }), KIRA)
    expect(rows.map((row) => row.state)).toEqual(['ok', 'ok', 'ok'])
    expect(rowFor(rows, 'animation')?.value).toBe('240 frames')
  })

  it('FAILS an empty timeline — the inverse of the add-scene rule', () => {
    // Adding a scene demands an empty timeline (the ROM script fills it);
    // scanning one demands a full timeline, because those keys are the whole
    // thing there is to read. Same field, opposite verdict.
    const rows = sceneScanRows(scan({ animationFrames: 1 }), KIRA)
    expect(rowFor(rows, 'animation')?.state).toBe('fail')
    expect(sceneCompatFailed(rows)).toBe(true)
    // …and that same scene passes the ADD checks, which is the point.
    expect(rowFor(sceneCreateRows(scan({ animationFrames: 1 })), 'timeline')?.state).toBe('ok')
  })

  it('FAILS a scene holding two figures — the headless scan picks the figure itself', () => {
    const rows = sceneScanRows(
      scan({
        animationFrames: 240,
        figures: [
          { id: 'Genesis9', label: 'Genesis 9' },
          { id: 'Genesis9-1', label: 'Genesis 9 (2)' },
        ],
      }),
      KIRA,
    )
    expect(rowFor(rows, 'figures')?.state).toBe('fail')
    expect(sceneCompatFailed(rows)).toBe(true)
  })

  it('FAILS a scene whose figure is a different generation from the character', () => {
    const rows = sceneScanRows(
      scan({ animationFrames: 240, figures: [{ id: 'Genesis8Female', label: 'Genesis 8 Female' }] }),
      KIRA,
    )
    expect(rowFor(rows, 'generation')?.state).toBe('fail')
  })

  it('is all-unchecked while the scene has not been read yet', () => {
    expect(sceneScanRows(null, KIRA).map((row) => row.state)).toEqual([
      'unchecked',
      'unchecked',
      'unchecked',
    ])
    // An unchecked row never blocks — the dialog shows "checking…", not a fail.
    expect(sceneCompatFailed(sceneScanRows(null, KIRA))).toBe(false)
  })
})
