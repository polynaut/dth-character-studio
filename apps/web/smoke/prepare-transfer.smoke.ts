import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Settings → Daz scripts: the editable Prepare-for-transfer morph list, and the
// promise the tab makes — saving REWRITES the installed script. The spec drives
// the whole loop: defaults on screen, an edit, Save, and the baked file in the
// Daz library carrying the edit. The fake fs is the measurement, not the toast.

const INSTALLED = `${P.dazLib}/Scripts/DTH-Character-Studio/Prepare_For_Transfer.dsa`

test('editing the transfer morph list re-bakes the installed script on Save', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: P.dcsp, demo: true }))
  // Via the UI, not a direct goto — the project window's startup routing wins
  // over a deep link on first load.
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Daz scripts' }).click()

  // The defaults are the DazToHue G8→G9 guide's list — a couple of the
  // recognizable ones prove the seed parsed into the editor.
  await expect(page.getByRole('textbox', { name: 'Morph entry 1', exact: true })).toHaveValue(
    'Areola',
  )
  await expect(page.getByText('Prepare for transfer (G8 → G9)')).toBeVisible()

  // Add an entry; the header Save arms only through the dirty gate, so this
  // also pins that the new field is wired into it.
  await page.getByRole('button', { name: 'Add a morph' }).click()
  const added = page.getByRole('textbox', { name: 'Morph entry 11' })
  await added.fill('My Custom Morph')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/^Saved/).first()).toBeVisible()

  // The save's install hook baked the edited list into the script in the Daz
  // library — as a real array literal, token gone.
  await expect
    .poll(async () =>
      page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? '') as string, INSTALLED),
    )
    .toContain('"My Custom Morph"')
  const installed = await page.evaluate(
    (p) => ((window as any).__tauriMock.files.get(p) ?? '') as string,
    INSTALLED,
  )
  expect(installed).not.toContain('__DTH_TRANSFER_MORPHS__')
  expect(installed).toContain('"Areola"')
})
