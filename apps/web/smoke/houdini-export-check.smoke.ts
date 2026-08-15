import { expect, test } from '@playwright/test'

import {
  EXPORT_CHECK_DTH,
  EXPORT_CHECK_DTH_BODY,
  EXPORT_CHECK_STORE,
  P,
  buildSeed,
  exportCheckStore,
  stampScanStore,
} from './fixtures.ts'
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
// The fixture itself (a real setup, trimmed from LaraCroft_G81) lives in
// fixtures.ts: the guide's screenshot of this tab has to show the state this
// spec asserts, and a second copy would let the two drift apart.

async function openExportCheck(
  page: Page,
  over: { project?: Record<string, unknown>; withExport?: boolean } = {},
): Promise<Page> {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  if (over.withExport !== false) seed.files[EXPORT_CHECK_DTH] = JSON.stringify(EXPORT_CHECK_DTH_BODY)
  seed.files[EXPORT_CHECK_STORE] = exportCheckStore(over.project)
  await page.addInitScript(installTauriMock, seed)
  await stampScanStore(page)
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
    project: {
      imports: [EXPORT_CHECK_DTH.toLowerCase(), `${P.exportDir}/thick/kira_thick.dth`],
    },
  })
  const drawer = page.getByRole('dialog')

  // The stored scan records imports per PROJECT, so a node cannot be attributed
  // to a scene — and blaming the wrong node costs a cleanup that should not have
  // been made.
  await expect(drawer.getByText(/imports 2 scenes/)).toBeVisible()
  await expect(drawer.getByText('dead')).toHaveCount(0)
})
