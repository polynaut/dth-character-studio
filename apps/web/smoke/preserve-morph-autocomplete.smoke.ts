import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The "Preserve morphs after ROM loading" name field uses the same scanned-morph
// autocomplete as the ROM editor's Morph-name column.
test('preserve morphs: the name field autocompletes from the scanned morph index', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // The preserve-morph name field is the combobox in the Advanced-options section
  // (the node field beside it is a plain textbox).
  const advanced = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Advanced options' }) })
  const field = advanced.getByRole('combobox').first()
  await field.scrollIntoViewIfNeeded()
  await field.click()
  await field.fill('glute')

  // The suggestions dropdown (fed by the seeded morphs_G9.json index) appears.
  const listbox = page.getByRole('listbox', { name: 'Morph suggestions' })
  await expect(listbox).toBeVisible()
  const option = listbox.getByText('SS_body_bs_Glute UpDown', { exact: true })
  await expect(option).toBeVisible()

  // Picking a suggestion fills the internal name.
  await option.click()
  await expect(field).toHaveValue('SS_body_bs_Glute UpDown')
})
