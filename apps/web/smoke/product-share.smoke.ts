import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Settings → General → the community product-DB opt-in. This build ships with
// NO endpoint configured (PRODUCT_SHARE_ENDPOINT = ''), and the honest surface
// for that is a visible-but-disabled toggle saying so — not a live-looking
// switch that silently does nothing. The submit path itself is pinned by unit
// tests (api/product-share.test.ts); what smoke owns is the visible promise.

test('the community-share toggle renders disabled while no endpoint is configured', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: P.dcsp, demo: true }))
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()

  await expect(page.getByText('Community product database')).toBeVisible()
  // The copy carries the privacy contract — product facts only.
  await expect(page.getByText(/Nothing about you, your scenes or your machine is sent/)).toBeVisible()
  const toggle = page.getByRole('switch', {
    name: 'Share scanned product metadata after each product scan',
  })
  await expect(toggle).toBeVisible()
  await expect(toggle).toBeDisabled()
  await expect(page.getByText(/Not active in this build/)).toBeVisible()
})
