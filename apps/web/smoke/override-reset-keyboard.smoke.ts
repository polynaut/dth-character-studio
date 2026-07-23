import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Keyboard-focusing an overridden field's reset control must swap the cube glyph for
// the reset button (both key off the mark's `group-focus-within`, so they don't
// overlap). Guards the a11y path — hover alone would leave the cube on top.
test('overridden reset shows on keyboard focus', async ({ page }) => {
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

  // Override the FACS dial → its reset control mounts (still hidden until hover/focus).
  const facs = page.locator('input[inputmode="decimal"]').first()
  await facs.fill('85')
  await facs.press('Enter')
  await page.waitForTimeout(250)

  // The mark IS the reset button now (keyboard-reachable); the cube is its resting
  // face and the reset chip is the revealed face.
  const reset = page.getByRole('button', { name: /Reset to the primary/ }).first()
  await expect(reset).toHaveCount(1)
  const cube = reset.locator('> svg') // resting cube glyph (direct child)
  const chip = reset.locator('> span') // the reset chip (holds the RotateCcw)

  // Before focus: cube shown, reset chip hidden.
  expect(Number(await cube.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9)
  expect(Number(await chip.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.1)

  await reset.focus()
  await page.waitForTimeout(200)

  // After focus: cube faded out, reset chip revealed.
  expect(Number(await cube.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.1)
  expect(Number(await chip.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9)
})
