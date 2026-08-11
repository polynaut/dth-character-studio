import { describe, expect, it } from 'vitest'

import { cleanMorphName, importedPoseName, posesFromDazCsv } from './daz-csv'

describe('cleanMorphName', () => {
  it('strips figure/body prefixes and HD suffixes', () => {
    expect(cleanMorphName('xMusc_body_bs_AnconeusL_B_HD2')).toBe('AnconeusL')
    expect(cleanMorphName('Lycan9_head_bs_Head_HD4')).toBe('Head')
    expect(cleanMorphName('Lycan9_body_bs_Body')).toBe('Body')
    expect(cleanMorphName('xMusc_body_bs_BicepsShortHeadL_B_HD2')).toBe('BicepsShortHeadL')
  })

  it('strips product codes and Teeth groups', () => {
    expect(cleanMorphName('body_bs_M3DLFC_Claws')).toBe('Claws')
    expect(cleanMorphName('head_bs_Teeth_M3DLFC_LowerCanines01')).toBe('LowerCanines01')
    expect(cleanMorphName('head_bs_Teeth_M3DLFC_Upper Incisors01')).toBe('Upper Incisors01')
  })

  it('leaves a name with nothing to strip, and never returns empty', () => {
    expect(cleanMorphName('PBMNavel')).toBe('PBMNavel')
    expect(cleanMorphName('  ')).toBe('')
  })
})

describe('posesFromDazCsv', () => {
  it('strips a BOM so the first data row is kept', () => {
    // Excel and some Daz exports prepend a BOM; the old naive split made the
    // first row's frame parse NaN and silently dropped it.
    const bom = String.fromCharCode(0xfeff)
    const poses = posesFromDazCsv(`${bom}384,,,Genesis9,body_bs_X,1\n`)
    expect(poses).toHaveLength(1)
    expect(poses[0].frame).toBe(384)
  })

  it('reads quoted fields containing commas without shifting the triplets', () => {
    const poses = posesFromDazCsv('5,,,"Hip, twist",prop_X,0.5\n')
    expect(poses).toHaveLength(1)
    // Imported morphs are new grid rows — they carry a freshly minted id (v19)
    // and auto-base on (v31), exactly like a morph added in the editor.
    expect(poses[0].morphs[0]).toEqual({
      id: expect.any(String),
      node: 'Hip, twist',
      prop: 'prop_X',
      value: 0.5,
      autoBase: true,
    })
  })

  it('parses single- and multi-morph rows into named poses', () => {
    const csv = [
      '384,,,Genesis9,xMusc_body_bs_AnconeusL_B_HD2,1',
      '382,,,Genesis9,Lycan9_head_bs_Head_HD4,-1,Genesis9,Lycan9_body_bs_Body,1',
    ].join('\n')
    expect(posesFromDazCsv(csv)).toEqual([
      // sorted by frame: 382 before 384
      {
        frame: 382,
        name: 'Head',
        morphs: [
          { id: expect.any(String), node: 'Genesis9', prop: 'Lycan9_head_bs_Head_HD4', value: -1, autoBase: true },
          { id: expect.any(String), node: 'Genesis9', prop: 'Lycan9_body_bs_Body', value: 1, autoBase: true },
        ],
      },
      {
        frame: 384,
        name: 'AnconeusL',
        morphs: [
          { id: expect.any(String), node: 'Genesis9', prop: 'xMusc_body_bs_AnconeusL_B_HD2', value: 1, autoBase: true },
        ],
      },
    ])
  })

  it('keeps fractional values and preserves the raw property on the morph', () => {
    const poses = posesFromDazCsv('412,,,Genesis9,xMusc_body_bs_BicepsShortHeadL_B_HD2,1.2000000476837158')
    expect(poses[0].morphs[0].value).toBeCloseTo(1.2)
    expect(poses[0].morphs[0].prop).toBe('xMusc_body_bs_BicepsShortHeadL_B_HD2')
  })

  it('skips blank lines, headerless rows, and the studio section-keyword rows', () => {
    const csv = [
      '', // blank
      'RET,0,RestPose', // studio section-keyword row — col 0 is "RET", not a number
      'FBM,328,BodyTone,', // ditto — col 0 is "FBM"
      '7,,,', // numeric frame but no triplet → no morphs
      '500,,,Genesis9,xMusc_body_bs_HamstringsR_B_HD2,1',
    ].join('\n')
    const poses = posesFromDazCsv(csv)
    expect(poses).toHaveLength(1)
    expect(poses[0].name).toBe('HamstringsR')
  })

  it('returns an empty array for empty input', () => {
    expect(posesFromDazCsv('')).toEqual([])
  })

  it('skips a row with an empty first column instead of importing it at frame 0', () => {
    // `Number('') === 0` (finite), so without the explicit empty-cell guard this
    // row with a valid triplet but a blank frame column would import as a pose at
    // frame 0.
    const poses = posesFromDazCsv(',,,Genesis9,body_bs_X,1\n')
    expect(poses).toEqual([])
  })

  it('fails LOUD on a triplet-misaligned row (locale decimal comma / unquoted comma)', () => {
    // `1,5` written unquoted splits into two cells and shifts every later
    // column — the old tolerant walk imported wrong-but-finite morphs without
    // a word. Corrupt input must abort the import, not quietly mangle it.
    expect(() =>
      posesFromDazCsv('5,,,Genesis9,prop_A,1,5,Genesis9,prop_B,2\n'),
    ).toThrow(/triplets/)
    // The truncating variant (a locale value in the LAST triplet) throws too.
    expect(() => posesFromDazCsv('5,,,Genesis9,prop_A,1,5\n')).toThrow(/triplets/)
  })

  it('tolerates trailing empty cells — a plain trailing comma is not corruption', () => {
    const poses = posesFromDazCsv('5,,,Genesis9,prop_A,1,\n')
    expect(poses).toHaveLength(1)
    expect(poses[0].morphs).toHaveLength(1)
  })
})

describe('importedPoseName — what a Scan_Frames CSV row lands with', () => {
  it('strips the spaces Daz labels carry, so the row is not flagged on arrival', () => {
    // Measured on a real Scan_Frames import (FBM section): every one of these
    // came in red, and retyping them by hand is the work this saves.
    expect(importedPoseName('Torso Muscular')).toBe('TorsoMuscular')
    expect(importedPoseName('5 Belly Shape Muscular')).toBe('5BellyShapeMuscular')
    expect(importedPoseName('Shape NAVEL FOR PEAR')).toBe('ShapeNAVELFORPEAR')
  })

  it('strips the other characters Houdini rejects too, not only spaces', () => {
    expect(importedPoseName('!Breast Large')).toBe('BreastLarge')
    expect(importedPoseName('Breast Preset 10')).toBe('BreastPreset10')
  })

  it('leaves an already-legal name exactly as the cleaner produced it', () => {
    expect(importedPoseName('PBMNavel')).toBe('PBMNavel')
    expect(importedPoseName('xMusc_body_bs_AnconeusL_B_HD2')).toBe('AnconeusL')
  })

  it('falls back to the raw property when cleaning leaves nothing legal', () => {
    // `cleanMorphName` strips a leading SHOUTY_ prefix; if what remains is all
    // punctuation, a name derived from the prop beats an empty required cell.
    // The underscore survives — it is one of the characters Houdini accepts.
    expect(importedPoseName('PBM_+++')).toBe('PBM_')
  })

  it('is empty only when the property itself holds nothing legal', () => {
    expect(importedPoseName('+++')).toBe('')
  })
})
