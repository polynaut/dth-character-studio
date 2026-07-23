import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// An overridden field's cube glyph goes green and its dot bobs (the `cy` keyframe).
// Guards the animation wiring — a static class alone wouldn't move.
test('overridden glyph dot bobs', async ({ page }) => {
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
  await page.waitForTimeout(200)
  const facs = page.locator('input[inputmode="decimal"]').first()
  await facs.fill('85')
  await facs.press('Enter')
  await page.waitForTimeout(300)

  // The overridden dot carries the bob animation and moves across frames.
  const dot = page.locator('circle.animate-override-bob').first()
  await expect(dot, 'overridden dot has the bob animation').toHaveCount(1)
  const y1 = (await dot.boundingBox())!.y
  await page.waitForTimeout(600)
  const y2 = (await dot.boundingBox())!.y
  expect(Math.abs(y2 - y1), 'dot bobs while overridden').toBeGreaterThan(0.2)
})
