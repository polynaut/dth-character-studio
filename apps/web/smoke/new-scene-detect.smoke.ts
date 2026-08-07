import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'
import type { TauriMockSeed } from './tauri-mock.ts'

// Noticing a Daz scene the user just saved into a character's folder.
//
// The whole point is that nobody has to remember: the studio looks when its
// window regains focus, and the prompt hands the file to the character page's
// REAL Add-scene dialog rather than adding it itself — so what these specs
// check is that the offer appears for the right files, stays quiet for the
// wrong ones, and lands in the dialog that already does the validating.

/** A scene saved beside the primary — what a Save As out of Daz leaves. */
const SAVED = `${P.charFolder}/daz3d/Kira_Yoga.duf`
/** The studio's OWN generated ROM animation: a `.duf` in the same tree. */
const GENERATED = `${P.charFolder}/daz3d/rom-animations/Kira_ROM.duf`

function seedWith(extra: Record<string, string>): TauriMockSeed {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  for (const [path, body] of Object.entries(extra)) seed.files[path] = body
  return seed
}

/**
 * Load the app, then come BACK to it.
 *
 * The focus event is the whole trigger: the offer answers "you went to Daz and
 * came back", so it deliberately does not fire on mount — a freshly opened
 * window is nobody returning from anywhere, and greeting a launch with a modal
 * over whatever the user was doing is how a helpful prompt becomes a nuisance.
 */
async function open(page: Page, seed: TauriMockSeed) {
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  // Wait for the app to be up before returning to it: `goto` resolves on load,
  // and a focus event dispatched before React has mounted lands on a window
  // nothing is listening to yet.
  await expect(page.getByRole('link', { name: /Kira/ })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

test('a scene saved into the character folder is offered when you come back', async ({ page }) => {
  await open(page, seedWith({ [SAVED]: 'duf-fixture' }))

  const prompt = page.getByRole('dialog', { name: 'A new Daz scene is sitting there' })
  await expect(prompt).toBeVisible()
  await expect(prompt.getByText('Kira_Yoga.duf')).toBeVisible()
  // Named by its owning character — which folder it landed in IS the answer to
  // "add it to what?".
  await expect(prompt.getByText('Kira', { exact: true })).toBeVisible()
})

test('Add opens the character page’s own Add-scene dialog on that file', async ({ page }) => {
  await open(page, seedWith({ [SAVED]: 'duf-fixture' }))

  const prompt = page.getByRole('dialog', { name: 'A new Daz scene is sitting there' })
  await prompt.getByRole('button', { name: 'Add' }).click()

  // It navigated to the owning character and raised the REAL dialog — the one
  // carrying the validation table, not a second copy of it.
  await expect(page).toHaveURL(/\/characters\//)
  const add = page.getByRole('dialog', { name: /Add .*scene|Add scene/i })
  await expect(add).toBeVisible()
  await expect(add.getByText('Kira_Yoga.duf')).toBeVisible()
  // The checks that make this an offer and not an automatic link.
  await expect(add.getByText('Empty timeline')).toBeVisible()
  await expect(add.getByText('One character')).toBeVisible()
})

test('the studio never offers the ROM animation it generated itself', async ({ page }) => {
  await open(page, seedWith({ [GENERATED]: 'duf-fixture' }))

  // A `.duf` in exactly the tree the scan walks — offering it would be the tool
  // tripping over its own output.
  await expect(page.getByRole('dialog', { name: /new Daz scene/i })).toHaveCount(0)
})

test('a linked scene is never offered back', async ({ page }) => {
  // The demo character's primary already lives in this tree.
  await open(page, buildSeed({ demo: true, activeProjectFile: P.dcsp }))
  await expect(page.getByRole('dialog', { name: /new Daz scene/i })).toHaveCount(0)
})

test('nothing is offered until the window is actually returned to', async ({ page }) => {
  // Same loose scene as the first spec, but without the focus event — a fresh
  // launch must not raise a modal over whatever the user opens onto.
  await page.addInitScript(installTauriMock, seedWith({ [SAVED]: 'duf-fixture' }))
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Kira/ })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /new Daz scene/i })).toHaveCount(0)
})

test('"Not now" records the decision and the offer stays gone', async ({ page }) => {
  await open(page, seedWith({ [SAVED]: 'duf-fixture' }))

  const prompt = page.getByRole('dialog', { name: 'A new Daz scene is sitting there' })
  await prompt.getByRole('button', { name: 'Not now' }).click()
  await expect(prompt).toHaveCount(0)

  // Written where the project's other app data lives, keyed by the version of
  // the file that was declined.
  const record = await page.evaluate(
    (path: string) => ((window as any).__tauriMock.files.get(path) ?? null) as string | null,
    `${P.project}/.dcsmeta/new-scenes-dismissed.json`,
  )
  expect(record).not.toBeNull()
  // Keyed by path — `toHaveProperty` would read the dots in ".duf" as a nested
  // lookup, so the keys are compared directly.
  expect(Object.keys(JSON.parse(record as string).scenes)).toContain(SAVED.toLowerCase())

  // A refocus re-runs the scan; the decision holds.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('dialog', { name: /new Daz scene/i })).toHaveCount(0)
})
