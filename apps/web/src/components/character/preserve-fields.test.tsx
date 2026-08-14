// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { PreserveFields } from './preserve-fields'
import { useSceneSelection } from '#/lib/use-scene-selection.ts'
import { characterSchema, defaultSections } from '@dth/rom'
import type { Character } from '@dth/rom'
import type { MorphIndexEntry } from '#/lib/rom/api.ts'

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
    preserveMorphs: [{ name: 'body_ctrl_BreastsUp-Down', keepValue: 0.6 }],
    sections: defaultSections(),
    ...overrides,
  })
}

/** Wires PreserveFields to the real useSceneSelection so an edit round-trips the
 *  implicit-override writer exactly as the character route does. */
const NO_INDEX: Array<MorphIndexEntry> = []

function Harness({
  initial,
  morphIndex = NO_INDEX,
}: {
  initial: Character
  morphIndex?: Array<MorphIndexEntry>
}) {
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
        morphIndex={morphIndex}
      />
    </div>
  )
}

/** Exact class token — avoids a false hit on `placeholder:text-muted-foreground`. */
const isMuted = (el: HTMLElement) => el.className.split(/\s+/).includes('text-muted-foreground')

describe('PreserveFields per-scene override', () => {
  it('editing a hold value on a non-primary scene arms the list override', () => {
    render(<Harness initial={makeCharacter()} />)
    fireEvent.click(screen.getByText('select-beach'))
    expect(screen.queryByTitle(RESET)).toBeNull()

    const input = screen.getByDisplayValue('60') as HTMLInputElement
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.blur(input)

    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('adding a morph on a non-primary scene arms the list override', () => {
    render(<Harness initial={makeCharacter()} />)
    fireEvent.click(screen.getByText('select-beach'))
    fireEvent.click(screen.getByText('Add morph'))
    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('the override survives switching away from and back to the scene', () => {
    render(<Harness initial={makeCharacter()} />)
    fireEvent.click(screen.getByText('select-beach'))
    const input = screen.getByDisplayValue('60') as HTMLInputElement
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.blur(input)

    fireEvent.click(screen.getByText('select-primary'))
    fireEvent.click(screen.getByText('select-beach'))
    expect(screen.getByDisplayValue('70')).not.toBeNull()
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
    expect(isMuted(screen.getByDisplayValue('60'))).toBe(false)

    // Non-primary, still inherited → the "can override, not yet" muted tell.
    fireEvent.click(screen.getByText('select-beach'))
    expect(isMuted(screen.getByDisplayValue('60'))).toBe(true)

    // Overridden → the mute drops (the green border takes over).
    const input = screen.getByDisplayValue('60') as HTMLInputElement
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.blur(input)
    expect(isMuted(screen.getByDisplayValue('70'))).toBe(false)
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
    const input = screen.getByDisplayValue('60') as HTMLInputElement
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.blur(input)
    expect(screen.queryByTitle(RESET)).not.toBeNull()
  })

  it('picking a suggestion fills the Item scope with the node the dial lives on', () => {
    // The index KNOWS the node; before v32 the pick dropped it and the runtime
    // searched the figure root — where a clothing dial never exists. The scope
    // is a read-only chip: the pick is its ONLY setter.
    render(
      <Harness
        initial={makeCharacter()}
        morphIndex={[{ node: 'Boots', nodeLabel: 'Boots', label: 'Expand All', name: 'ExpandAll' }]}
      />,
    )
    // The unscoped row reads as the fallback, not as an editable field.
    expect(screen.getByText('Figure')).not.toBeNull()

    const name = screen.getByDisplayValue('body_ctrl_BreastsUp-Down') as HTMLInputElement
    fireEvent.focus(name)
    fireEvent.change(name, { target: { value: 'expandall' } })
    fireEvent.mouseDown(screen.getByRole('option'))

    expect(screen.getByDisplayValue('ExpandAll')).not.toBeNull()
    // The info row under the field mirrors the picked suggestion: the node
    // badge plus the Daz UI name (re-looked-up in the index, not stored).
    expect(screen.getByText('Boots')).not.toBeNull()
    expect(screen.getByText(/Daz UI name: Expand All/)).not.toBeNull()
  })

  it('clearing the Item scope (chip ✕) on a non-primary scene arms the list override', () => {
    const initial = makeCharacter({
      preserveMorphs: [{ name: 'body_ctrl_BreastsUp-Down', keepValue: 0.6, node: 'Boots' }],
    })
    render(<Harness initial={initial} />)
    fireEvent.click(screen.getByText('select-beach'))
    expect(screen.queryByTitle(RESET)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear the item scope' }))
    // The scope dropped back to the figure root…
    expect(screen.getByText('Figure')).not.toBeNull()
    // …and the row now differs from the base, so the override armed.
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
