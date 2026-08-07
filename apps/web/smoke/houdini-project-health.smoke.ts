import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The warning badge on a Houdini project card.
//
// It is read from the STORE a background scan fills, never from a scan of its
// own — so these specs seed the store and check what the card says. That is also
// the honest shape of the feature: opening a character page reads instantly and
// kicks a sweep off for next time; it never blocks on hython.

/** The character's scan store, in its `.dcsmeta` folder. */
const STORE = `${P.project}/.dcsmeta/characters/Kira/houdini-scan.json`

/** A scan result in the shape `material_utils.py` reports. */
function scan(over: Record<string, unknown> = {}) {
  return {
    hipPath: P.houdini,
    ok: true,
    error: '',
    nodes: [],
    job: P.charFolder,
    refs: { collapsible: 0, foreign: 0, broken: [] },
    prefill: { fillable: [], missing: [] },
    ...over,
  }
}

async function openWithStore(page: Page, project: Record<string, unknown>) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: `${P.houdini.toLowerCase()}|__MTIME__`,
        scannedAt: '2026-08-07T00:00:00.000Z',
        project,
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  // The store keys on `<path>|<mtime>`, and the fake stamps its world when it is
  // installed — so the seeded entry gets that stamp here, after install.
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.replace('__MTIME__', String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

test('a project whose $JOB points elsewhere is flagged on its card', async ({ page }) => {
  // Exactly the state a COPIED project arrives in: the scene carries the
  // source's $JOB, so every path it stores collapses against the wrong folder.
  await openWithStore(page, scan({ job: 'D:/DTH Projects/Demo/Ita' }))

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('title', /\$JOB points at D:\/DTH Projects\/Demo\/Ita/)
})

test('a wired project shows no badge', async ({ page }) => {
  await openWithStore(page, scan())
  await expect(page.getByText('Needs attention')).toHaveCount(0)
})

test('unresolved imports and blank parms are both named', async ({ page }) => {
  await openWithStore(
    page,
    scan({
      refs: { collapsible: 0, foreign: 0, broken: ['/obj/dth import_character_dtu_file'] },
      prefill: { fillable: ['export_directory'], missing: [] },
    }),
  )

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  const title = (await badge.getAttribute('title')) ?? ''
  expect(title).toContain('import_character_dtu_file')
  expect(title).toContain('export_directory')
})
