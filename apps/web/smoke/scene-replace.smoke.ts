import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The primary scene card's browse-to-REPLACE flow: the folder button runs the
// regular Add-scene dialog (validation, copy-vs-link), but the confirm swaps
// `scenePath`, re-derives GEN from the new scene, and (toggle, default on for
// an in-folder old primary) deletes the old scene's files.

const NEW_SCENE = 'X:/scenes/NewLook_G9.duf'
/** Where the replacement lands once copied in (every scene gets its own
 *  subfolder; the primary's is "primary"). */
const COPIED_SCENE = `${P.charFolder}/daz3d/primary/NewLook_G9.duf`
/** The replacement scene's own hair — a different style from the old primary's,
 *  so the seeded list can only have come from the NEW scene's read. */
const NEW_HAIR = 'Aria Braids Hair'

const fileKeys = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

test('replace primary: validates, swaps, derives GEN, seeds hair, deletes the old copy', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  seed.files[NEW_SCENE] = 'duf-fixture-new'
  seed.dialogPath = NEW_SCENE
  seed.sceneFigure = { id: 'Genesis9', label: 'Kira' }
  // The replacement carries its own hair — keyed on BOTH paths: the dialog
  // validates the picked file, the seeding scans the copied-in one.
  const newHair = [{ id: 'aria-braids-hair', label: NEW_HAIR, conformTarget: '#Genesis9' }]
  seed.sceneWearables = {
    ...(seed.sceneWearables ?? {}),
    [NEW_SCENE]: newHair,
    [COPIED_SCENE]: newHair,
  }
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
    sceneOverrides: Array<{ scenePath: string; hair: Array<{ nodeLabel: string }> }>
  }
  expect(json.scenePath).toBe(COPIED_SCENE)
  expect(json.sections.GEN.enabled).toBe(false)

  // The new primary's own hair is pre-selected — a replacement is a different
  // scene with different hair, and unlisted hair rides into the FBX.
  const seeded = json.sceneOverrides.find((o) => o.scenePath === COPIED_SCENE)
  expect(seeded?.hair.map((h) => h.nodeLabel)).toEqual([NEW_HAIR])

  // Filesystem: the new copy exists, the OLD primary's files are gone.
  const keys = await fileKeys(page)
  expect(keys).toContain(COPIED_SCENE)
  expect(keys).not.toContain(P.scene)
  expect(keys).not.toContain(`${P.scene}.tip.png`)

  expect(await unhandledCommands(page)).toEqual([])
})
