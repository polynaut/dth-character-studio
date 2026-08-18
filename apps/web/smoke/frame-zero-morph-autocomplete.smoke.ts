import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The "Morphs set at frame 0" name field (Advanced options panel) uses the same
// scanned-morph autocomplete as the ROM editor's Morph-name column.
test('frame-0 morphs: the name field autocompletes from the scanned morph index', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // The frame-0 list starts empty on the demo character — add a row, then type in
  // its name field (the only combobox in the Advanced options section; the node
  // transforms beside it are plain inputs).
  const frameZero = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Advanced options' }) })
  const add = frameZero.getByRole('button', { name: 'Add morph', exact: true })
  await add.scrollIntoViewIfNeeded()
  await add.click()

  const field = frameZero.getByRole('combobox').first()
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
