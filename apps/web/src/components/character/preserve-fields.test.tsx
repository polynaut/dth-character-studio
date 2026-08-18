// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { PreserveFields } from './preserve-fields'
import { useSceneSelection } from '#/lib/use-scene-selection.ts'
import { characterSchema, defaultSections } from '@dth/rom'
import type { Character } from '@dth/rom'

const PRIMARY = 'D:\\s\\Primary.duf'
const BEACH = 'D:\\s\\Beach.duf'
const RESET = "Reset to the primary scene's value"

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const now = '2026-07-20T00:00:00.000Z'
  return characterSchema.parse({
    id: 'test',
    name: 'Electra G9',
    createdAt: now,
    updatedAt: now,
    scenePath: PRIMARY,
    extraScenes: [BEACH],
    preserveNodeTransforms: [{ nodeLabel: 'Left Eye' }],
    sections: defaultSections(),
    ...overrides,
  })
}

/** Wires PreserveFields to the real useSceneSelection so an edit round-trips the
 *  implicit-override writer exactly as the character route does. */
function Harness({ initial }: { initial: Character }) {
  const [character, setCharacter] = useState(initial)
  const patch = (p: Partial<Character>) => setCharacter((c) => ({ ...c, ...p }))
  const sceneSel = useSceneSelection(character, patch)
  return (
    <div>
      <button onClick={() => sceneSel.selectScene(BEACH)}>select-beach</button>
      <button onClick={() => sceneSel.selectScene(PRIMARY)}>select-primary</button>
      <PreserveFields
        character={character}
        patch={patch}
        overrideEligible={sceneSel.overrideEligible}
        sceneOverride={sceneSel.sceneOverride}
        writePreserve={sceneSel.writePreserve}
      />
    </div>
  )
}

/** Exact class token — avoids a false hit on `placeholder:text-muted-foreground`. */
const isMuted = (el: HTMLElement) => el.className.split(/\s+/).includes('text-muted-foreground')

describe('PreserveFields per-scene override', () => {
  it('editing a node label on a non-primary scene arms the list override', () => {
    render(<Harness initial={makeCharacter()} />)
    fireEvent.click(screen.getByText('select-beach'))
    expect(screen.queryByTitle(RESET)).toBeNull()

    const input = screen.getByDisplayValue('Left Eye') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Right Eye' } })

    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('adding a node on a non-primary scene arms the list override', () => {
    render(<Harness initial={makeCharacter()} />)
    fireEvent.click(screen.getByText('select-beach'))
    fireEvent.click(screen.getByText('Add node'))
    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('the override survives switching away from and back to the scene', () => {
    render(<Harness initial={makeCharacter()} />)
    fireEvent.click(screen.getByText('select-beach'))
    const input = screen.getByDisplayValue('Left Eye') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Right Eye' } })

    fireEvent.click(screen.getByText('select-primary'))
    fireEvent.click(screen.getByText('select-beach'))
    expect(screen.getByDisplayValue('Right Eye')).not.toBeNull()
    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('deleting a row arms the override — the label handle carries it (no green row)', () => {
    render(<Harness initial={makeCharacter()} />)
    fireEvent.click(screen.getByText('select-beach'))
    expect(screen.queryByTitle(RESET)).toBeNull()

    // Removing the only row leaves the list shorter than the base — it diverges by
    // COUNT, so no remaining row is individually green; only the label handle marks it.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('an inherited row reads muted on a non-primary scene, plain on the primary', () => {
    render(<Harness initial={makeCharacter()} />)
    // Primary scene → not overridable → no mute.
    expect(isMuted(screen.getByDisplayValue('Left Eye'))).toBe(false)

    // Non-primary, still inherited → the "can override, not yet" muted tell.
    fireEvent.click(screen.getByText('select-beach'))
    expect(isMuted(screen.getByDisplayValue('Left Eye'))).toBe(true)

    // Overridden → the mute drops (the green border takes over).
    const input = screen.getByDisplayValue('Left Eye') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Right Eye' } })
    expect(isMuted(screen.getByDisplayValue('Right Eye'))).toBe(false)
  })

  it('arms even when the scene already carries an override entry (identity armed)', () => {
    // Presence-armed record (schema v24): the identity block EXISTING is the
    // override — no rom entries, no preserve/jcm blocks, no stored booleans.
    const initial = makeCharacter({
      sceneOverrides: [
        {
          scenePath: BEACH,
          rom: {},
          hair: [],
          identity: {
            facsDetailStrength: 0.5,
            flexionStrength: 1,
            applyUE5TearUV: false,
          },
        },
      ],
    })
    render(<Harness initial={initial} />)
    fireEvent.click(screen.getByText('select-beach'))
    const input = screen.getByDisplayValue('Left Eye') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Right Eye' } })
    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('renaming a node row to duplicate another base label still arms (multiset, not set)', () => {
    // Base [Head, Neck]. Rename "Neck" → "Head": the list becomes [Head, Head] — a
    // genuinely different multiset (Neck's preservation dropped). A SET compare reads
    // it as equal (same length, both labels ∈ {Head, Neck}) and DISARMS, reverting the
    // typed row back to "Neck" and silently generating the base list. The override must
    // stay armed and the edit must persist.
    const initial = makeCharacter({
      preserveNodeTransforms: [{ nodeLabel: 'Head' }, { nodeLabel: 'Neck' }],
    })
    render(<Harness initial={initial} />)
    fireEvent.click(screen.getByText('select-beach'))

    const neck = screen.getByDisplayValue('Neck') as HTMLInputElement
    fireEvent.change(neck, { target: { value: 'Head' } })

    // Edit persisted (both node inputs now "Head") — not reverted to "Neck".
    expect(screen.getAllByDisplayValue('Head')).toHaveLength(2)
    expect(screen.queryByDisplayValue('Neck')).toBeNull()
    // Override armed — the reset handle is visible.
    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })
})
