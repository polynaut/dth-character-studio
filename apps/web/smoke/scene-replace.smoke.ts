import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The primary scene card's browse-to-REPLACE flow: the folder button runs the
// regular Add-scene dialog (validation, copy-vs-link), but the confirm swaps
// `scenePath`, re-derives GEN from the new scene, and (toggle, default on for
// an in-folder old primary) deletes the old scene's files.
//
// It is offered ONLY while the primary is the character's only scene — see the
// second test for why.

const NEW_SCENE = 'X:/scenes/NewLook_G9.duf'

const fileKeys = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

test('replace primary: validates, swaps, derives GEN, deletes the old copy', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.files[NEW_SCENE] = 'duf-fixture-new'
  seed.dialogPath = NEW_SCENE
  seed.sceneFigure = { id: 'Genesis9', label: 'Kira' }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The primary card's hover folder button opens the replace dialog.
  await page.getByRole('button', { name: 'Replace with another Daz scene…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Replace the primary Daz scene?' })
  await expect(dialog).toBeVisible()
  // The old primary is an in-folder copy — no toggle, no notice: replacing
  // always deletes the studio-owned old copy (asserted on the fs below).

  await dialog.getByRole('button', { name: 'Copy & replace' }).click()
  await expect(page.getByText('Replaced the primary Daz scene')).toBeVisible()
  // The new scene carries no GP/DK geograft — the derivation announces the flip.
  await expect(page.getByText(/Genitalia section disabled/)).toBeVisible()

  // Persisted: scenePath swapped to the in-folder copy — in the primary's own
  // "primary" subfolder (every scene lives in its own subfolder now) — and GEN
  // re-derived.
  const json = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!) as {
    scenePath: string
    sections: { GEN: { enabled: boolean } }
  }
  expect(json.scenePath).toBe(`${P.charFolder}/daz3d/primary/NewLook_G9.duf`)
  expect(json.sections.GEN.enabled).toBe(false)

  // Filesystem: the new copy exists, the OLD primary's files are gone.
  const keys = await fileKeys(page)
  expect(keys).toContain(`${P.charFolder}/daz3d/primary/NewLook_G9.duf`)
  expect(keys).not.toContain(P.scene)
  expect(keys).not.toContain(`${P.scene}.tip.png`)

  expect(await unhandledCommands(page)).toEqual([])
})

test('replace primary is refused while the character has other scenes', async ({ page }) => {
  // Every extra scene was validated against the CURRENT primary — same Genesis,
  // one figure, empty timeline, and the same GP/DK geograft, because every
  // scene must produce the primary's skeleton. Swapping the primary re-decides
  // that reference: a replacement without Golden Palace would leave a set of
  // validated extras silently mismatched, and nothing re-checks them. So the
  // user unlinks first and re-adds against the new primary, which runs the real
  // validation for each one.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, extraScene: true })
  seed.files[NEW_SCENE] = 'duf-fixture-new'
  seed.dialogPath = NEW_SCENE
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  // The button is still THERE — a control that vanishes reads as a missing
  // feature — but it refuses, and its tooltip says what to do about it.
  const replace = page.getByRole('button', { name: /Unlink the other scene/ })
  await expect(replace).toBeVisible()
  await expect(replace).toBeDisabled()
  // …and no replace dialog can be reached.
  await expect(
    page.getByRole('dialog', { name: 'Replace the primary Daz scene?' }),
  ).toHaveCount(0)

  expect(await unhandledCommands(page)).toEqual([])
})
