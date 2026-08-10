import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The two remove dialogs — a Daz scene and a Houdini project — are one dialog
// asking one question. WHERE the file is decides what deletion is ALLOWED,
// never what is pre-selected:
//
//   inside the character folder  → the studio's own copy → deletion offered, OFF
//   outside it                   → the user's original   → deletion locked off
//
// Delete always starts unticked: every other surface (the dock tooltip, the
// replace-primary guidance) promises "the file is kept" on unlink, a scene
// moved in via "delete original after copying" is the ONLY copy, and there is
// no recycle bin — a pre-ticked delete destroys exactly the file the user
// means to keep. The confirm button reads "Delete" only when the box is
// ticked, so the destructive state is always explicit.

const OUTSIDE_HIP = 'D:/Templates/External.hiplc'

const has = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, path)

async function openCharacter(page: Page, extra: Record<string, string> = {}) {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, houdiniProject: true })
  for (const [path, body] of Object.entries(extra)) seed.files[path] = body
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

test('both dialogs use the same toggle, in the same direction', async ({ page }) => {
  await openCharacter(page)

  await page.getByRole('button', { name: 'Unlink from character' }).first().click()
  const houdini = page.getByRole('dialog', { name: 'Remove Houdini project?' })
  await expect(houdini.getByText('Delete file on disk')).toBeVisible()
  // The inverted "Keep houdini files" wording is gone — that was the whole
  // reason the two dialogs looked like different features.
  await expect(houdini.getByText(/Keep houdini files/)).toHaveCount(0)
  await houdini.getByRole('button', { name: 'Cancel' }).click()
})

test('a project inside the character folder OFFERS deletion, unticked', async ({ page }) => {
  await openCharacter(page)
  await page.getByRole('button', { name: 'Unlink from character' }).first().click()

  const dialog = page.getByRole('dialog', { name: 'Remove Houdini project?' })
  // The studio's own copy: deletion is available but never pre-selected.
  await expect(dialog.getByRole('switch')).not.toBeChecked()
  await expect(dialog.getByRole('switch')).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeVisible()

  // Ticking it arms the delete, and the button says so.
  await dialog.getByRole('switch').click()
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeVisible()
})

test('a project linked from outside is unlink-only, and says so', async ({ page }) => {
  // Seed a SECOND project that lives in the user's own tree — the case the
  // whole where-is-the-file rule exists for.
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, houdiniProject: true })
  seed.files[OUTSIDE_HIP] = 'hip-fixture'
  const defPath = `${P.charFolder}/Kira.json`
  const character = JSON.parse(seed.files[defPath])
  character.houdiniProjects = [...character.houdiniProjects, OUTSIDE_HIP]
  seed.files[defPath] = JSON.stringify(character, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // The second card is the external one.
  await page.getByRole('button', { name: 'Unlink from character' }).nth(1).click()
  const dialog = page.getByRole('dialog', { name: 'Remove Houdini project?' })

  // Their original: the toggle is visible but LOCKED OFF — "you cannot delete
  // this" said out loud rather than a silently missing option — and the button
  // can only ever be an unlink.
  await expect(dialog.getByRole('switch')).not.toBeChecked()
  await expect(dialog.getByRole('switch')).toBeDisabled()
  await expect(dialog.getByText(/Linked in place/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Remove' })).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Unlink' }).click()
  await expect(dialog).toHaveCount(0)
  // Unlinked from the character, untouched on disk.
  expect(await has(page, OUTSIDE_HIP)).toBe(true)
})

test('the default unlink keeps the file; ticking the toggle deletes it', async ({
  page,
}) => {
  await openCharacter(page)
  // The demo character's primary can't be unlinked, so this drives the Houdini
  // card — the same dialog, the same rules.
  await page.getByRole('button', { name: 'Unlink from character' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Remove Houdini project?' })
  // No toggle touched: the default answer never destroys the file.
  await dialog.getByRole('button', { name: 'Unlink' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await has(page, P.houdini)).toBe(true)

  // Re-link happens via the seed only — a fresh navigation re-seeds the mock;
  // walk back in the way openCharacter does and take the DELETE path.
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByRole('button', { name: 'Unlink from character' }).first().click()
  const again = page.getByRole('dialog', { name: 'Remove Houdini project?' })
  await again.getByRole('switch').click() // arm the delete
  await again.getByRole('button', { name: 'Delete' }).click()
  await expect(again).toHaveCount(0)
  expect(await has(page, P.houdini)).toBe(false)
})
