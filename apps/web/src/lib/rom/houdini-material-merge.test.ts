import { describe, expect, it } from 'vitest'

import {
  mergeTouchCount,
  planSurfaceMerge,
  surfaceLabel,
  type MergeSlot,
} from './houdini-material-merge.ts'

/**
 * The fixtures are REAL, read out of the two projects the bug was reported
 * against with hython (DazToHue 2.5 / Houdini 22.0.368):
 *
 *   source  KiraDefault_G9_GP.hiplc  /obj/DazToHue/DazToHueMaterial  (7 slots)
 *   target  PlaygroundAssets_Ita.hiplc  /obj/DazToHue/DazToHueMaterial (25 slots)
 *
 * The 25-slot target is the node that "Replace at target" reduced to 1, so the
 * worked example in the issue is the first case below — a made-up fixture would
 * not have proved anything about it.
 */

const surface = (name: string): string => `@fbx_material_name=${name}`
const slot = (name: string, ...surfaces: Array<string>): MergeSlot => ({
  name,
  surfaces: surfaces.map(surface),
})

/** Kira's material node — the source a user copies a skin from. */
const KIRA_SLOTS: Array<MergeSlot> = [
  slot('EyeOcclusion', 'EyeOcclusion'),
  slot('Tear', 'Tear'),
  slot('Eyes', 'RightEye', 'LeftEye'),
  slot(
    'Skin',
    'Body',
    'Fingernails',
    'Toenails',
    'Legs',
    'MouthCavity',
    'Arms',
    'Head',
    'GPTorso',
    'GPVagina',
    'GPLabiaMinora',
    'GPUrethra',
    'GPRectum',
    'GPTorsoBack',
    'Mouth',
    'Teeth',
  ),
  slot('Dress', 'Dress'),
  slot('YogaPants', 'Trousers', 'Waist'),
  slot(
    'HighBoots',
    'Eyelets',
    'Lace',
    'Inside',
    'BaseLeather',
    'Overlays',
    'SoleBase',
    'SoleBottom',
  ),
]

/** Ita's node: a raw import, one slot per Daz surface, no bakers. */
const ITA_SLOTS: Array<MergeSlot> = [
  'ShirtEdge',
  'Shirt',
  'Trousers',
  'Waist',
  'Fingernails',
  'Toenails',
  'Legs',
  'MouthCavity',
  'Arms',
  'Head',
  'Body',
  'GPTorso',
  'GPVagina',
  'GPLabiaMinora',
  'GPUrethra',
  'GPRectum',
  'GPTorsoBack',
  'Body1',
  'Body2',
  'RightEye',
  'Mouth',
  'Teeth',
  'Tear',
  'LeftEye',
  'EyeOcclusion',
].map((name) => slot(name, name))

const skinOnly = KIRA_SLOTS.filter((s) => s.name === 'Skin')

describe('planSurfaceMerge', () => {
  it('replaces exactly the slots whose surfaces the incoming skin claims', () => {
    const plan = planSurfaceMerge(ITA_SLOTS, skinOnly)

    // The 15 surfaces `Skin` merges, and nothing else.
    expect(plan.evicted).toEqual([
      'Fingernails',
      'Toenails',
      'Legs',
      'MouthCavity',
      'Arms',
      'Head',
      'Body',
      'GPTorso',
      'GPVagina',
      'GPLabiaMinora',
      'GPUrethra',
      'GPRectum',
      'GPTorsoBack',
      'Mouth',
      'Teeth',
    ])
    expect(plan.trimmed).toEqual([])
    // Every surface the skin claims already existed at the target — this is the
    // same figure, so nothing is left over.
    expect(plan.unclaimed).toEqual([])
  })

  it('leaves the clothing and eye slots alone — the outcome the issue asks for', () => {
    const plan = planSurfaceMerge(ITA_SLOTS, skinOnly)
    const survivors = ITA_SLOTS.filter((s) => !plan.evicted.includes(s.name)).map((s) => s.name)

    expect(survivors).toEqual([
      'ShirtEdge',
      'Shirt',
      'Trousers',
      'Waist',
      'Body1',
      'Body2',
      'RightEye',
      'Tear',
      'LeftEye',
      'EyeOcclusion',
    ])
    // 25 - 15 evicted + 1 installed. Not 1 (replace), and not 26 (append).
    expect(ITA_SLOTS.length - plan.evicted.length + skinOnly.length).toBe(11)
  })

  it('copying the whole node keeps only what the target claims alone', () => {
    const plan = planSurfaceMerge(ITA_SLOTS, KIRA_SLOTS)
    const survivors = ITA_SLOTS.filter((s) => !plan.evicted.includes(s.name)).map((s) => s.name)

    expect(survivors).toEqual(['ShirtEdge', 'Shirt', 'Body1', 'Body2'])
    // Kira wears a dress and boots that Ita does not — ordinary, and reported
    // rather than silently installed as slots claiming nothing.
    expect(plan.unclaimed.map(surfaceLabel)).toEqual([
      'Dress',
      'Eyelets',
      'Lace',
      'Inside',
      'BaseLeather',
      'Overlays',
      'SoleBase',
      'SoleBottom',
    ])
  })

  it('trims a slot that claims a mix of taken and untaken surfaces', () => {
    const target = [slot('Torso', 'Body', 'Head', 'Shirt'), slot('Boots', 'SoleBase')]
    const plan = planSurfaceMerge(target, [slot('Skin', 'Body', 'Head')])

    // `Torso` still claims `Shirt`, which nothing else does — dropping it whole
    // would orphan that surface.
    expect(plan.trimmed).toEqual(['Torso'])
    expect(plan.evicted).toEqual([])
  })

  it('evicts a name collision even when the surfaces do not overlap', () => {
    // Two slots called `Skin` render one material name (`MI_Skin`); a baker
    // naming it could resolve to either.
    const plan = planSurfaceMerge([slot('Skin', 'OldBody')], [slot('Skin', 'Body')])

    expect(plan.evicted).toEqual(['Skin'])
    expect(plan.trimmed).toEqual([])
    expect(plan.unclaimed.map(surfaceLabel)).toEqual(['Body'])
  })

  it('leaves an untouched target completely alone', () => {
    const plan = planSurfaceMerge(
      [slot('Shirt', 'Shirt'), slot('Trousers', 'Trousers')],
      [slot('Skin', 'Body')],
    )

    expect(plan).toEqual({ evicted: [], trimmed: [], unclaimed: [surface('Body')] })
    expect(mergeTouchCount(plan)).toBe(0)
  })

  it('never deletes a slot that claimed nothing to begin with', () => {
    // An empty group is "emptied by the merge" only if it had something to
    // lose. A blank slot the user made is theirs, not this rule's business.
    const plan = planSurfaceMerge([{ name: 'Placeholder', surfaces: [] }], [slot('Skin', 'Body')])

    expect(plan.evicted).toEqual([])
    expect(plan.trimmed).toEqual([])
  })

  it('does not expand a pattern token, so it evicts nothing', () => {
    // `@fbx_material_name=GP*` would match GPTorso in Houdini, but this rule
    // compares tokens verbatim. Wrong direction to guess in: a missed eviction
    // leaves a visible duplicate, a wrong one deletes the user's work.
    const plan = planSurfaceMerge([slot('Genitals', 'GP*')], [slot('Skin', 'GPTorso')])

    expect(plan.evicted).toEqual([])
    expect(plan.trimmed).toEqual([])
  })

  it('reports every incoming surface as unclaimed when the figures differ', () => {
    // What copying a Genesis 9 skin onto a node built from another figure would
    // look like. The studio has NOT measured how the generations name their
    // surfaces, so this is a symptom, not a generation check.
    const plan = planSurfaceMerge(
      [slot('Torso', 'G8Torso'), slot('Face', 'G8Face')],
      [slot('Skin', 'Body', 'Head')],
    )

    expect(plan.evicted).toEqual([])
    expect(plan.trimmed).toEqual([])
    expect(plan.unclaimed.map(surfaceLabel)).toEqual(['Body', 'Head'])
  })

  it('counts an incoming surface as claimed even when its slot is only trimmed', () => {
    const plan = planSurfaceMerge([slot('Mixed', 'Body', 'Shirt')], [slot('Skin', 'Body')])

    expect(plan.trimmed).toEqual(['Mixed'])
    expect(plan.unclaimed).toEqual([])
  })
})

describe('surfaceLabel', () => {
  it('reads the surface out of a group expression', () => {
    expect(surfaceLabel('@fbx_material_name=GPLabiaMinora')).toBe('GPLabiaMinora')
  })

  it('shows an unrecognised token exactly as it is', () => {
    // Honest rendering of something this code does not understand — better than
    // a confident mis-parse.
    expect(surfaceLabel('Body')).toBe('Body')
    expect(surfaceLabel('@group')).toBe('@group')
  })
})
