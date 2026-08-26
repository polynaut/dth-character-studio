import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Settings → Daz scripts: the editable Prepare-for-transfer morph list, and the
// promise the tab makes — saving REWRITES the installed script. The specs drive
// the whole loop: defaults on screen, the G8/8.1 autocomplete + match preview,
// an edit, Save, and the baked file in the Daz library carrying the edit. The
// fake fs is the measurement, not the toast.

const INSTALLED = `${P.dazLib}/Scripts/DTH-Character-Studio/Prepare_For_Transfer.dsa`

/** A G8.1 morph index (Build_Genesis_Index output) — the autocomplete's and the
 *  match preview's ground truth. buildSeed ships only the G9 file, which is the
 *  point: this tab must read the G8/8.1 indexes, not the demo character's. */
function seedWithG8Index() {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.files[`${P.appData}/morphs_G8.1.json`] = JSON.stringify({
    version: 2,
    morphs: [
      { node: 'Genesis8_1Female', nodeLabel: 'G8.1F', label: 'Breasts Size', name: 'PBMBreastsSize' },
      { node: 'Genesis8_1Female', nodeLabel: 'G8.1F', label: 'Nipples', name: 'PBMNipples' },
      { node: 'Genesis8_1Female', nodeLabel: 'G8.1F', label: 'Nipples Tip Adjust', name: 'PBMNipplesTipAdjust' },
    ],
    bones: [],
  })
  return seed
}

async function openScriptsTab(page: import('@playwright/test').Page) {
  // Via the UI, not a direct goto — the project window's startup routing wins
  // over a deep link on first load.
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Daz scripts' }).click()
}

test('editing the transfer morph list re-bakes the installed script on Save', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, buildSeed({ activeProjectFile: P.dcsp, demo: true }))
  await openScriptsTab(page)

  // The defaults are the DazToHue G8→G9 guide's list — a recognizable one
  // proves the seed parsed into the editor.
  await expect(page.getByRole('combobox', { name: 'Morph entry 1', exact: true })).toHaveValue(
    'Areola',
  )
  await expect(page.getByText('Prepare for transfer (G8 → G9)')).toBeVisible()

  // Add an entry; the header Save arms only through the dirty gate, so this
  // also pins that the new field is wired into it. Enter commits the draft
  // (the field is a commit-on-blur cell, not a plain input).
  await page.getByRole('button', { name: 'Add a morph' }).click()
  const added = page.getByRole('combobox', { name: 'Morph entry 11' })
  await added.fill('My Custom Morph')
  await added.press('Enter')
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

test('entries autocomplete from the G8/8.1 index, and each shows what it zeroes', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, seedWithG8Index())
  await openScriptsTab(page)

  // The match preview under a default entry — the contains rule made visible:
  // "Breasts Size" claims the internal PBMBreastsSize dial, "Nipple" the whole
  // family. The same rule the baked script runs, per transfer-morphs.test.ts.
  await expect(page.getByText('Zeroes 1 dial: Breasts Size')).toBeVisible()
  await expect(page.getByText('Zeroes 2 dials: Nipples, Nipples Tip Adjust')).toBeVisible()
  // …and an entry the index doesn't know is CALLED OUT, not left looking
  // covered (the seeded index carries no torso dial).
  await expect(page.getByText('Matches no dial in the scanned G8/8.1 index.').first()).toBeVisible()

  // The autocomplete: typing into a fresh entry offers the indexed dials, and
  // a pick inserts the INTERNAL name.
  await page.getByRole('button', { name: 'Add a morph' }).click()
  const added = page.getByRole('combobox', { name: 'Morph entry 11' })
  await added.fill('nipples tip')
  await page.getByRole('option', { name: /PBMNipplesTipAdjust/ }).click()
  await expect(added).toHaveValue('PBMNipplesTipAdjust')
  await expect(page.getByText('Zeroes 1 dial: Nipples Tip Adjust')).toBeVisible()
})
