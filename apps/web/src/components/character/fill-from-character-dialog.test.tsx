// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

// The wizard's only runtime import from the api module — mocked so the test
// controls the cross-project candidate list without a native layer.
vi.mock('#/lib/rom/api.ts', () => ({ fetchAllCharacters: vi.fn() }))

import { fetchAllCharacters } from '#/lib/rom/api.ts'
import { FillFromCharacterDialog } from './fill-from-character-dialog.tsx'
import { characterSchema, defaultSections } from '@dth/rom'

import type { CharacterWithProject } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

function sourceCharacter(): CharacterWithProject {
  const c = characterSchema.parse({
    id: 'src-1',
    name: 'Kira',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  })
  c.sections.EXP.enabled = true
  c.sections.EXP.groups = [
    {
      id: 'g1',
      label: '',
      suffix: 'centre',
      method: 'default',
      calculateFrom: 'default',
      poses: [{ id: 'p1', name: 'Smile', morphs: [], boneScaleRef: false }],
    },
  ]
  c.jcmMorphMods = [{ id: 'r1', boneLabel: 'Left Thigh Bend', axis: 'XRotate', drives: [] }]
  c.preserveMorphs = [{ name: 'BreastsGone', keepValue: 1 }]
  c.facsDetailStrength = 0.8
  return { ...c, projectId: 'X:/projects/default', projectName: 'Default' }
}

const target = { id: '', genesis: 'G9' as const, gender: 'female' as const, sections: defaultSections() }

describe('FillFromCharacterDialog', () => {
  it('walks both steps and fills the picked sections plus the checked extras', async () => {
    const male = { ...sourceCharacter(), id: 'src-2', name: 'Bob', gender: 'male' as const }
    vi.mocked(fetchAllCharacters).mockResolvedValue([sourceCharacter(), male])
    let patch: (Partial<Character> & { sections: Character['sections'] }) | null = null
    let picked: unknown = null
    render(
      <FillFromCharacterDialog
        target={target}
        onFill={(p, source) => {
          patch = p
          picked = source
        }}
        onClose={() => {}}
      />,
    )
    // Only the gender-compatible candidate is listed; clicking its row button
    // advances straight to step 2 (no radio + Next round-trip).
    expect(await screen.findByRole('button', { name: 'Kira' })).toBeTruthy()
    expect(screen.queryByText('Bob')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Kira' }))

    // Step 2: the filled sections; JCM rules pre-checked, the preserve list
    // offered but starting UNCHECKED (its node-transform sibling isn't offered
    // at all — the source has none). The strength dials are never an extra.
    expect(screen.getByText('Expressions')).toBeTruthy()
    expect(screen.getByText('Modify JCM frames')).toBeTruthy()
    expect(screen.queryByText('Strength dials')).toBeNull()
    expect(screen.getByText('Preserve morphs')).toBeTruthy()
    expect(screen.queryByText('Preserve node transforms')).toBeNull()

    // Opt the preserve-morph list in, then fill.
    fireEvent.click(screen.getByText('Preserve morphs'))
    fireEvent.click(screen.getByRole('button', { name: 'Fill from character' }))
    expect(patch!.sections.EXP.groups[0].poses[0].name).toBe('Smile')
    expect(patch!.jcmMorphMods).toHaveLength(1)
    expect(patch!.facsDetailStrength).toBeUndefined()
    expect(patch!.preserveMorphs).toEqual([{ name: 'BreastsGone', keepValue: 1 }])
    expect(patch!.preserveNodeTransforms).toBeUndefined()
    // RET/JCM/FAC are enabled preset sections in the stock defaults, so the
    // source offers them as filled alongside its custom EXP.
    expect(picked).toMatchObject({
      id: 'src-1',
      name: 'Kira',
      picked: ['RET', 'JCM', 'FAC', 'EXP'],
      extras: { jcmRules: true, preserveMorphs: true, preserveNodeTransforms: false },
    })
  })

  it('unchecked extras stay out of the patch', async () => {
    vi.mocked(fetchAllCharacters).mockResolvedValue([sourceCharacter()])
    let patch: Partial<Character> | null = null
    render(
      <FillFromCharacterDialog
        target={target}
        onFill={(p) => {
          patch = p
        }}
        onClose={() => {}}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Kira' }))
    // Uncheck the pre-checked JCM rules (the preserve list already starts off).
    fireEvent.click(screen.getByText('Modify JCM frames'))
    fireEvent.click(screen.getByRole('button', { name: 'Fill from character' }))
    expect(patch!.jcmMorphMods).toBeUndefined()
    expect(patch!.facsDetailStrength).toBeUndefined()
    expect(patch!.preserveMorphs).toBeUndefined()
    expect(patch!.sections!.EXP.groups).toHaveLength(1)
  })

  it('RET rides with JCM: its checkbox mirrors JCM and both drop together', async () => {
    vi.mocked(fetchAllCharacters).mockResolvedValue([sourceCharacter()])
    let picked: { picked: Array<string> } | null = null
    render(
      <FillFromCharacterDialog
        target={target}
        onFill={(_p, source) => {
          picked = source
        }}
        onClose={() => {}}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Kira' }))
    const ret = within(screen.getByText('Retargeting').closest('label')!).getByRole('checkbox')
    expect(ret).toHaveProperty('disabled', true)
    expect(ret).toHaveProperty('checked', true)
    // Unchecking Joint Corrective flips the mirrored RET checkbox too…
    fireEvent.click(screen.getByText('Joint Corrective'))
    expect(ret).toHaveProperty('checked', false)
    // …and the fill copies neither.
    fireEvent.click(screen.getByRole('button', { name: 'Fill from character' }))
    expect(picked!.picked).toEqual(['FAC', 'EXP'])
  })
})
