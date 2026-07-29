import { expect, test } from '@playwright/test'

import { P, UPROJECT, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The bulk-selection pill floats bottom-centre of the viewport, but this page
// docks the Unreal-projects footer at bottom-0 and that bar reserves exactly
// 80px. The pill used to sit at bottom-20 — the same 80px — so it rested flush
// on the footer's top edge with no gap. It now clears the footer by the pill's
// own default bottom-6 spacing (80 + 24 = 104px).

test('the selection pill clears the docked Unreal footer', async ({ page }) => {
  await page.addInitScript(
    installTauriMock,
    buildSeed({ activeProjectFile: P.dcsp, unrealProjects: [UPROJECT] }),
  )
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Kira/ })).toBeVisible()

  // The per-card checkbox is opacity-0 until hover, which Playwright still
  // treats as clickable — selecting one character raises the pill.
  await page.getByRole('checkbox', { name: 'Select' }).first().click()
  const pill = page.getByText('1 character selected').locator('..')
  await expect(pill).toBeVisible()

  const box = (await pill.boundingBox())!
  const viewport = page.viewportSize()!
  const gapBelowPill = viewport.height - (box.y + box.height)

  // Must clear the 80px footer with a visible gap. At the old bottom-20 this
  // is ~80 (flush against the footer) and fails.
  expect(gapBelowPill).toBeGreaterThanOrEqual(96)
})
