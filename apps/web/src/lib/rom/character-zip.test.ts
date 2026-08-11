import { describe, expect, it } from 'vitest'

import { characterSchema } from '@dth/rom'

import {
  characterZipExclusions,
  characterZipFileName,
  characterZipManifestSchema,
  mergeImportedCharacter,
  rekeyAvatarFileName,
  repointExecuteStampsText,
  repointExportFoldersRecordText,
  repointPath,
  repointProductScansText,
  repointRomRunLogText,
  sceneWipeTarget,
} from './character-zip.ts'

import type { Character } from '@dth/rom'

const DATE = new Date('2026-08-11T14:30:00Z')

describe('characterZipFileName', () => {
  it('names the zip after the character folder + date with the dedicated suffix', () => {
    expect(characterZipFileName('Kira', DATE)).toBe('Kira_2026-08-11.dcsc.zip')
  })

  it('suffixes the STEM on a retry and sanitizes the name', () => {
    expect(characterZipFileName('Kira', DATE, 2)).toBe('Kira_2026-08-11 (2).dcsc.zip')
    expect(characterZipFileName('K:ra?', DATE)).toBe('K ra_2026-08-11.dcsc.zip')
  })
})

describe('characterZipManifestSchema', () => {
  const manifest = {
    format: 'dcs-character',
    formatVersion: 1,
    characterId: 'char-kira',
    characterName: 'Kira',
    definitionFile: 'Kira.json',
  }

  it('accepts a minimal manifest and fills the defaults', () => {
    const parsed = characterZipManifestSchema.parse(manifest)
    expect(parsed.includes).toEqual({ dazExports: false, houdiniExports: false })
    expect(parsed.sourceFolder).toBe('')
  })

  it('refuses a foreign format and a path-shaped definitionFile', () => {
    expect(() => characterZipManifestSchema.parse({ ...manifest, format: 'other' })).toThrow()
    expect(() =>
      characterZipManifestSchema.parse({ ...manifest, definitionFile: 'sub/Kira.json' }),
    ).toThrow()
  })
})

describe('characterZipExclusions', () => {
  it('always prunes the transient Houdini job transport', () => {
    const { excludeRel } = characterZipExclusions({
      exportSubdir: 'export',
      includeDazExports: true,
      includeHoudiniExports: true,
    })
    expect(excludeRel).toEqual(['.dth_houdini_job.json', '.dth_houdini_result.json'])
  })

  it('prunes the export trees only when their toggle is off', () => {
    const slim = characterZipExclusions({
      exportSubdir: 'export',
      includeDazExports: false,
      includeHoudiniExports: false,
    })
    // daz-export by NAME (the legacy tree's location varies); the final export
    // folder by rel path (its name is too generic to match at any depth).
    expect(slim.excludeDirNames).toEqual(['daz-export', 'dth-exports'])
    expect(slim.excludeRel).toContain('export')
    const full = characterZipExclusions({
      exportSubdir: 'export',
      includeDazExports: true,
      includeHoudiniExports: true,
    })
    expect(full.excludeDirNames).toEqual([])
    expect(full.excludeRel).not.toContain('export')
  })
})

describe('rekeyAvatarFileName', () => {
  it('re-keys the current scheme, its .src sibling, and the legacy prefixes', () => {
    expect(rekeyAvatarFileName('old--sc-123.png', 'old', 'new')).toBe('new--sc-123.png')
    expect(rekeyAvatarFileName('old--up-9.src.png', 'old', 'new')).toBe('new--up-9.src.png')
    expect(rekeyAvatarFileName('old.png', 'old', 'new')).toBe('new.png')
    expect(rekeyAvatarFileName('old-123.png', 'old', 'new')).toBe('new-123.png')
  })

  it('leaves other characters’ files and unknown names alone', () => {
    expect(rekeyAvatarFileName('other--sc-123.png', 'old', 'new')).toBe('other--sc-123.png')
    expect(rekeyAvatarFileName('unrelated.txt', 'old', 'new')).toBe('unrelated.txt')
  })
})

const FROM = 'D:/Old Projects/Demo/Kira'
const TO = 'X:/Projects/Fresh/Kira (2)'

describe('repointPath', () => {
  it('repoints inside-the-folder paths and leaves outside links untouched', () => {
    expect(repointPath(`${FROM}/daz3d/primary/Kira.duf`, FROM, TO)).toBe(
      `${TO}/daz3d/primary/Kira.duf`,
    )
    expect(repointPath('D:/Elsewhere/Scene.duf', FROM, TO)).toBe('D:/Elsewhere/Scene.duf')
  })
})

describe('sceneWipeTarget', () => {
  const DEST = 'D:/Projects/Demo/Vera'
  const ROOT = `${DEST}/daz3d`
  const base = { destFolder: DEST, scenesRoot: ROOT, keptScenes: [`${ROOT}/primary/Vera.duf`] }

  it('removes a deselected scene’s own subfolder (sidecars live in it)', () => {
    expect(sceneWipeTarget({ ...base, scene: `${ROOT}/yoga/Vera_Yoga.duf` })).toBe(`${ROOT}/yoga`)
  })

  it('removes only the file at the scenes root and at the character folder', () => {
    expect(sceneWipeTarget({ ...base, scene: `${ROOT}/Vera_Loose.duf` })).toBe(
      `${ROOT}/Vera_Loose.duf`,
    )
    expect(sceneWipeTarget({ ...base, scene: `${DEST}/Vera_Rootly.duf` })).toBe(
      `${DEST}/Vera_Rootly.duf`,
    )
  })

  it('never removes a folder that also holds a KEPT scene', () => {
    // Two scenes in one hand-arranged subfolder, one deselected: removing the
    // folder would take the kept one — the PRIMARY here — along with it.
    expect(
      sceneWipeTarget({ ...base, scene: `${ROOT}/primary/Vera_Alt.duf` }),
    ).toBe(`${ROOT}/primary/Vera_Alt.duf`)
    // Case/separator noise is not a different folder (Windows semantics).
    expect(
      sceneWipeTarget({ ...base, scene: `${ROOT.toUpperCase()}\\PRIMARY\\Vera_Alt.duf` }),
    ).toBe(`${ROOT.toUpperCase()}\\PRIMARY\\Vera_Alt.duf`)
  })
})

describe('meta-file repointers', () => {
  it('repoints the export-folder record’s exportDir', () => {
    const text = JSON.stringify({
      version: 1,
      exportDir: `${FROM}/houdini/daz-export`,
      folders: ['primary'],
    })
    const fixed = repointExportFoldersRecordText(text, FROM, TO)
    expect(fixed).not.toBeNull()
    expect(JSON.parse(fixed!)).toEqual({
      version: 1,
      exportDir: `${TO}/houdini/daz-export`,
      folders: ['primary'],
    })
  })

  it('re-keys the execute stamps’ scene keys (normalized, like their writers)', () => {
    const text = JSON.stringify({
      version: 1,
      scenes: {
        'd:/old projects/demo/kira/daz3d/primary/kira.duf': { mtimeMs: 1, size: 2, signature: 's' },
        'd:/elsewhere/scene.duf': { mtimeMs: 3, size: 4, signature: 't' },
      },
    })
    const fixed = repointExecuteStampsText(text, FROM, TO)
    expect(fixed).not.toBeNull()
    expect(Object.keys(JSON.parse(fixed!).scenes)).toEqual([
      'x:/projects/fresh/kira (2)/daz3d/primary/kira.duf',
      'd:/elsewhere/scene.duf',
    ])
  })

  it('repoints the run log’s per-scene paths and the product scans’ scenePath', () => {
    const log = JSON.stringify({
      ok: true,
      runs: [{ scene: `${FROM}/daz3d/primary/Kira.duf` }, { scene: '' }],
    })
    expect(JSON.parse(repointRomRunLogText(log, FROM, TO)!).runs[0].scene).toBe(
      `${TO}/daz3d/primary/Kira.duf`,
    )
    const products = JSON.stringify({
      version: 1,
      scans: [{ scenePath: `${FROM}/daz3d/primary/Kira.duf`, products: [] }],
    })
    expect(JSON.parse(repointProductScansText(products, FROM, TO)!).scans[0].scenePath).toBe(
      `${TO}/daz3d/primary/Kira.duf`,
    )
  })

  it('returns null for unparseable or already-correct files', () => {
    expect(repointExportFoldersRecordText('not json', FROM, TO)).toBeNull()
    expect(
      repointExportFoldersRecordText(
        JSON.stringify({ version: 1, exportDir: 'D:/Elsewhere/x', folders: [] }),
        FROM,
        TO,
      ),
    ).toBeNull()
  })
})

describe('mergeImportedCharacter', () => {
  const DEST = 'D:/Projects/Demo/Vera'
  const character = (over: Record<string, unknown>): Character =>
    characterSchema.parse({
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    })
  const zip = character({
    id: 'char-vera',
    name: 'Vera',
    createdAt: '2026-05-05T00:00:00.000Z',
    scenePath: `${DEST}/daz3d/primary/Vera.duf`,
    extraScenes: [`${DEST}/daz3d/yoga/Vera_Yoga.duf`, `${DEST}/daz3d/beach/Vera_Beach.duf`],
    houdiniProjects: [`${DEST}/houdini/Vera.hip`, `${DEST}/houdini/Vera_Face.hip`],
    imageScene: `${DEST}/daz3d/yoga/Vera_Yoga.duf`,
    sceneOverrides: [
      { scenePath: `${DEST}/daz3d/primary/Vera.duf`, hair: [{ nodeLabel: 'Vera Hair' }] },
      { scenePath: `${DEST}/daz3d/yoga/Vera_Yoga.duf`, hair: [{ nodeLabel: 'Yoga Hair' }] },
    ],
    preserveMorphs: [{ name: 'zipMorph', keepValue: 1 }],
    sections: {
      FBM: {
        enabled: true,
        mode: 'custom',
        groups: [{ id: 'g1', label: 'Zip', poses: [{ id: 'p1', name: 'ZipPose', morphs: [] }] }],
      },
      GEN: { enabled: true, presetAssets: ['GP'] },
    },
  })
  const target = character({
    id: 'char-kira',
    name: 'Kira',
    preserveMorphs: [{ name: 'targetMorph', keepValue: 0.5 }],
    sections: {
      FBM: {
        enabled: true,
        mode: 'custom',
        groups: [{ id: 'g2', label: 'Mine', poses: [{ id: 'p2', name: 'MinePose', morphs: [] }] }],
      },
      JCM: { enabled: true, mode: 'preset' },
      GEN: { enabled: false, presetAssets: [] },
    },
  })
  const baseChoices = {
    name: 'Vera',
    sections: ['FBM'] as Array<'FBM'>,
    extras: { jcmRules: true, preserveMorphs: true, preserveNodeTransforms: true },
    scenes: [
      `${DEST}/daz3d/primary/Vera.duf`,
      `${DEST}/daz3d/yoga/Vera_Yoga.duf`,
      `${DEST}/daz3d/beach/Vera_Beach.duf`,
    ],
    houdini: {
      mode: 'overwrite' as const,
      projects: [`${DEST}/houdini/Vera.hip`, `${DEST}/houdini/Vera_Face.hip`],
    },
  }

  it('the entity persists (id + createdAt), the zip is the base, the name is the choice', () => {
    const merged = mergeImportedCharacter({
      zip,
      target,
      choices: { ...baseChoices, name: 'Vera Restored' },
      keptHoudini: [],
    })
    expect(merged.id).toBe('char-kira')
    expect(merged.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(merged.name).toBe('Vera Restored')
    expect(merged.scenePath).toBe(`${DEST}/daz3d/primary/Vera.duf`)
  })

  it('checked sections take the zip config, unchecked keep the target’s — GEN plumbing follows the zip', () => {
    const merged = mergeImportedCharacter({ zip, target, choices: baseChoices, keptHoudini: [] })
    expect(merged.sections.FBM.groups[0].label).toBe('Zip')
    // JCM was not checked — the target's enabled preset survives.
    expect(merged.sections.JCM.enabled).toBe(true)
    expect(merged.sections.JCM.mode).toBe('preset')
    // GEN's scene-derived plumbing is the ZIP's (its scene is now primary).
    expect(merged.sections.GEN.enabled).toBe(true)
    expect(merged.sections.GEN.presetAssets).toEqual(['GP'])
  })

  it('unchecked extras keep the target’s tuning', () => {
    const merged = mergeImportedCharacter({
      zip,
      target,
      choices: { ...baseChoices, extras: { ...baseChoices.extras, preserveMorphs: false } },
      keptHoudini: [],
    })
    expect(merged.preserveMorphs).toEqual([{ name: 'targetMorph', keepValue: 0.5 }])
  })

  it('deselected scenes drop their files’ refs, per-scene records and the avatar-source link', () => {
    const merged = mergeImportedCharacter({
      zip,
      target,
      choices: {
        ...baseChoices,
        scenes: [`${DEST}/daz3d/primary/Vera.duf`, `${DEST}/daz3d/beach/Vera_Beach.duf`],
      },
      keptHoudini: [],
    })
    expect(merged.extraScenes).toEqual([`${DEST}/daz3d/beach/Vera_Beach.duf`])
    expect(merged.sceneOverrides.map((o) => o.scenePath)).toEqual([
      `${DEST}/daz3d/primary/Vera.duf`,
    ])
    // imageScene pointed at the deselected yoga scene — dropped.
    expect(merged.imageScene).toBe('')
  })

  it('houdini add keeps an outside link once, even when the zip names the same file', () => {
    // The api layer feeds the target's OUTSIDE-linked projects through
    // keptHoudini (their files are never touched by the teardown, but the
    // merge keeps exactly what this list carries). A zip selection naming the
    // same outside file must not duplicate the ref.
    const outside = 'D:/Templates/G9_Skin_Base.hiplc'
    const zipWithOutside = { ...zip, houdiniProjects: [`${DEST}/houdini/Vera.hip`, outside] }
    const merged = mergeImportedCharacter({
      zip: zipWithOutside,
      target,
      choices: {
        ...baseChoices,
        houdini: { mode: 'add', projects: [`${DEST}/houdini/Vera.hip`, outside] },
      },
      keptHoudini: [outside],
    })
    expect(merged.houdiniProjects).toEqual([outside, `${DEST}/houdini/Vera.hip`])
  })

  it('houdini add keeps the target’s projects beside the zip’s; overwrite takes the selection only', () => {
    const kept = [`${DEST}/houdini/Kira.hip`]
    const added = mergeImportedCharacter({
      zip,
      target,
      choices: { ...baseChoices, houdini: { mode: 'add', projects: [`${DEST}/houdini/Vera.hip`] } },
      keptHoudini: kept,
    })
    expect(added.houdiniProjects).toEqual([`${DEST}/houdini/Kira.hip`, `${DEST}/houdini/Vera.hip`])
    const overwritten = mergeImportedCharacter({
      zip,
      target,
      choices: {
        ...baseChoices,
        houdini: { mode: 'overwrite', projects: [`${DEST}/houdini/Vera_Face.hip`] },
      },
      keptHoudini: [],
    })
    expect(overwritten.houdiniProjects).toEqual([`${DEST}/houdini/Vera_Face.hip`])
  })
})
