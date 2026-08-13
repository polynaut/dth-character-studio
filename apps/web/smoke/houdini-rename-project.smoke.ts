import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Renaming a linked Houdini project from its card title — the wiring half of
// the feature (`src/lib/rom/houdini-rename-project.test.ts` pins the api
// contract, including the extension rule, without a browser).
//
// Renaming is offered where MOVING is not, and that is the whole design: a
// generated project bakes `$JOB` (the character folder) and `$HIP` (the folder
// the file sits in), both FOLDER variables, so the file's own name is the one
// thing about its location that no baked reference depends on.
//
// The names here are the reported ones: a project generated before #809 carried
// `<project>_<character>_<figure>`, which is exactly the mouthful this feature
// exists to let the user shorten.

const GENERATED = `${P.charFolder}/houdini/3d-workflow_LaraCroft_G81.hiplc`
const RENAMED = `${P.charFolder}/houdini/Lara.hiplc`
/** The user's OWN project, linked in place from their own tree. */
const OUTSIDE = 'D:/Templates/G9_Skin_Base.hip'

const has = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, path)
const linked = (page: Page) =>
  page.evaluate(
    (p) => JSON.parse(((window as any).__tauriMock.files.get(p) ?? '{}') as string).houdiniProjects,
    `${P.charFolder}/Kira.json`,
  )

async function open(page: Page, projects: Array<string>) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  // Link exactly the projects this spec is about. Patched into the seeded
  // definition rather than added through the UI: the linking flow is the copy
  // spec's subject, and driving it here would make a rename test fail for
  // reasons that have nothing to do with renaming.
  const defPath = `${P.charFolder}/Kira.json`
  const def = JSON.parse(seed.files[defPath])
  def.houdiniProjects = projects
  seed.files[defPath] = JSON.stringify(def)
  // Every linked project must EXIST, or the card renders the dashed
  // "missing on disk" state instead and there is no title to click.
  for (const p of projects) seed.files[p] = 'hip-fixture'

  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

test('the card title renames the file on disk and repoints the link', async ({ page }) => {
  await open(page, [GENERATED])

  // The title is a real button (EditableTitle) — located by ROLE, never by
  // title attribute (the kit's TooltipHost rewrites those; see .ai/gotchas.md).
  await page.getByRole('button', { name: 'Rename Houdini project — 3d-workflow_LaraCroft_G81' }).click()
  const input = page.getByRole('textbox', { name: 'Houdini project name' })
  await input.fill('Lara')
  await input.press('Enter')

  // Assert the PERSISTED outcome, not the toast: relinking wakes the background
  // scan sweep, so this path is slower under CI load than locally, and a toast
  // is transient. The definition on disk has no such window.
  await expect.poll(() => linked(page), { timeout: 20_000 }).toEqual([RENAMED])
  expect(await has(page, RENAMED)).toBe(true)
  // A RENAME, not a copy — the old name is gone.
  expect(await has(page, GENERATED)).toBe(false)
  await expect(page.getByRole('button', { name: 'Rename Houdini project — Lara' })).toBeVisible()
})

test('fixing only the CAPITALISATION still repoints the card', async ({ page }) => {
  // The narrow case that slips through two different "nothing changed" guards:
  // the api's (on Windows the destination IS the source, so the collision check
  // must be skipped) and the field's (a case-folding comparison would treat the
  // repoint as unnecessary and leave the card showing the old spelling). Only
  // an end-to-end run exercises both at once.
  const LOWER = `${P.charFolder}/houdini/lara.hiplc`
  await open(page, [LOWER])

  await page.getByRole('button', { name: 'Rename Houdini project — lara' }).click()
  const input = page.getByRole('textbox', { name: 'Houdini project name' })
  await input.fill('Lara')
  await input.press('Enter')

  await expect.poll(() => linked(page), { timeout: 20_000 }).toEqual([RENAMED])
  expect(await has(page, RENAMED)).toBe(true)
  await expect(page.getByRole('button', { name: 'Rename Houdini project — Lara' })).toBeVisible()
})

test('a project linked from the user’s own tree has no editable title', async ({ page }) => {
  // The studio renames files it put there; a project linked in place is the
  // user's own, sitting in a tree the studio cannot see the rest of. Same rule
  // the Daz scenes apply — and the card still works, it just has no pencil.
  await open(page, [OUTSIDE])

  await expect(page.getByText('G9_Skin_Base')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Rename Houdini project — G9_Skin_Base/ })).toHaveCount(0)
  // Nothing was renamed away — the file is exactly where the user has it.
  expect(await has(page, OUTSIDE)).toBe(true)
})
