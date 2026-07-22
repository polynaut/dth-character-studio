import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Guards the pure-CSS sticky offsets: --editor-header-h must animate (no JS) so it
// tracks the collapsing header, and the sticky "ROM" panel title must pin right
// under that header (never sliced by it) once the ROM section reaches the top.
test('sticky panel title: --editor-header-h animates, ROM title pins under the header', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  await page.addInitScript(installTauriMock, seed)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  const header = page.locator('header.liquid-glass-header')
  const romTitle = page
    .locator('section', { has: page.getByRole('heading', { name: 'ROM' }) })
    .locator('> div')
    .first()

  // 1. Pure CSS: scrolling collapses the header, and the animated variable reads its
  //    collapsed value (160px) with NO JS writing it.
  await page.evaluate(() => window.scrollTo({ top: 800 }))
  await page.waitForTimeout(400)
  const collapsedVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--editor-header-h').trim(),
  )
  const romTitleVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--rom-title-h').trim(),
  )

  // 2. Scroll the ROM section to the top; its title pins right below the collapsed
  //    header — same y as the header's bottom, no overlap.
  const titleTop = await romTitle.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
  await page.evaluate((y) => window.scrollTo({ top: y }), titleTop)
  await page.waitForTimeout(400)
  const hb = (await header.boundingBox())!
  const tb = (await romTitle.boundingBox())!
  const headerBottom = hb.y + hb.height
  const gap = tb.y - headerBottom // ≈0 = pinned flush; <0 = overlap/poke

  console.log(
    'STICKY ' +
      JSON.stringify({
        collapsedVar,
        romTitleVar,
        headerBottom: Math.round(headerBottom),
        romTitleTop: Math.round(tb.y),
        gapPx: Math.round(gap),
      }),
  )

  expect(collapsedVar, 'animated var reads collapsed height').toBe('160px')
  expect(romTitleVar, '--rom-title-h is the static title height').toBe('28px')
  // Pinned flush under the header: no overlap, no big gap.
  expect(gap).toBeGreaterThanOrEqual(-1)
  expect(gap).toBeLessThanOrEqual(2)
})
