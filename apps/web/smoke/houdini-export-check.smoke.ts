import { expect, test } from '@playwright/test'

import { P, buildSeed, scanStoreEntryKey } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The Utils drawer's **Export check** tab: a material setup measured against the
// `.dth` its project imports.
//
// Everything it shows comes from two files already on disk — the scan store and
// the export — so this spec seeds both and reads the verdict off the screen. No
// hython is involved on either side, which is the whole point of the tab: it is
// the half of the material story that can ship without being able to write
// anything.
//
// The fixture is real, trimmed from LaraCroft_G81's own export and the claims of
// its own `.hiplc`: a skin slot still claiming two Golden Palace surfaces after
// the graft was removed from the scene, and wardrobe the setup never covered.

const STORE = `${P.project}/.dcsmeta/characters/Kira/houdini-scan.json`
/** The `.dth` the network imports — the demo character's primary scene exports
 *  into a folder named after the scene. The scan stores this path lowercased and
 *  normalized, which is what the drawer looks it up by; the api opens the
 *  studio's own spelling, which is what this seeds. */
const DTH = `${P.exportDir}/KiraDefault_G9_GP/Kira.dth`

const claim = (surface: string) => `@fbx_material_name=${surface}`

/** A trimmed real export: figure surfaces, the eye stack, and two wardrobe
 *  assets — enough to exercise every branch of the grouping rule. */
const EXPORT = {
  'DTH Version': '2.0.2',
  'Character Name': 'Kira',
  Materials: [
    ...['Body', 'Face'].map((name) => ({
      'Asset Name': 'Genesis9',
      'Material Name': name,
      'Material Type': 'Iray Uber',
      Value: 'Actor/Character',
      Properties: [
        { Name: 'Diffuse Color', Texture: `$DAZLIB/${name.toLowerCase()}_d.jpg` },
        { Name: 'Bump Strength', Texture: `$DAZLIB/${name.toLowerCase()}_b.jpg` },
      ],
    })),
    {
      'Asset Name': 'Genesis9',
      'Material Name': 'Pupils',
      'Material Type': 'PBRSkin',
      Value: 'Actor/Character',
      Properties: [{ Name: 'Diffuse Color', Texture: '$DAZLIB/eyes_d.jpg' }],
    },
    {
      'Asset Name': 'Boots_12736',
      'Material Name': 'boots',
      'Material Type': 'Iray Uber',
      Value: 'Follower/Wardrobe',
      Properties: [
        { Name: 'Diffuse Color', Texture: '$DAZLIB/boots_d.jpg' },
        { Name: 'Normal Map', Texture: '$DAZLIB/boots_n.jpg' },
      ],
    },
  ],
}

/** The material node as the scan records it: a skin slot whose Golden Palace
 *  claims outlived the graft, and a baker layer naming one of them. */
const node = {
  path: '/obj/DazToHue/DazToHueMaterial',
  name: 'DazToHueMaterial',
  nodeType: 'material',
  networkBox: 'KiraDefault',
  materials: 1,
  uvChannels: 1,
  bakers: 2,
  layers: 8,
  bakerNames: ['T_Skin_Colour', 'T_Skin_Normal'],
  bakerGroups: [claim('Body'), claim('GPTorso')],
  materialNames: ['MI_Skin', 'Skin'],
  slots: [
    {
      name: 'Skin',
      displayName: 'MI_Skin',
      surfaces: [claim('Body'), claim('Face'), claim('GPTorso'), claim('GPVagina')],
      bakers: 2,
      layers: 8,
      channelUvs: ['uv_geoshell'],
    },
  ],
  sectionCounts: [],
}

async function openExportCheck(
  page: Page,
  over: { project?: Record<string, unknown>; withExport?: boolean } = {},
): Promise<Page> {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  if (over.withExport !== false) seed.files[DTH] = JSON.stringify(EXPORT)
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: scanStoreEntryKey(P.houdini, P.exportDir),
        scannedAt: '2026-08-14T00:00:00.000Z',
        project: {
          hipPath: P.houdini,
          ok: true,
          error: '',
          nodes: [node],
          job: P.charFolder,
          fps: 30,
          imports: [DTH.toLowerCase()],
          exportSets: ['Kira'],
          refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: [], missingTextures: [] },
          prefill: { fillable: [], missing: [] },
          ...over.project,
        },
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.replace('__MTIME__', String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('tab', { name: 'Export check' }).click()
  return page
}

test('claims the export no longer backs are named, node by node', async ({ page }) => {
  await openExportCheck(page)
  const drawer = page.getByRole('dialog')

  await expect(drawer.getByText('KiraDefault')).toBeVisible()
  await expect(drawer.getByText('4 surfaces in')).toBeVisible()

  // The Golden Palace claims that outlived the graft. Two of them, and the slot
  // they sit in — which is what makes the finding actionable.
  await expect(drawer.getByText('2 dead').first()).toBeVisible()
  await expect(drawer.getByText('GPTorso', { exact: false }).first()).toBeVisible()
  await expect(drawer.getByText('GPVagina', { exact: false }).first()).toBeVisible()
})

test('a baker layer group the export does not back is reported separately', async ({ page }) => {
  await openExportCheck(page)
  const drawer = page.getByRole('dialog')

  // The half nothing else in the pipeline reports: a layer bound to a group that
  // matches no geometry bakes nothing and raises nothing.
  await expect(drawer.getByText('Baker layer groups the export does not back')).toBeVisible()
  await expect(drawer.getByText('this layer bakes nothing')).toBeVisible()
})

test('unclaimed surfaces are grouped by content type and never flagged', async ({ page }) => {
  await openExportCheck(page)
  const drawer = page.getByRole('dialog')

  // Pupils (figure) and boots (wardrobe) are both unclaimed, and the two mean
  // different things — a "naked" variant is SUPPOSED to leave wardrobe
  // unclaimed, so the content type is what makes intent legible.
  await expect(drawer.getByText('2 unclaimed')).toBeVisible()
  await expect(drawer.getByText(/Actor\/Character: Pupils/)).toBeVisible()
  await expect(drawer.getByText(/Follower\/Wardrobe: boots/)).toBeVisible()
})

test('the proposed setup follows the Daz content type, and regroups on demand', async ({
  page,
}) => {
  await openExportCheck(page)
  const drawer = page.getByRole('dialog')

  // Content type does the grouping: the figure lands in Skin, the eye stack is
  // split out (it needs a different shader), wardrobe is its own slot.
  await expect(drawer.getByText('MI_Skin').first()).toBeVisible()
  await expect(drawer.getByText('MI_Eyes')).toBeVisible()
  await expect(drawer.getByText('MI_Clothing')).toBeVisible()
  await expect(drawer.getByText('T_Skin_Colour (2)')).toBeVisible()

  // Both shapes exist in real hand-built setups, so it is a toggle.
  await drawer.getByRole('button', { name: 'One slot per garment' }).click()
  await expect(drawer.getByText('MI_Boots')).toBeVisible()
  await expect(drawer.getByText('MI_Clothing')).toHaveCount(0)
})

test('a project with no export yet says to run one, and claims nothing', async ({ page }) => {
  await openExportCheck(page, { withExport: false })
  const drawer = page.getByRole('dialog')

  // A missing input is not a finding — it is said plainly, with what to do.
  await expect(drawer.getByText(/run a DTH Export for this scene once/)).toBeVisible()
  await expect(drawer.getByText('dead')).toHaveCount(0)
})

test('a project importing several scenes refuses to guess which node is which', async ({
  page,
}) => {
  await openExportCheck(page, {
    project: { imports: [DTH.toLowerCase(), `${P.exportDir}/thick/kira_thick.dth`] },
  })
  const drawer = page.getByRole('dialog')

  // The stored scan records imports per PROJECT, so a node cannot be attributed
  // to a scene — and blaming the wrong node costs a cleanup that should not have
  // been made.
  await expect(drawer.getByText(/imports 2 scenes/)).toBeVisible()
  await expect(drawer.getByText('dead')).toHaveCount(0)
})
