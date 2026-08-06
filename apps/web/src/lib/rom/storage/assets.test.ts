import { describe, expect, it } from 'vitest'

import type { AssetKind, DazAsset } from './assets.ts'

// The attachment registry gained a `kind` when Houdini templates were added.
// What must hold forever: a registry written BEFORE that still reads, and it
// reads as the only kind it could have held.

/** The registry's tolerant read, mirrored — see readAssetRegistry in assets.ts.
 *  Kept in step with it deliberately: the rule under test is the defaulting,
 *  and the real function needs a filesystem to reach. */
function normalizeKind(raw: unknown): AssetKind {
  return raw === 'houdini-project' ? 'houdini-project' : 'daz-scene'
}

describe('attachment kind defaulting', () => {
  it('reads a pre-Houdini record as a Daz scene', () => {
    // Every assets.json written before the feature held only Daz scenes, so an
    // ABSENT kind is not unknown — it is known to be daz-scene.
    expect(normalizeKind(undefined)).toBe('daz-scene')
  })

  it('keeps an explicit houdini-project', () => {
    expect(normalizeKind('houdini-project')).toBe('houdini-project')
  })

  it('falls back for an unrecognised kind rather than trusting it', () => {
    // A future/typo kind must not reach the UI as itself: the card and the
    // open-action branch on it, and an unknown value would render neither.
    expect(normalizeKind('houdini')).toBe('daz-scene')
    expect(normalizeKind(42)).toBe('daz-scene')
  })

  it('the record type carries kind', () => {
    const asset: DazAsset = {
      id: 'a',
      kind: 'houdini-project',
      name: 'G9 Skin Base',
      scenePath: 'D:/templates/G9_Skin_Base.hiplc',
      description: '',
      subfolder: '',
      linked: true,
      createdAt: '',
      updatedAt: '',
    }
    expect(asset.kind).toBe('houdini-project')
    // A Houdini template is always linked — never copied into `.assets`.
    expect(asset.linked).toBe(true)
  })
})
