import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Locator, Page } from '@playwright/test'

// Regression guard for the sticky-bar OVERRIDES pill: as the header collapses on
// scroll, --editor-header-h animates to TRACK it, so the bar always pins just below
// the header's CURRENT height. If that ever regresses (e.g. back to a static offset)
// the bar sticks behind the still-taller header mid-collapse and slices the pill.
// We assert the pill's top never rises above the header's bottom, at three scrolls.
async function overlapAt(page: Page, header: Locator, pill: Locator, y: number) {
  await page.evaluate((top) => window.scrollTo({ top }), y)
  await page.waitForTimeout(350)
  const [hb, pb] = await Promise.all([header.boundingBox(), pill.boundingBox()])
  const headerBottom = hb!.y + hb!.height
  return Math.round(Math.max(0, headerBottom - pb!.y)) // >0 = header covers the pill
}

test('sticky bar: the OVERRIDES pill never overlaps the collapsing header', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const extraScene = `${P.charFolder}/daz3d/KiraBeach.duf`
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  kira.extraScenes = [extraScene]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  seed.files[extraScene] = 'duf-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // A non-primary scene reveals the override toggles; arm one so the pill shows.
  await page.getByText('KiraBeach', { exact: true }).first().click()
  await page.getByRole('switch', { name: /Override ROM frames/ }).click()

  const header = page.locator('header.liquid-glass-header')
  const pill = page.getByText(/Overrides\s*\d/i).first()
  await expect(pill).toBeVisible()

  // top, mid-collapse (inside the 100–242px range — the case that used to slice
  // the pill), and fully collapsed.
  expect(await overlapAt(page, header, pill, 0), 'at top').toBeLessThanOrEqual(1)
  expect(await overlapAt(page, header, pill, 170), 'mid-collapse').toBeLessThanOrEqual(1)
  expect(await overlapAt(page, header, pill, 700), 'collapsed').toBeLessThanOrEqual(1)
})
