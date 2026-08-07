import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Copying a Houdini project in, which was refused outright until the studio
// could see and repair what a copy breaks. These specs pin the file movement —
// the part that is not undoable — and that linking stays the default.

/** A `.hip` living outside the character folder, the thing being brought in. */
const OUTSIDE = 'D:/Templates/G9_Skin_Base.hiplc'
const DEST = `${P.charFolder}/houdini/G9_Skin_Base.hiplc`

const has = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, path)
const linked = (page: Page) =>
  page.evaluate(
    (p) => JSON.parse(((window as any).__tauriMock.files.get(p) ?? '{}') as string).houdiniProjects,
    `${P.charFolder}/Kira.json`,
  )

async function open(page: Page) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dialogPath: OUTSIDE })
  seed.files[OUTSIDE] = 'hip-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

test('linking is still the default — the file stays where it is', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByText(/Linked Houdini project/)).toBeVisible()

  expect(await has(page, OUTSIDE)).toBe(true)
  expect(await has(page, DEST)).toBe(false)
  expect(await linked(page)).toContain(OUTSIDE)
})

test('copy brings the file in and links the copy, leaving the original', async ({ page }) => {
  await open(page)
  await page.getByText(/Copy into the character/).click()
  await page.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByText(/Copied 1 Houdini project/)).toBeVisible()

  expect(await has(page, DEST)).toBe(true)
  // A COPY leaves the source alone — that is the whole difference from move.
  expect(await has(page, OUTSIDE)).toBe(true)
  const projects = await linked(page)
  expect(projects).toContain(DEST)
  expect(projects).not.toContain(OUTSIDE)
})

test('move removes the original once the copy is on disk', async ({ page }) => {
  await open(page)
  await page.getByText(/Copy into the character/).click()
  await page.getByText(/Move \(remove the original\)/).click()
  await page.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByText(/Moved 1 Houdini project/)).toBeVisible()

  expect(await has(page, DEST)).toBe(true)
  expect(await has(page, OUTSIDE)).toBe(false)
})

test('a name already in the folder is refused rather than overwritten', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, dialogPath: OUTSIDE })
  seed.files[OUTSIDE] = 'the one being added'
  seed.files[DEST] = 'somebody else’s project'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  await page.getByText(/Copy into the character/).click()
  await page.getByRole('button', { name: 'Add project' }).click()

  await expect(page.getByText(/already in this character.s Houdini folder/)).toBeVisible()
  // Untouched — refusing has to mean refusing, not "overwrote and told you".
  expect(await page.evaluate((p) => (window as any).__tauriMock.files.get(p), DEST)).toBe(
    'somebody else’s project',
  )
})
