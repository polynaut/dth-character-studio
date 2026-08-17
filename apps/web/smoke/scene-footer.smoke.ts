import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

const FOOTER = 'div.fixed.inset-x-0.bottom-0'

// The docked scene status bar: hidden while the Daz-scenes cards are on screen,
// slides up once they scroll off, names the selected scene (primary tagged), and
// selecting a pill switches the scene (arming the per-scene override toggles).
test('scene footer docks on scroll and switches scene', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const beach = `${P.charFolder}/daz3d/KiraBeach.duf`
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  kira.extraScenes = [beach]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  seed.files[beach] = 'duf-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.setViewportSize({ width: 1240, height: 800 })
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.waitForTimeout(300)

  const vh = 800
  const footer = page.locator(FOOTER)

  // Top of the page: scenes cards visible → footer docked off-screen (translate-y-full).
  expect((await footer.boundingBox())!.y, 'hidden at top').toBeGreaterThanOrEqual(vh - 2)

  // Scroll until the Daz-scenes area leaves the viewport → footer slides up.
  await page.evaluate(() => window.scrollTo({ top: 1000 }))
  await page.waitForTimeout(450)
  expect((await footer.boundingBox())!.y, 'shown when scrolled').toBeLessThan(vh)
  await expect(footer.getByText('primary'), 'primary tag').toBeVisible()

  // Click the extra scene's pill → it becomes the selected (prominent, ringed) scene.
  await footer.getByText('Beach', { exact: false }).click()
  await expect(footer.locator('.ring-daz-green'), 'Beach now selected').toContainText('Beach')
})

// Same pattern in every case: a single-scene character still gets the bar on scroll —
// it just names the lone primary (no divider, no rail).
test('scene footer names the lone primary for a single-scene character', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  kira.extraScenes = [] // only the primary scene
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await page.setViewportSize({ width: 1240, height: 800 })
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.evaluate(() => window.scrollTo({ top: 1000 }))
  await page.waitForTimeout(450)

  const footer = page.locator(FOOTER)
  expect((await footer.boundingBox())!.y, 'shown when scrolled').toBeLessThan(800)
  await expect(footer.getByText('primary'), 'names the primary').toBeVisible()
})

// Two more used to live here — an overflowing scene rail, and the footer keying
// off the scene-cards GRID rather than the whole panel. Both asserted geometry
// and nothing else, which is not what smoke is for: layout is judged by eye, and
// a pixel assertion on it breaks on every deliberate change while catching none
// of the ones that matter.
