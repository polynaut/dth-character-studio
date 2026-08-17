import { describe, expect, it } from 'vitest'

import {
  deriveScenesRootRel,
  hipAnchorDirs,
  hipRefPrefixFor,
  sceneDeleteTargets,
  sceneSubfolderConflict,
  suggestSceneSubfolder,
} from './scene-subfolder'

describe('suggestSceneSubfolder', () => {
  it('drops the character name and generation markers, keeps the identity', () => {
    expect(suggestSceneSubfolder('X:\\scenes\\Electra_G9_Beach Armor.duf', 'Electra')).toBe(
      'Beach_Armor',
    )
    expect(suggestSceneSubfolder('X:\\scenes\\Kira_Genesis8.1_Casual.duf', 'Kira')).toBe('Casual')
    expect(suggestSceneSubfolder('X:\\scenes\\genesis9_armor.duf', 'Electra')).toBe('armor')
  })

  it('drops the DTH noise words (gen, golden palace, dicktator, dqs, gp/dk)', () => {
    expect(suggestSceneSubfolder('X:\\s\\Ita_G9_GoldenPalace_Beach.duf', 'Ita')).toBe('Beach')
    expect(suggestSceneSubfolder('X:\\s\\Rok_DQS_Dicktator_Gym.duf', 'Rok')).toBe('Gym')
    expect(suggestSceneSubfolder('X:\\s\\Ita_gen_gp_dk_Party.duf', 'Ita')).toBe('Party')
  })

  it('matches the character name case-insensitively and mid-word (squeezed variants)', () => {
    expect(suggestSceneSubfolder('X:\\s\\electraG9Armor.duf', 'Electra')).toBe('Armor')
  })

  it('never returns empty — a scene named purely after the character falls back', () => {
    expect(suggestSceneSubfolder('X:\\s\\Electra_G9.duf', 'Electra')).toBe('scene')
    expect(suggestSceneSubfolder('', 'Electra')).toBe('scene')
  })

  it('strips filesystem-illegal characters', () => {
    expect(suggestSceneSubfolder('X:\\s\\What_Is: This?.duf', 'Y')).toBe('What_Is_This')
  })
})

describe('sceneDeleteTargets — what "Delete file on disk" removes', () => {
  const CHAR = 'D:/DTH Projects/Demo/Kira'

  it('a scene in its own subfolder loses the whole folder (rom-animations included)', () => {
    expect(
      sceneDeleteTargets({
        sceneAbs: `${CHAR}/daz3d/beach/Beach.duf`,
        charFolderAbs: CHAR,
        scenesRootRel: 'daz3d',
        remainingScenesAbs: [`${CHAR}/daz3d/primary/Kira.duf`],
      }),
    ).toEqual({ folders: [`${CHAR}/daz3d/beach`], files: [] })
  })

  it('the primary in its "primary" subfolder is a folder delete too', () => {
    expect(
      sceneDeleteTargets({
        sceneAbs: `${CHAR}/daz3d/primary/Kira.duf`,
        charFolderAbs: CHAR,
        scenesRootRel: 'daz3d',
        remainingScenesAbs: [`${CHAR}/daz3d/beach/Beach.duf`],
      }),
    ).toEqual({ folders: [`${CHAR}/daz3d/primary`], files: [] })
  })

  it('a legacy scene directly in the scenes root deletes its files + its own ROM animation only', () => {
    const scene = `${CHAR}/daz3d/Kira.duf`
    expect(
      sceneDeleteTargets({
        sceneAbs: scene,
        charFolderAbs: CHAR,
        scenesRootRel: 'daz3d',
        remainingScenesAbs: [],
      }),
    ).toEqual({
      folders: [],
      files: [
        scene,
        `${scene}.png`,
        `${scene}.tip.png`,
        `${CHAR}/daz3d/Kira.tip.png`,
        `${CHAR}/daz3d/rom-animations/Kira_ROM.duf`,
        `${CHAR}/daz3d/rom-animations/Kira_ROM.duf.png`,
      ],
    })
  })

  it('a folder another linked scene lives in is never deleted (falls back to files)', () => {
    const shared = sceneDeleteTargets({
      sceneAbs: `${CHAR}/daz3d/outfits/Beach.duf`,
      charFolderAbs: CHAR,
      scenesRootRel: 'daz3d',
      remainingScenesAbs: [`${CHAR}/daz3d/outfits/City.duf`],
    })
    expect(shared.folders).toEqual([])
    expect(shared.files).toContain(`${CHAR}/daz3d/outfits/Beach.duf`)
    // A remaining scene NESTED below the dir blocks the same way, case- and
    // separator-insensitively (Windows paths).
    expect(
      sceneDeleteTargets({
        sceneAbs: `${CHAR}/daz3d/outfits/Beach.duf`,
        charFolderAbs: CHAR,
        scenesRootRel: 'daz3d',
        remainingScenesAbs: ['D:\\DTH PROJECTS\\Demo\\Kira\\daz3d\\OUTFITS\\deep\\City.duf'],
      }).folders,
    ).toEqual([])
  })

  it('a sibling folder that merely shares the name prefix does not block', () => {
    expect(
      sceneDeleteTargets({
        sceneAbs: `${CHAR}/daz3d/beach/Beach.duf`,
        charFolderAbs: CHAR,
        scenesRootRel: 'daz3d',
        remainingScenesAbs: [`${CHAR}/daz3d/beachhouse/House.duf`],
      }).folders,
    ).toEqual([`${CHAR}/daz3d/beach`])
  })

  it('a linked-in-place scene (outside the character folder) never yields a folder', () => {
    expect(
      sceneDeleteTargets({
        sceneAbs: 'X:/My Scenes/own/Original.duf',
        charFolderAbs: CHAR,
        scenesRootRel: 'daz3d',
        remainingScenesAbs: [],
      }).folders,
    ).toEqual([])
  })

  it('an empty scenes root anchors at the character folder — subfolder yes, root itself no', () => {
    expect(
      sceneDeleteTargets({
        sceneAbs: `${CHAR}/primary/Kira.duf`,
        charFolderAbs: CHAR,
        scenesRootRel: '',
        remainingScenesAbs: [],
      }).folders,
    ).toEqual([`${CHAR}/primary`])
    expect(
      sceneDeleteTargets({
        sceneAbs: `${CHAR}/Kira.duf`,
        charFolderAbs: CHAR,
        scenesRootRel: '',
        remainingScenesAbs: [],
      }).folders,
    ).toEqual([])
  })

  it('normalizes backslash inputs to forward slashes', () => {
    expect(
      sceneDeleteTargets({
        sceneAbs: 'D:\\DTH Projects\\Demo\\Kira\\daz3d\\beach\\Beach.duf',
        charFolderAbs: 'D:\\DTH Projects\\Demo\\Kira',
        scenesRootRel: 'daz3d',
        remainingScenesAbs: [],
      }).folders,
    ).toEqual([`${CHAR}/daz3d/beach`])
  })
})

describe('deriveScenesRootRel', () => {
  it('uses the project dazSubdir prefix when the primary sits under it', () => {
    expect(deriveScenesRootRel('daz3d/primary', 'daz3d')).toBe('daz3d')
    expect(deriveScenesRootRel('daz3d', 'daz3d')).toBe('daz3d') // legacy: primary in the root
    expect(deriveScenesRootRel('DAZ3D/primary', 'daz3d')).toBe('DAZ3D') // case survives
  })

  it('strips a trailing "primary" segment for a renamed root', () => {
    expect(deriveScenesRootRel('scenes/primary', 'daz3d')).toBe('scenes')
    expect(deriveScenesRootRel('scenes/PRIMARY', 'daz3d')).toBe('scenes')
  })

  it('falls back to the primary dir itself (legacy custom root)', () => {
    expect(deriveScenesRootRel('scenes', 'daz3d')).toBe('scenes')
    expect(deriveScenesRootRel('', 'daz3d')).toBe('')
  })
})

describe('hipAnchorDirs — where $HIP-relative reference paths can anchor', () => {
  it('returns the distinct folders of linked .hips INSIDE the character folder', () => {
    expect(
      hipAnchorDirs(
        [
          'D:/lib/Electra/houdini/Electra.hiplc',
          'D:\\lib\\Electra\\houdini\\Electra_v2.hiplc', // same folder, backslashes
          'D:/lib/Electra/archive/Old.hip', // hand-linked, still inside → anchors too
        ],
        'D:\\lib\\Electra',
      ),
    ).toEqual(['D:/lib/Electra/houdini', 'D:/lib/Electra/archive'])
  })

  it('a project linked OUTSIDE the character folder never anchors — the studio puts no junction in a tree it does not own', () => {
    expect(hipAnchorDirs(['E:/elsewhere/Electra.hip'], 'D:/lib/Electra')).toEqual([])
    // A sibling folder sharing the prefix as a STRING is still outside.
    expect(hipAnchorDirs(['D:/lib/Electra2/Electra.hip'], 'D:/lib/Electra')).toEqual([])
  })

  it('dedupes case-insensitively (Windows paths)', () => {
    expect(
      hipAnchorDirs(
        ['D:/lib/Electra/houdini/A.hiplc', 'd:/lib/electra/HOUDINI/B.hiplc'],
        'D:/lib/Electra',
      ),
    ).toEqual(['D:/lib/Electra/houdini'])
  })

  it('a .hip directly in the character folder anchors the folder itself', () => {
    expect(hipAnchorDirs(['D:/lib/Electra/Electra.hip'], 'D:/lib/Electra/')).toEqual([
      'D:/lib/Electra',
    ])
  })

  it('no projects / no folder → nothing anchors', () => {
    expect(hipAnchorDirs([], 'D:/lib/Electra')).toEqual([])
    expect(hipAnchorDirs(['D:/lib/Electra/houdini/A.hiplc'], '')).toEqual([])
  })
})

describe('hipRefPrefixFor — the $HIP/$JOB prefix that replaces the export root', () => {
  it('standard layout: the export root sits UNDER the .hip, so $HIP reaches it', () => {
    // Measured against Houdini itself (`hou.text.collapseCommonVars` on a real
    // project, 2026-08-10): this is the spelling its own file picker writes,
    // now that daz-export lives inside the houdini folder.
    expect(
      hipRefPrefixFor(['X:/p/Kira/houdini/K.hiplc'], 'X:/p/Kira', 'X:/p/Kira/houdini/daz-export'),
    ).toBe('$HIP/daz-export')
    // Backslash inputs (the stored Windows paths) resolve identically.
    expect(
      hipRefPrefixFor(
        ['X:\\p\\Kira\\houdini\\K.hiplc'],
        'X:\\p\\Kira',
        'X:\\p\\Kira\\houdini\\daz-export',
      ),
    ).toBe('$HIP/daz-export')
  })

  it('the export root IS the hip folder → bare $HIP, not a fallback to absolute', () => {
    expect(
      hipRefPrefixFor(['X:/p/Kira/houdini/K.hiplc'], 'X:/p/Kira', 'X:/p/Kira/houdini'),
    ).toBe('$HIP')
  })

  it('a DEEPER .hip still anchors on its own folder — $HIP names it, whatever the depth', () => {
    // $HIP encodes no `..` here: the exports are below the hip, not above it.
    // What matters is that all projects share ONE folder, not which folder.
    expect(
      hipRefPrefixFor(
        ['X:/p/Kira/houdini/variants/K.hiplc'],
        'X:/p/Kira',
        'X:/p/Kira/houdini/variants/daz-export',
      ),
    ).toBe('$HIP/daz-export')
  })

  it('exports beside the hip folder rather than under it → $JOB, the character folder', () => {
    // A pre-v0.68 layout: daz-export had not moved into houdini/ yet. $HIP would
    // have to climb out (`$HIP/../daz3d/…`) — depth-fragile, and Houdini itself
    // refuses to write it — so this tier keeps the v63 form.
    expect(
      hipRefPrefixFor(['X:/p/Kira/houdini/K.hiplc'], 'X:/p/Kira', 'X:/p/Kira/daz3d/dth-exports'),
    ).toBe('$JOB/daz3d/dth-exports')
  })

  it('two hips in DIFFERENT folders → $JOB, because there is no single $HIP', () => {
    // Two anchor folders are two different $HIPs; $JOB is the same folder for
    // both, so the depth-independent tier is what serves this case.
    expect(
      hipRefPrefixFor(
        ['X:/p/Kira/houdini/A.hiplc', 'X:/p/Kira/archive/B.hiplc'],
        'X:/p/Kira',
        'X:/p/Kira/houdini/daz-export',
      ),
    ).toBe('$JOB/houdini/daz-export')
  })

  it('two hips in the SAME folder keep the short form', () => {
    expect(
      hipRefPrefixFor(
        ['X:/p/Kira/houdini/A.hiplc', 'X:/p/Kira/houdini/B.hiplc'],
        'X:/p/Kira',
        'X:/p/Kira/houdini/daz-export',
      ),
    ).toBe('$HIP/daz-export')
  })

  it('no linked projects → absolute (nothing to write a project-relative path into)', () => {
    expect(hipRefPrefixFor([], 'X:/p/Kira', 'X:/p/Kira/houdini/daz-export')).toBe('')
  })

  it('a hip outside the character folder → absolute', () => {
    // Hand-linked in the user's own tree: its $JOB is whatever they set, so the
    // studio cannot assume it is this character's folder.
    expect(
      hipRefPrefixFor(['E:/elsewhere/K.hiplc'], 'X:/p/Kira', 'X:/p/Kira/houdini/daz-export'),
    ).toBe('')
  })

  it('an export root outside the character folder → absolute', () => {
    // $JOB IS the character folder, so nothing above or beside it has a
    // $JOB-relative form — cross-drive included.
    expect(hipRefPrefixFor(['X:/p/Kira/houdini/K.hiplc'], 'X:/p/Kira', 'Y:/exports/Kira')).toBe('')
    expect(
      hipRefPrefixFor(['X:/p/Kira/houdini/K.hiplc'], 'X:/p/Kira', 'X:/p/shared-exports'),
    ).toBe('')
  })
})

describe('sceneSubfolderConflict — names the studio already owns', () => {
  it('refuses the export folder, whatever its casing', () => {
    // A project can point dazSubdir and houdiniSubdir at the same folder (both
    // empty is the degenerate case), and then a scene subfolder named this would
    // land on the export root itself.
    expect(sceneSubfolderConflict('daz-export')).toContain('exports')
    expect(sceneSubfolderConflict('Daz-Export')).toContain('exports')
  })

  it('refuses the PRE-MOVE name too, while un-migrated characters can still have one', () => {
    // A character only moves off `<daz>/dth-exports` on its next save; until
    // then that folder is real and sits exactly where scene subfolders do.
    expect(sceneSubfolderConflict('dth-exports')).toContain('exports')
    expect(sceneSubfolderConflict('DTH-Exports')).toContain('exports')
  })

  it('allows an ordinary name', () => {
    expect(sceneSubfolderConflict('summertide')).toBe('')
    expect(sceneSubfolderConflict('primary')).toBe('')
    // Only a WHOLE segment is reserved — a longer name merely containing it is fine.
    expect(sceneSubfolderConflict('daz-export-old')).toBe('')
  })

  it('judges the FIRST segment — the one landing under the scenes root', () => {
    expect(sceneSubfolderConflict('daz-export/beach')).toContain('exports')
    // Nested deeper, it collides with nothing the studio writes.
    expect(sceneSubfolderConflict('outfits/daz-export')).toBe('')
  })

  it('ignores leading separators and empty input', () => {
    expect(sceneSubfolderConflict('/daz-export')).toContain('exports')
    expect(sceneSubfolderConflict('\\daz-export')).toContain('exports')
    expect(sceneSubfolderConflict('')).toBe('')
  })
})
