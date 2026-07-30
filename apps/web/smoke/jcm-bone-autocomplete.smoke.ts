import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The "Modify JCM frames" bone field autocompletes from the scanned bone index
// (the `bones` array in the same morphs_<G>.json a Build_Genesis_Index run writes).
test('JCM: the bone field autocompletes from the scanned bone index', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // Open the JCM section, then the optional "Modify JCM frames" grid, and add a rule.
  await page.getByRole('button', { name: /JCM\s+Joint Corrective/ }).click()
  await page.getByRole('button', { name: 'Modify JCM frames', exact: true }).click()
  await page.getByRole('button', { name: 'Add rule' }).click()

  const field = page.getByPlaceholder('bone, e.g. Left Thigh Bend').first()
  await field.scrollIntoViewIfNeeded()
  await field.click()
  await field.fill('thigh')

  // The suggestions dropdown (fed by the seeded bones) appears with both thighs.
  const listbox = page.getByRole('listbox', { name: 'Bone suggestions' })
  await expect(listbox).toBeVisible()
  const option = listbox.getByRole('option').filter({ hasText: 'Left Thigh Bend' })
  await expect(option).toBeVisible()

  // Picking a suggestion inserts the bone's UI label.
  await option.click()
  await expect(field).toHaveValue('Left Thigh Bend')
})
