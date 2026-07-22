import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Switching the character page's top tabs pushes a history entry, so the browser
// (mouse) Back button returns to the previous tab.
test('character tabs: switching pushes history; Back returns to the last tab', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dazProductsEnabled: true })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // Default: Character tab, no ?tab= in the URL.
  await expect(page).not.toHaveURL(/tab=/)
  await expect(page.getByRole('tab', { name: 'Character' })).toHaveAttribute('data-state', 'active')

  // Character → Products (pushes ?tab=products).
  await page.getByRole('tab', { name: 'Products' }).click()
  await expect(page).toHaveURL(/tab=products/)
  await expect(page.getByRole('tab', { name: 'Products' })).toHaveAttribute('data-state', 'active')

  // Products → Notes (pushes ?tab=notes).
  await page.getByRole('tab', { name: 'Notes' }).click()
  await expect(page).toHaveURL(/tab=notes/)

  // Back → Products, Back → Character (the two prior history entries).
  await page.goBack()
  await expect(page).toHaveURL(/tab=products/)
  await expect(page.getByRole('tab', { name: 'Products' })).toHaveAttribute('data-state', 'active')

  await page.goBack()
  await expect(page).not.toHaveURL(/tab=/)
  await expect(page.getByRole('tab', { name: 'Character' })).toHaveAttribute('data-state', 'active')

  // Forward returns to Products (history intact).
  await page.goForward()
  await expect(page).toHaveURL(/tab=products/)
})
