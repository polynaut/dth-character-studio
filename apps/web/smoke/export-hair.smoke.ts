import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// "Export hair assets too": flipping the Export-directory toggle persists +
// regenerates immediately (the persistPatch pattern), and the regenerated ROM
// script carries the per-item groom-export pass.

test('the export-hair toggle regenerates the script with the groom pass', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`]) as Record<string, unknown>
  kira.exportPath = 'X:/exports/kira'
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

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
