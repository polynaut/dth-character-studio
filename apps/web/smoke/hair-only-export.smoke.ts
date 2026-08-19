import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// "Hair items only" exports each selected scene's hair items and nothing else
// (the hidden `.Bulk_Hair_Export.dsa` carrier, runtime v97). Its two promises:
//
// 1. The scene list is FILTERED, not disabled-rowed: only the scenes whose
//    "Export hair items" switch is on appear — the seed stores no exportHair,
//    so the primary defaults ON and the extra scene OFF.
// 2. The run stops after Daz, like ROM only: no fresh `.dth` is written, so
//    the Houdini leg is cleared and its export mode is dead.

const DAZ_INSTALL = 'C:/Program Files/DAZ 3D/DAZStudio4'
const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
const PENDING_JOB = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`

const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)

test('hair-only filters the scene list and hands off the hair carrier alone', async ({ page }) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    demo: true,
    extraScene: true,
    dazInstallFolder: DAZ_INSTALL,
  })
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_Hair_Export.dsa`] = '// hair carrier fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: 'DTH Export' }).click()

  // Both linked scenes are offered under the default mode…
  await expect(page.getByRole('checkbox', { name: /Export KiraDefault/ })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Export KiraSummertide/ })).toBeVisible()

  // …and "Hair items only" lists just the hair-enabled ones. Both scenes carry
  // a hair LIST; only the switch decides the listing.
  await page.locator('#daz-mode').click()
  await page.getByRole('option', { name: /Hair items only/ }).click()
  await expect(page.getByRole('checkbox', { name: /Export KiraSummertide/ })).toHaveCount(0)
  // Pre-checked: the mode has no staleness signal — picking it means "export
  // their hair now".
  await expect(page.getByRole('checkbox', { name: /Export KiraDefault/ })).toBeChecked()
  await expect(page.getByText('Exports each hair item of this scene on its own')).toBeVisible()

  // The armed Houdini continuation is taken away, exactly like ROM only.
  await expect(page.getByRole('checkbox', { name: /Run in Kira/ })).not.toBeChecked()
  await expect(page.locator('#houdini-mode')).toHaveText(/Skip Houdini/)

  // Start writes a one-row batch pointing at the hidden hair carrier — the
  // hair-off scene stays out of the job file.
  await page.getByRole('button', { name: 'Start' }).click()
  await expect.poll(() => fileContent(page, PENDING_JOB)).not.toBeNull()
  const job = (await fileContent(page, PENDING_JOB))!
  expect(job).toContain('.Bulk_Hair_Export.dsa')
  expect(job).toContain('KiraDefault_G9_GP.duf')
  expect(job).not.toContain('KiraSummertide')
})
