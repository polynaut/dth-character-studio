import { describe, expect, it } from 'vitest'

import {
  assetSlotName,
  bakerChannelFor,
  buildMaterialPlan,
  canDiffProject,
  deadBakerGroups,
  diffExportAgainstSlots,
  parseDthSurfaces,
  planHasFindings,
  planMaterialSetup,
  slotNameFor,
  surfaceClaim,
  type ClaimedSlot,
  type ExportSurface,
  type MaterialPlanNode,
  type MaterialPlanProject,
  type ScannedProjectView,
} from './material-plan.ts'

/**
 * The fixture is REAL — a trimmed slice of a shipped export, not an invention:
 *
 *   D:/…/LaraCroft_G81/houdini/daz-export/primary/LaraCroft_G81.dth
 *   DTH 2.0.2, 32 surfaces, read 2026-08-14
 *
 * Nine surfaces are kept, chosen to cover every branch of the grouping rule
 * (figure, eye stack, tear, a fitted graft, two wardrobe assets, an attachment),
 * and each keeps only its TEXTURED properties — a real entry carries 117, of
 * which the parser drops the 113 with no map. Texture paths have the Daz library
 * root replaced by `$DAZLIB` so the fixture is not one machine's install.
 *
 * The claims in `LARA_CLASSIC_CLAIMS` are equally real: the `material_group`
 * values of `laracroft_g81.hiplc` / network box `LaraClassic`, as the studio's
 * own scan store recorded them.
 */
const EXPORT = {
  Materials: [
    {
      'Asset Name': 'Genesis8_1Female',
      'Asset Label': 'Genesis 8.1 Female',
      'Material Name': 'Body',
      'Material Type': 'Iray Uber',
      Value: 'Actor/Character',
      Properties: [
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/rypig81f3_torsod.jpg' },
        { Name: 'Translucency Color', 'Data Type': 'Color', Texture: '$DAZLIB/rypig81f3_torsod.jpg' },
        {
          Name: 'Dual Lobe Specular Reflectivity',
          'Data Type': 'Double',
          Texture: '$DAZLIB/rypig81f3_torsos.jpg',
        },
        { Name: 'Bump Strength', 'Data Type': 'Double', Texture: '$DAZLIB/rypig81f3_torsob.jpg' },
      ],
    },
    {
      'Asset Name': 'Genesis8_1Female',
      'Asset Label': 'Genesis 8.1 Female',
      'Material Name': 'Face',
      'Material Type': 'Iray Uber',
      Value: 'Actor/Character',
      Properties: [
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/rypig81f3_face1d.jpg' },
        { Name: 'Bump Strength', 'Data Type': 'Double', Texture: '$DAZLIB/rypig81f3_face1b.jpg' },
      ],
    },
    {
      'Asset Name': 'Genesis8_1Female',
      'Asset Label': 'Genesis 8.1 Female',
      'Material Name': 'Pupils',
      // Measured: the eye stack really is a different shader on the same figure.
      'Material Type': 'PBRSkin',
      Value: 'Actor/Character',
      Properties: [
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/eyes_d.jpg' },
        { Name: 'Detail Normal Map', 'Data Type': 'Double', Texture: '$DAZLIB/eyes_n.jpg' },
      ],
    },
    {
      'Asset Name': 'Female_8_1_Tear',
      'Asset Label': 'Genesis 8.1 Female Tear',
      'Material Name': 'Tear',
      'Material Type': 'Iray Uber',
      Value: 'Follower/Attachment/Head/Face/Tears',
      Properties: [
        { Name: 'Cutout Opacity', 'Data Type': 'Double', Texture: '$DAZLIB/tear_o.jpg' },
      ],
    },
    {
      'Asset Name': 'Genesis8FemaleGenitalia',
      'Asset Label': 'Genesis 8 Female Genitalia',
      'Material Name': 'Genitalia',
      'Material Type': 'Iray Uber',
      Value: 'Follower/Attachment/Lower-Body/Hip/Front',
      Properties: [
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/genitalia_d.jpg' },
      ],
    },
    {
      'Asset Name': 'Boots_12736',
      'Asset Label': 'Boots',
      'Material Name': 'boots',
      'Material Type': 'Iray Uber',
      Value: 'Follower/Wardrobe',
      Properties: [
        { Name: 'Metallic Weight', 'Data Type': 'Double', Texture: '$DAZLIB/boots_m.jpg' },
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/boots_d.jpg' },
        // The same file on two channels — a real export does this, and the
        // baker's texture count must not double-count it.
        { Name: 'Bump Strength', 'Data Type': 'Double', Texture: '$DAZLIB/boots_d.jpg' },
        { Name: 'Normal Map', 'Data Type': 'Double', Texture: '$DAZLIB/boots_n.jpg' },
      ],
    },
    {
      'Asset Name': 'Boots_12736',
      'Asset Label': 'Boots',
      'Material Name': 'metal_1',
      'Material Type': 'Iray Uber',
      Value: 'Follower/Wardrobe',
      Properties: [
        { Name: 'Metallic Weight', 'Data Type': 'Double', Texture: '$DAZLIB/metal_m.jpg' },
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/metal_d.jpg' },
      ],
    },
    {
      'Asset Name': 'SaltBikini_Bra_2050',
      'Asset Label': 'Salt Bikini Bra',
      'Material Name': 'Bra',
      'Material Type': 'Iray Uber',
      Value: 'Follower/Wardrobe',
      Properties: [
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/bra_d.jpg' },
        // Real, and unmapped — the proposal must SAY so rather than drop it.
        { Name: 'Metallic Flakes Color', 'Data Type': 'Color', Texture: '$DAZLIB/bra_f.jpg' },
      ],
    },
    {
      'Asset Name': 'Bags_11509',
      'Asset Label': 'Backpack',
      'Material Name': 'backpack',
      'Material Type': 'Iray Uber',
      Value: 'Follower/Attachment',
      Properties: [
        { Name: 'Diffuse Color', 'Data Type': 'Color', Texture: '$DAZLIB/backpack_d.jpg' },
      ],
    },
  ],
}

const SURFACES = parseDthSurfaces(EXPORT)

/** Real claims off `laracroft_g81.hiplc` / `LaraClassic`, trimmed to the slots
 *  the fixture's surfaces can reach. `GPTorso` and `metal1` are verbatim what
 *  the project carries — a Golden Palace graft that was removed from the scene,
 *  and a claim that disagrees with the export's `metal_1`. */
const LARA_CLASSIC_CLAIMS: Array<ClaimedSlot> = [
  {
    displayName: 'MI_Skin',
    surfaces: ['Body', 'Face', 'GPTorso', 'GPVagina'].map(surfaceClaim),
  },
  { displayName: 'MI_Backpack', surfaces: [surfaceClaim('backpack')] },
  { displayName: 'MI_Bra', surfaces: [surfaceClaim('Bra')] },
  { displayName: 'MI_Metal', surfaces: [surfaceClaim('metal1')] },
]

describe('parseDthSurfaces', () => {
  it('reads a real export', () => {
    expect(SURFACES).toHaveLength(9)
    expect(SURFACES[0]).toMatchObject({
      surface: 'Body',
      asset: 'Genesis8_1Female',
      contentType: 'Actor/Character',
      shader: 'Iray Uber',
    })
  })

  it('keeps only textured channels', () => {
    const withUnmapped = parseDthSurfaces({
      Materials: [
        {
          'Material Name': 'x',
          Properties: [
            { Name: 'Diffuse Color', Texture: 'a.jpg' },
            { Name: 'Smooth Angle', Value: 89.9, Texture: '' },
            { Name: 'Glossy Color' },
          ],
        },
      ],
    })
    expect(withUnmapped[0].channels).toEqual([
      { daz: 'Diffuse Color', channel: 'Colour', texture: 'a.jpg' },
    ])
  })

  // Tolerance is the point: this parses a third-party file on a path where the
  // useful failure is an empty proposal, never a drawer that will not open.
  it.each([
    ['not an object', 42],
    ['no Materials key', { Character: 'x' }],
    ['Materials is not an array', { Materials: 'nope' }],
    ['null', null],
    ['undefined', undefined],
  ])('degrades to empty on %s', (_label, input) => {
    expect(parseDthSurfaces(input)).toEqual([])
  })

  it('skips entries with no surface name but keeps their neighbours', () => {
    const parsed = parseDthSurfaces({
      Materials: [{ 'Material Name': '' }, null, 'nope', { 'Material Name': 'Body' }],
    })
    expect(parsed.map((surface) => surface.surface)).toEqual(['Body'])
  })
})

describe('slotNameFor', () => {
  const bySurface = (name: string) =>
    SURFACES.find((surface) => surface.surface === name) as ExportSurface

  it('puts the figure and its fitted grafts in Skin', () => {
    expect(slotNameFor(bySurface('Body'), 'merged')).toBe('Skin')
    expect(slotNameFor(bySurface('Genitalia'), 'merged')).toBe('Skin')
  })

  // The one name heuristic in the module — the eye stack is `Actor/Character`
  // like the body, so content type alone would fold it into skin.
  it('splits the eye stack and the tear out of Skin', () => {
    expect(slotNameFor(bySurface('Pupils'), 'merged')).toBe('Eyes')
    expect(slotNameFor(bySurface('Tear'), 'merged')).toBe('Tear')
  })

  it('groups wardrobe per the chosen strategy', () => {
    expect(slotNameFor(bySurface('boots'), 'merged')).toBe('Clothing')
    expect(slotNameFor(bySurface('Bra'), 'merged')).toBe('Clothing')
    expect(slotNameFor(bySurface('boots'), 'perGarment')).toBe('Boots')
    expect(slotNameFor(bySurface('Bra'), 'perGarment')).toBe('SaltBikiniBra')
  })

  it('keeps an attachment out of the outfit in both strategies', () => {
    expect(slotNameFor(bySurface('backpack'), 'merged')).toBe('Bags')
    expect(slotNameFor(bySurface('backpack'), 'perGarment')).toBe('Bags')
  })

  // A figure naming its eyes something else falls through to the content-type
  // rule rather than to a guess — visible in the proposal, fixable by hand.
  it('falls back to the content type for an unknown eye name', () => {
    const exotic: ExportSurface = {
      surface: 'EyeBall',
      asset: 'SomeFigure',
      assetLabel: '',
      contentType: 'Actor/Character',
      shader: 'PBRSkin',
      channels: [],
    }
    expect(slotNameFor(exotic, 'merged')).toBe('Skin')
  })
})

describe('assetSlotName', () => {
  it.each([
    ['Boots_12736', 'Boots'],
    ['SaltBikini_Bra_2050', 'SaltBikiniBra'],
    ['Bags_11509', 'Bags'],
    ['Genesis8_1Female', 'Genesis8_1Female'.replace(/_\d+$/, '').split('_').join('')],
    ['', ''],
  ])('%s -> %s', (asset, expected) => {
    expect(assetSlotName(asset)).toBe(expected)
  })
})

describe('planMaterialSetup', () => {
  it('proposes the slots the export implies', () => {
    const plan = planMaterialSetup(SURFACES, 'merged')
    expect(plan.map((slot) => slot.name)).toEqual(['Skin', 'Eyes', 'Tear', 'Clothing', 'Bags'])
  })

  it('claims each surface exactly once, with the token a node stores', () => {
    const plan = planMaterialSetup(SURFACES, 'merged')
    const claims = plan.flatMap((slot) => slot.surfaces)
    expect(claims).toHaveLength(SURFACES.length)
    expect(new Set(claims).size).toBe(SURFACES.length)
    expect(plan[0].surfaces).toContain('@fbx_material_name=Body')
  })

  it('names bakers the way every measured project does', () => {
    const skin = planMaterialSetup(SURFACES, 'merged')[0]
    expect(skin.bakers.map((baker) => baker.name)).toEqual([
      'T_Skin_Colour',
      'T_Skin_Translucency',
      'T_Skin_Specular',
      'T_Skin_Bump',
    ])
  })

  it('sends one texture on two channels to two different bakers', () => {
    const boots = planMaterialSetup(SURFACES, 'perGarment').find((slot) => slot.name === 'Boots')
    // boots_d.jpg is on both Diffuse Color and Bump Strength. Those are separate
    // bakers, so it appears in each — the surfaces of ONE asset land in one slot
    // under perGarment, which is why metal_1's map is here too.
    expect(boots?.bakers.find((baker) => baker.channel === 'Colour')?.textures).toEqual([
      '$DAZLIB/boots_d.jpg',
      '$DAZLIB/metal_d.jpg',
    ])
    expect(boots?.bakers.find((baker) => baker.channel === 'Bump')?.textures).toEqual([
      '$DAZLIB/boots_d.jpg',
    ])
  })

  // The texture count IS the layer count a baker needs, so one map shared across
  // an outfit's surfaces must not be counted per surface.
  it('counts a texture shared by two surfaces on one channel once', () => {
    const shared = planMaterialSetup(
      parseDthSurfaces({
        Materials: ['front', 'back'].map((name) => ({
          'Material Name': name,
          'Asset Name': 'Dress_1',
          Value: 'Follower/Wardrobe',
          Properties: [{ Name: 'Diffuse Color', Texture: '$DAZLIB/dress_d.jpg' }],
        })),
      }),
      'merged',
    )
    expect(shared[0].surfaces).toHaveLength(2)
    expect(shared[0].bakers[0].textures).toEqual(['$DAZLIB/dress_d.jpg'])
  })

  it('merges wardrobe textures into one slot under the merged strategy', () => {
    const clothing = planMaterialSetup(SURFACES, 'merged').find((slot) => slot.name === 'Clothing')
    expect(clothing?.surfaces).toHaveLength(3)
    expect(clothing?.bakers.find((baker) => baker.channel === 'Colour')?.textures).toEqual([
      '$DAZLIB/boots_d.jpg',
      '$DAZLIB/metal_d.jpg',
      '$DAZLIB/bra_d.jpg',
    ])
  })

  // An unmapped channel is information, not noise: dropping it is how a channel
  // goes missing for a year.
  it('names textured channels it cannot map', () => {
    const clothing = planMaterialSetup(SURFACES, 'merged').find((slot) => slot.name === 'Clothing')
    expect(clothing?.unmappedChannels).toEqual([])
    expect(bakerChannelFor('Metallic Flakes Color')).toBe('Flakes')
    const unknown = planMaterialSetup(
      parseDthSurfaces({
        Materials: [
          {
            'Material Name': 'x',
            Value: 'Follower/Wardrobe',
            'Asset Name': 'Thing_1',
            Properties: [{ Name: 'Some Future Channel', Texture: 'z.jpg' }],
          },
        ],
      }),
      'merged',
    )
    expect(unknown[0].unmappedChannels).toEqual(['Some Future Channel'])
    expect(unknown[0].bakers).toEqual([])
  })

  it('reports a slot mixing shaders', () => {
    const eyes = planMaterialSetup(SURFACES, 'merged').find((slot) => slot.name === 'Eyes')
    expect(eyes?.shaders).toEqual(['PBRSkin'])
    const skin = planMaterialSetup(SURFACES, 'merged')[0]
    expect(skin.contentTypes).toEqual([
      'Actor/Character',
      'Follower/Attachment/Lower-Body/Hip/Front',
    ])
  })

  it('has nothing to say about an empty export', () => {
    expect(planMaterialSetup([], 'merged')).toEqual([])
  })
})

describe('diffExportAgainstSlots', () => {
  const diff = diffExportAgainstSlots(SURFACES, LARA_CLASSIC_CLAIMS)

  // The real finding this feature exists for: a Golden Palace graft removed
  // from the scene left five claims behind, and nothing in Houdini said so.
  it('finds claims the export does not back', () => {
    expect(diff.dead).toEqual([
      { claim: '@fbx_material_name=GPTorso', slot: 'MI_Skin' },
      { claim: '@fbx_material_name=GPVagina', slot: 'MI_Skin' },
      { claim: '@fbx_material_name=metal1', slot: 'MI_Metal' },
    ])
  })

  it('finds surfaces that arrive with no material', () => {
    expect(diff.unclaimed.map((surface) => surface.surface)).toEqual([
      'Pupils',
      'Tear',
      'Genitalia',
      'boots',
      'metal_1',
    ])
  })

  // Whether an unclaimed surface is a defect depends on intent, and only the
  // content type makes that legible — a "naked" variant leaving wardrobe
  // unclaimed is correct; leaving the eye stack unclaimed is a gap.
  it('carries the content type so intent stays legible', () => {
    expect(diff.unclaimed.find((surface) => surface.surface === 'boots')?.contentType).toBe(
      'Follower/Wardrobe',
    )
    expect(diff.unclaimed.find((surface) => surface.surface === 'Pupils')?.contentType).toBe(
      'Actor/Character',
    )
  })

  it('counts the agreement, not only the disagreement', () => {
    expect(diff.matched).toBe(4)
  })

  it('reports a node with no slots as claiming nothing', () => {
    const empty = diffExportAgainstSlots(SURFACES, [])
    expect(empty.unclaimed).toHaveLength(SURFACES.length)
    expect(empty.dead).toEqual([])
    expect(empty.matched).toBe(0)
  })

  // A pattern claim matches nothing here, so it reads as dead. That is a false
  // alarm in the SAFE direction — it points a human at a claim that may well
  // bind to nothing, rather than silently accepting it.
  it('treats a pattern claim as dead rather than resolving it', () => {
    const pattern = diffExportAgainstSlots(SURFACES, [
      { displayName: 'MI_GP', surfaces: ['@fbx_material_name=GP*'] },
    ])
    expect(pattern.dead).toEqual([{ claim: '@fbx_material_name=GP*', slot: 'MI_GP' }])
  })
})

describe('deadBakerGroups', () => {
  it('finds layer groups the export does not back', () => {
    expect(
      deadBakerGroups(SURFACES, [
        surfaceClaim('Body'),
        surfaceClaim('GPTorso'),
        surfaceClaim('boots'),
      ]),
    ).toEqual({ dead: [surfaceClaim('GPTorso')], unjudged: [] })
  })

  // The geoshell group field rides the same list and its vocabulary has never
  // been measured — judging it would report healthy layers as dead.
  it('refuses to judge a token whose attribute it does not know', () => {
    expect(deadBakerGroups(SURFACES, ['@shell_name=GoldenPalace', '@group=x'])).toEqual({
      dead: [],
      unjudged: ['@shell_name=GoldenPalace', '@group=x'],
    })
  })

  it('has nothing to say about a node with no bakers', () => {
    expect(deadBakerGroups(SURFACES, [])).toEqual({ dead: [], unjudged: [] })
  })
})

describe('buildMaterialPlan', () => {
  const project = (over: Partial<ScannedProjectView> = {}): ScannedProjectView => ({
    hipPath: 'D:/p/lara.hiplc',
    imports: ['d:/p/daz-export/primary/lara.dth'],
    nodes: [
      {
        nodePath: '/obj/DazToHue/DazToHueMaterial',
        label: 'LaraClassic',
        slots: LARA_CLASSIC_CLAIMS,
        bakers: 6,
        bakerGroups: [surfaceClaim('Body'), surfaceClaim('GPTorso')],
      },
    ],
    ...over,
  })
  const exports = new Map<string, unknown>([['d:/p/daz-export/primary/lara.dth', EXPORT]])

  it('plans a project against the export it imports', () => {
    const [plan] = buildMaterialPlan([project()], exports)
    expect(plan.blocked).toBe('')
    expect(plan.surfaces).toBe(9)
    expect(plan.proposal.map((slot) => slot.name)).toEqual([
      'Skin',
      'Eyes',
      'Tear',
      'Clothing',
      'Bags',
    ])
    expect(plan.nodes[0]).toMatchObject({ label: 'LaraClassic', slots: 4, bakers: 6 })
    expect(plan.nodes[0].deadGroups).toEqual([surfaceClaim('GPTorso')])
  })

  // A project that cannot be judged must still be listed with its reason —
  // dropping it silently reads as "this project is fine".
  it.each([
    ['several imports', { imports: ['a.dth', 'b.dth'] }, /imports 2 scenes/],
    ['no imports', { imports: [] }, /rescan it/],
  ])('blocks on %s and says why', (_label, over, expected) => {
    const [plan] = buildMaterialPlan([project(over)], exports)
    expect(plan.blocked).toMatch(expected)
    expect(plan.nodes).toEqual([])
  })

  it('tells the user to export once when the .dth is not there', () => {
    const [plan] = buildMaterialPlan([project()], new Map([['d:/p/daz-export/primary/lara.dth', null]]))
    expect(plan.blocked).toMatch(/run a DTH Export for this scene once/)
  })

  it('separates "nobody looked" from "looked, not there" the same way', () => {
    const [plan] = buildMaterialPlan([project()], new Map())
    expect(plan.blocked).toMatch(/No export at/)
  })

  // An export the studio can read but that carries no material list is a
  // different problem from a missing one, and pointing at "0 surfaces" would
  // send the user hunting in the wrong place.
  it('names an export with no material list as its own case', () => {
    const [plan] = buildMaterialPlan(
      [project()],
      new Map<string, unknown>([['d:/p/daz-export/primary/lara.dth', { Materials: [] }]]),
    )
    expect(plan.blocked).toMatch(/carries no material list/)
  })
})

describe('planHasFindings', () => {
  const plan = (over: Partial<MaterialPlanNode>): Array<MaterialPlanProject> => [
    {
      hipPath: 'x',
      blocked: '',
      dthPath: 'y',
      surfaces: 1,
      proposal: [],
      nodes: [
        {
          nodePath: '/n',
          label: 'n',
          slots: 1,
          bakers: 1,
          diff: { unclaimed: [], dead: [], matched: 1 },
          deadGroups: [],
          unjudgedGroups: [],
          ...over,
        },
      ],
    },
  ]

  it('is quiet on a setup in step with its export', () => {
    expect(planHasFindings(plan({}))).toBe(false)
  })

  it.each([
    ['a dead claim', { diff: { unclaimed: [], dead: [{ claim: 'c', slot: 's' }], matched: 0 } }],
    ['a dead baker group', { deadGroups: ['@fbx_material_name=GPTorso'] }],
    [
      'an unclaimed surface',
      { diff: { unclaimed: [{ surface: 's', contentType: 'c', asset: 'a' }], dead: [], matched: 0 } },
    ],
  ])('reports %s', (_label, over) => {
    expect(planHasFindings(plan(over as Partial<MaterialPlanNode>))).toBe(true)
  })

  // A missing input is not a finding — badging it trains the eye to ignore
  // the badge.
  it('does not treat a blocked project as a finding', () => {
    expect(
      planHasFindings([
        { hipPath: 'x', blocked: 'no export yet', dthPath: '', surfaces: 0, proposal: [], nodes: [] },
      ]),
    ).toBe(false)
  })
})

describe('canDiffProject', () => {
  it.each([
    ['one import is attributable', ['a.dth'], true],
    ['several imports cannot be attributed from the stored scan', ['a.dth', 'b.dth'], false],
    ['no imports is NOT KNOWN, not "matches everything"', [], false],
  ])('%s', (_label, imports, expected) => {
    expect(canDiffProject(imports)).toBe(expected)
  })
})
