import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

const OUT =
  'C:/Users/jebba/AppData/Local/Temp/claude/D--Development-dth-character-studio/5c383248-8ec2-47c6-930f-324d9e751ecb/scratchpad'
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
  await page.screenshot({ path: OUT + '/footer-down.png' })

  // Click the extra scene's pill → it becomes selected (per-scene override toggles appear).
  await expect(page.getByRole('switch', { name: /Override ROM frames/ })).toHaveCount(0)
  await footer.getByText('Beach', { exact: false }).click()
  await expect(page.getByRole('switch', { name: /Override ROM frames/ })).toHaveCount(1)
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

// With many scenes the others rail overflows and becomes horizontally scrollable
// (the edge-fade hints at the off-screen scenes).
test('scene footer rail scrolls with many scenes', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  const extras = Array.from({ length: 10 }, (_, i) => `${P.charFolder}/daz3d/KiraScene${i + 1}.duf`)
  kira.extraScenes = extras
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  for (const p of extras) seed.files[p] = 'duf-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.setViewportSize({ width: 1240, height: 800 })
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  // 11 scene cards make a tall scenes area — scroll all the way past it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(450)

  const footer = page.locator(FOOTER)
  expect((await footer.boundingBox())!.y, 'shown when scrolled').toBeLessThan(800)
  const rail = page.locator(`${FOOTER} .overflow-x-auto`)
  const box = await rail.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(box.sw, 'rail overflows → scrollable').toBeGreaterThan(box.cw)
  await page.screenshot({ path: OUT + '/footer-many.png' })
})

// The observer keys off the scene-cards GRID, not the whole panel: once the cards
// scroll off, the footer appears even while the "Add scene" button (which sits below
// the grid) is still on screen.
test('scene footer appears when the cards leave, not the whole panel', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const beach = `${P.charFolder}/daz3d/KiraBeach.duf`
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  kira.extraScenes = [beach]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  seed.files[beach] = 'duf-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.setViewportSize({ width: 1320, height: 900 })
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.waitForTimeout(300)

  // Scroll just past the cards grid's bottom — the panel below it (Add scene,
  // Houdini) is NOT scrolled past yet, so the footer showing here proves it keys off
  // the cards, not the whole panel.
  const grid = page.locator('.flex.flex-wrap.items-stretch.gap-3').first()
  const gb = (await grid.boundingBox())!
  await page.evaluate((y) => window.scrollTo(0, y), gb.y + gb.height + 30)
  await page.waitForTimeout(400)
  const gbAfter = await grid.boundingBox()
  expect(!gbAfter || gbAfter.y + gbAfter.height < 5, 'cards grid scrolled off top').toBe(true)
  expect((await page.locator(FOOTER).boundingBox())!.y, 'footer shown once cards leave').toBeLessThan(900)
})
