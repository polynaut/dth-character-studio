import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// "Export hair assets too": flipping the toggle in the "Daz scripts generated"
// panel persists + regenerates immediately (the persistPatch pattern), and the
// regenerated ROM script carries the per-item groom-export pass. The same panel
// is where the read-only Export directory reads out, so the spec pins that the
// switches and the directory they deliver into stayed in ONE box.

test('the export-hair toggle regenerates the script with the groom pass', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`]) as Record<string, unknown>
  kira.exportPath = 'X:/exports/kira'
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The switches and the Export directory sub-section share one panel (the
  // standalone Export directory box folded in here once the directory became
  // derived and read-only) — a split back into two panels fails here.
  const scripts = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Daz scripts generated' }) })
  await expect(scripts.getByRole('heading', { name: 'Export directory' })).toBeVisible()
  await expect(scripts).toContainText(/exports/i)

  const label = page.getByText('Export hair assets too')
  await label.scrollIntoViewIfNeeded()
  await label.locator('xpath=preceding-sibling::button[@role="switch"]').click()
  await expect(page.getByText(/Hair assets export with the main export/)).toBeVisible()
  const dsa = await page.evaluate(
    (p) => ((window as any).__tauriMock.files.get(p) ?? '') as string,
    `${P.scriptsDir}/ROM_Kira_G9.dsa`,
  )
  expect(dsa).toContain('doExportAlembicGroomPoses(dthExportDir, dthHairName, false)')
  expect(dsa).toContain('var dthHairFig')
})

test('hair drift on the PRIMARY scene warns both ways — gone and unlisted', async ({ page }) => {
  // The reported shape (2026-08-19): the user re-styles the scene in Daz and
  // saves — the list still names the old hair (the export stops on a label it
  // cannot find) and the new hair is unlisted (it rides into the export).
  // The unlisted half used to be gated to outfit scenes on the "the primary
  // was seeded complete at creation" reasoning, so a drifted PRIMARY warned
  // about nothing at all.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.sceneWearables = {
    [P.scene]: [
      { id: 'nova-ponytail-hair', label: 'Nova Ponytail Hair', conformTarget: '#Genesis9' },
    ],
  }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // Listed but gone from the scene…
  await expect(page.getByText(/Not found in .KiraDefault_G9_GP.+CHT Sevenly Hair/)).toBeVisible()
  // …and in the scene but not listed — on the primary, the new half.
  await expect(page.getByText(/Unlisted hair: Nova Ponytail Hair/)).toBeVisible()
})
