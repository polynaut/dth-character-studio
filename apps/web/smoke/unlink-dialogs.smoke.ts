import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The two remove dialogs — a Daz scene and a Houdini project — are one dialog
// asking one question, and the answer follows WHERE the file is:
//
//   inside the character folder  → the studio's own copy → default Remove
//   outside it                   → the user's original   → Unlink only
//
// They used to differ in wording AND in polarity (a "Delete file on disk"
// toggle off-by-default against a "Keep houdini files" toggle on-by-default),
// which read as two unrelated features. These specs pin the shared shape and
// the destructive default, because a default that deletes has to be deliberate.

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

test('a project inside the character folder defaults to Remove', async ({ page }) => {
  await openCharacter(page)
  await page.getByRole('button', { name: 'Unlink from character' }).first().click()

  const dialog = page.getByRole('dialog', { name: 'Remove Houdini project?' })
  // The studio's own copy: the switch is ON and the button says what will
  // happen to the file.
  await expect(dialog.getByRole('switch')).toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Remove' })).toBeVisible()

  // Turning it off makes it an unlink, and the button follows.
  await dialog.getByRole('switch').click()
  await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeVisible()
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

test('removing a scene inside the folder deletes the file; the toggle keeps it', async ({
  page,
}) => {
  await openCharacter(page)
  // The demo character's primary can't be unlinked, so this drives the Houdini
  // card — the same dialog, the same rules.
  await page.getByRole('button', { name: 'Unlink from character' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Remove Houdini project?' })
  await dialog.getByRole('switch').click() // keep the file
  await dialog.getByRole('button', { name: 'Unlink' }).click()

  await expect(dialog).toHaveCount(0)
  // Unlinked, not deleted — the file the user asked to keep is still there.
  expect(await has(page, P.houdini)).toBe(true)
})
