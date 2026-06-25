import { describe, expect, it } from 'vitest'

import { cleanMorphName, posesFromDazCsv } from './daz-csv'

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
          { node: 'Genesis9', prop: 'Lycan9_head_bs_Head_HD4', value: -1 },
          { node: 'Genesis9', prop: 'Lycan9_body_bs_Body', value: 1 },
        ],
      },
      {
        frame: 384,
        name: 'AnconeusL',
        morphs: [{ node: 'Genesis9', prop: 'xMusc_body_bs_AnconeusL_B_HD2', value: 1 }],
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
})
