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
  const before = (await facs.boundingBox())!.y
  // Edit it to differ from the primary → the label gains the green dot.
  await facs.fill('85')
  await facs.press('Enter')
  await page.waitForTimeout(300)
  const after = (await facs.boundingBox())!.y
  expect(Math.abs(after - before), 'input Y unchanged when overridden').toBeLessThan(1)
})
