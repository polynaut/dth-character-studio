import { expect, test } from '@playwright/test'

// The real path rule, not a restated literal — see rom-animation.ts on why the
// leaf module is imported directly (the package root's `?raw` imports don't
// resolve node-side).
import { romAnimationPath } from '../../../packages/rom/src/rom-animation.ts'

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

// ── Scene deletion cleans up after itself ────────────────────────────────────
// A deleted scene must not leave its subfolder behind: every linked scene lives
// in its own folder below the scenes root, and that folder holds its saved
// `rom-animations/`. Deleting removes the whole folder when the scene has one
// to itself, and only the scene's files + its OWN saved ROM animation when the
// folder is shared (the legacy layout parks several scenes in the root). The
// scene's export folder (`daz-export/<subfolder>/`) goes with it in both modes.

test('deleting a scene with its own subfolder removes the folder, ROM animations included', async ({
  page,
}) => {
  const beach = `${P.charFolder}/daz3d/beach/KiraBeach.duf`
  const beachExport = `${P.exportDir}/beach/KiraBeach.dth`
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  const kira = JSON.parse(seed.files[`${P.charFolder}/Kira.json`])
  kira.extraScenes = [beach]
  seed.files[`${P.charFolder}/Kira.json`] = JSON.stringify(kira, null, 2)
  seed.files[beach] = 'duf-fixture'
  seed.files[romAnimationPath(beach)] = 'duf-rom-animation'
  seed.files[beachExport] = 'dth-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  const card = page.locator('.group\\/card').filter({ hasText: /KiraBeach/ })
  await card.getByRole('button', { name: 'Unlink from character' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove Daz scene?' })
  // The copy names what the delete takes with it — this scene owns its folder,
  // and its export folder goes too.
  await expect(
    dialog.getByText(
      /scene’s folder \(saved ROM animations included\) and its Daz export folder/,
    ),
  ).toBeVisible()
  await dialog.getByRole('switch').click() // arm the delete
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(dialog).toHaveCount(0)

  expect(await has(page, beach)).toBe(false)
  expect(await has(page, romAnimationPath(beach))).toBe(false)
  expect(await has(page, beachExport)).toBe(false)
  // The primary and its tree are untouched.
  expect(await has(page, P.scene)).toBe(true)
})

test('deleting a scene that shares the root folder spares the other scenes’ files', async ({
  page,
}) => {
  // extraScene: the Summertide scene sits DIRECTLY in daz3d/ beside the primary
  // (the legacy layout) — so does the shared rom-animations/ folder. Their
  // export folders fall back to the scene STEMS and stay separate.
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, extraScene: true })
  const primaryExport = `${P.exportDir}/KiraDefault_G9_GP/Kira.dth`
  const extraExport = `${P.exportDir}/KiraSummertide_G9_GP/Kira_KiraSummertide_G9_GP.dth`
  seed.files[romAnimationPath(P.scene)] = 'duf-rom-animation'
  seed.files[romAnimationPath(P.scene2)] = 'duf-rom-animation'
  seed.files[primaryExport] = 'dth-fixture'
  seed.files[extraExport] = 'dth-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  const card = page.locator('.group\\/card').filter({ hasText: /Summertide/ })
  await card.getByRole('button', { name: 'Unlink from character' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove Daz scene?' })
  // Shared folder → the copy promises the scene's own ROM animation + exports.
  await expect(
    dialog.getByText(/its saved ROM animation and its Daz export folder/),
  ).toBeVisible()
  await dialog.getByRole('switch').click() // arm the delete
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(dialog).toHaveCount(0)

  expect(await has(page, P.scene2)).toBe(false)
  expect(await has(page, romAnimationPath(P.scene2))).toBe(false)
  expect(await has(page, extraExport)).toBe(false)
  // The primary, its ROM animation, its exports, and the shared folder survive.
  expect(await has(page, P.scene)).toBe(true)
  expect(await has(page, romAnimationPath(P.scene))).toBe(true)
  expect(await has(page, primaryExport)).toBe(true)
})
