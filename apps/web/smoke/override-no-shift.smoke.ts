import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// A field going overridden adds the green OverrideMark to its label — that must not
// grow the label row and nudge the field below (the `-my-px` on OverrideMark).
test('a field going overridden does not shift its input', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const beach = `${P.charFolder}/daz3d/KiraBeach.duf`
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  kira.extraScenes = [beach]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  seed.files[beach] = 'duf-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.setViewportSize({ width: 1320, height: 1000 })
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByText('Beach', { exact: false }).first().click()
  await page.waitForTimeout(300)

  const facs = page.locator('input[inputmode="decimal"]').first()
  const flex = page.locator('input[inputmode="decimal"]').nth(1)
  const beforeY = (await facs.boundingBox())!.y
  const beforeX = (await flex.boundingBox())!.x
  // Edit FACS to differ from the primary → its label gains the green dot. The slot
  // is reserved, so neither FACS's own input (Y) nor the neighbouring Flexion (X)
  // should move.
  await facs.fill('85')
  await facs.press('Enter')
  await page.waitForTimeout(300)
  expect(Math.abs((await facs.boundingBox())!.y - beforeY), 'FACS input Y unchanged').toBeLessThan(1)
  expect(Math.abs((await flex.boundingBox())!.x - beforeX), 'neighbour X unchanged').toBeLessThan(1)
})
