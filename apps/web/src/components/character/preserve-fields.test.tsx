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
    preserveMorphs: [{ name: 'body_ctrl_BreastsUp-Down', keepValue: 0.6 }],
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
        morphIndex={[]}
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
    const initial = makeCharacter({
      sceneOverrides: [
        {
          scenePath: BEACH,
          enabled: false,
          poses: [],
          additions: [],
          sectionOverrides: [],
          sectionEnabled: [],
          identity: {
            enabled: true,
            facsDetailStrength: 0.5,
            flexionStrength: 1,
            applyUE5TearUV: false,
          },
          groom: { enabled: false },
          preserve: { enabled: false, morphs: [], nodeTransforms: [] },
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
})
