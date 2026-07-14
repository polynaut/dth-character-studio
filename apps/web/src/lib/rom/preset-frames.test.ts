import { beforeEach, describe, expect, it, vi } from 'vitest'

// resolvePresetFrames() is the linchpin of the frame-alignment invariant: it
// measures each preset ROM block's length from the actual .duf, and those measured
// counts flow into BOTH the PoseAsset CSV and the Daz script (config.presetFrames).
// It talks to the native `pose_asset_frames` command, so we drive it with a mocked
// invoke that returns per-path frame counts, and assert it measures the right blocks
// and hard-errors (never silently produces a wrong-length ROM) on a missing/bad asset.

/** path → measured result the mocked `pose_asset_frames` returns. */
const frameResponses = new Map<string, { frames: number; error: string }>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: { paths?: Array<string> }) => {
    if (cmd === 'pose_asset_frames') {
      return (args.paths ?? []).map((path) => {
        const hit = frameResponses.get(path)
        // An unmapped path surfaces as an error, so a test that forgets to seed a
        // needed block fails loudly instead of measuring it as 0.
        return { path, frames: hit?.frames ?? 0, error: hit ? hit.error : `unmeasured: ${path}` }
      })
    }
    return null
  },
  isTauri: () => false,
  convertFileSrc: (p: string) => p,
}))
// api.ts pulls in storage → these at module load; stub enough to import cleanly.
vi.mock('@tauri-apps/api/path', () => ({ appLocalDataDir: async () => '/appdata' }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async () => false,
  mkdir: async () => {},
  readTextFile: async () => {
    throw new Error('ENOENT')
  },
  writeTextFile: async () => {},
  readDir: async () => [],
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { characterSchema, defaultSections, type Character, type RomSections } from '@dth/rom'
import { resolvePresetFrames } from './api'

const FOLDER = 'D:/Lib/DazToHue/Poses'
const REL = {
  base: 'Genesis 9/DQS/G9 DQS JCM FAC - Base.duf',
  mouth: 'Genesis 9/DQS/G9 DQS JCM FAC - Mouth.duf',
  gp: 'Genesis 9/Common/Golden Palace 9/GP9 - Golden Palace.duf',
  dk: 'Genesis 9/Common/Dicktator 9/DK9 - Dicktator.duf',
}
const full = (rel: string) => `${FOLDER}/${rel}`

const catalog = {
  folder: FOLDER,
  releaseName: 'test',
  version: 'test',
  error: null,
  assets: [
    { name: 'G9 DQS JCM FAC - Base', relPath: REL.base, genesis: 'G9' as const, skinning: 'dqs' as const, section: 'JCM' as const, includesFac: true },
    { name: 'G9 DQS JCM FAC - Mouth', relPath: REL.mouth, genesis: 'G9' as const, skinning: 'dqs' as const, section: 'FAC' as const, includesFac: false },
    { name: 'GP9 - Golden Palace', relPath: REL.gp, genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
    { name: 'DK9 - Dicktator', relPath: REL.dk, genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
  ],
}

function makeCharacter(patch: (s: RomSections) => void = () => {}, over: Partial<Character> = {}): Character {
  const sections = defaultSections()
  sections.FBM.enabled = true
  sections.FBM.groups = [
    {
      id: 'g',
      label: '',
      suffix: 'centre',
      method: 'individual',
      calculateFrom: 'default',
      poses: [{ id: 'p', name: 'BodyTone', morphs: [], boneScaleRef: false }],
    },
  ]
  patch(sections)
  return characterSchema.parse({
    id: 'c1',
    name: 'Electra',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections,
    ...over,
  })
}

beforeEach(() => frameResponses.clear())

describe('resolvePresetFrames', () => {
  it('measures the base ROM only when no GEN/PHY block is included', async () => {
    frameResponses.set(full(REL.base), { frames: 328, error: '' })
    const frames = await resolvePresetFrames(makeCharacter(), catalog)
    expect(frames).toEqual({ base: 328, gp: 0, dk: 0, phys: 0 })
  })

  it('measures base + GP for a female character with GEN enabled', async () => {
    frameResponses.set(full(REL.base), { frames: 328, error: '' })
    frameResponses.set(full(REL.gp), { frames: 104, error: '' })
    const frames = await resolvePresetFrames(
      makeCharacter((s) => {
        s.GEN.enabled = true
      }),
      catalog,
    )
    expect(frames).toEqual({ base: 328, gp: 104, dk: 0, phys: 0 })
  })

  it('measures base + DK for a male character with GEN enabled', async () => {
    frameResponses.set(full(REL.base), { frames: 328, error: '' })
    frameResponses.set(full(REL.dk), { frames: 54, error: '' })
    const frames = await resolvePresetFrames(
      makeCharacter((s) => {
        s.GEN.enabled = true
      }, { gender: 'male' }),
      catalog,
    )
    expect(frames).toEqual({ base: 328, gp: 0, dk: 54, phys: 0 })
  })

  it('measures a custom JCM base from its own path, not the catalog', async () => {
    const customPath = 'X:/my/Custom Base ROM.duf'
    frameResponses.set(customPath, { frames: 617, error: '' })
    const frames = await resolvePresetFrames(
      makeCharacter((s) => {
        s.JCM.mode = 'custom'
        s.JCM.customAssetPath = customPath
      }),
      catalog,
    )
    expect(frames.base).toBe(617)
  })

  it('hard-errors when an included block cannot be located in the catalog', async () => {
    // Empty catalog → the base ROM path can't be resolved.
    await expect(
      resolvePresetFrames(makeCharacter(), { folder: '', releaseName: '', version: '', error: null, assets: [] }),
    ).rejects.toThrow(/base ROM/i)
  })

  it('hard-errors when an included block cannot be read (never a wrong-length ROM)', async () => {
    frameResponses.set(full(REL.base), { frames: 0, error: 'unreadable .duf' })
    await expect(resolvePresetFrames(makeCharacter(), catalog)).rejects.toThrow(
      /Couldn't read frames|unreadable/i,
    )
  })
})
