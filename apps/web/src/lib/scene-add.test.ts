import { describe, expect, it, vi } from 'vitest'

import { characterSchema } from '@dth/rom'

import { addScenePatch } from './scene-add.ts'

import type { Character } from '@dth/rom'

// Only the one native read `addScenePatch` performs — the scan whose detected
// hair the seeding (and the automatic "Export hair items") is decided from.
const sceneWearables = vi.hoisted(() => vi.fn())
vi.mock('#/lib/rom/api.ts', () => ({ sceneWearables, fetchCharactersWithProblems: vi.fn() }))

const PRIMARY = 'X:\\scenes\\Kira.duf'
const OUTFIT = 'X:\\scenes\\Beach.duf'

function makeCharacter(overrides: Record<string, unknown> = {}): Character {
  const now = '2026-08-19T00:00:00.000Z'
  return characterSchema.parse({
    id: 'c1',
    name: 'Kira',
    createdAt: now,
    updatedAt: now,
    scenePath: PRIMARY,
    sceneOverrides: [{ scenePath: PRIMARY, hair: [{ nodeLabel: 'CHT Sevenly Hair' }] }],
    ...overrides,
  })
}

const scan = (labels: Array<string>) => ({
  items: labels.map((label) => ({ id: label, label, conformTarget: '#Genesis9' })),
  figures: [],
  animationFrames: 0,
  error: '',
})

describe('addScenePatch — hair seeding decides the automatic "Export hair items"', () => {
  it('an outfit scene arriving with its OWN hair gets the export armed', async () => {
    sceneWearables.mockResolvedValueOnce(scan(['Nova Ponytail Hair']))
    const patch = await addScenePatch(OUTFIT, makeCharacter())
    const record = patch.sceneOverrides?.find((o) => o.scenePath === OUTFIT)
    expect(record?.hair).toEqual([{ nodeLabel: 'Nova Ponytail Hair' }])
    expect(record?.exportHair).toBe(true)
    // The primary's record rides along untouched.
    expect(
      patch.sceneOverrides?.find((o) => o.scenePath === PRIMARY)?.exportHair,
    ).toBeUndefined()
  })

  it('detected hair matching the primary fully stays on the default (absent)', async () => {
    sceneWearables.mockResolvedValueOnce(scan(['CHT Sevenly Hair']))
    const patch = await addScenePatch(OUTFIT, makeCharacter())
    const record = patch.sceneOverrides?.find((o) => o.scenePath === OUTFIT)
    expect(record?.hair).toEqual([{ nodeLabel: 'CHT Sevenly Hair' }])
    expect(record?.exportHair).toBeUndefined()
  })

  it('a re-added scene keeps its existing record — nothing is seeded or re-decided', async () => {
    sceneWearables.mockResolvedValueOnce(scan(['Nova Ponytail Hair']))
    const character = makeCharacter({
      sceneOverrides: [
        { scenePath: PRIMARY, hair: [{ nodeLabel: 'CHT Sevenly Hair' }] },
        // The user curated this list (and switch) before unlinking the scene.
        { scenePath: OUTFIT, hair: [{ nodeLabel: 'Nova Ponytail Hair' }], exportHair: false },
      ],
    })
    const patch = await addScenePatch(OUTFIT, character)
    // seedSceneHair refuses to clobber → the patch carries no sceneOverrides.
    expect(patch.sceneOverrides).toBeUndefined()
    expect(patch.extraScenes).toContain(OUTFIT)
  })
})
