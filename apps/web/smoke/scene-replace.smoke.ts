import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The primary scene card's browse-to-REPLACE flow: the folder button runs the
// regular Add-scene dialog (validation, copy-vs-link), but the confirm swaps
// `scenePath`, re-derives GEN from the new scene, and (toggle, default on for
// an in-folder old primary) deletes the old scene's files.

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
  // The old primary is an in-folder copy — the cleanup toggle shows, ON.
  const deleteOld = dialog.getByRole('switch').nth(1)
  await expect(dialog.getByText('Delete the old primary scene file')).toBeVisible()
  await expect(deleteOld).toHaveAttribute('data-state', 'checked')

  await dialog.getByRole('button', { name: 'Copy & replace' }).click()
  await expect(page.getByText('Replaced the primary Daz scene')).toBeVisible()
  // The new scene carries no GP/DK geograft — the derivation announces the flip.
  await expect(page.getByText(/Genitalia section disabled/)).toBeVisible()

  // Persisted: scenePath swapped to the in-folder copy, GEN re-derived.
  const json = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!) as {
    scenePath: string
    sections: { GEN: { enabled: boolean } }
  }
  expect(json.scenePath).toBe(`${P.charFolder}/daz3d/NewLook_G9.duf`)
  expect(json.sections.GEN.enabled).toBe(false)

  // Filesystem: the new copy exists, the OLD primary's files are gone.
  const keys = await fileKeys(page)
  expect(keys).toContain(`${P.charFolder}/daz3d/NewLook_G9.duf`)
  expect(keys).not.toContain(P.scene)
  expect(keys).not.toContain(`${P.scene}.tip.png`)

  expect(await unhandledCommands(page)).toEqual([])
})
