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
    refs: { collapsible: 0, foreign: 0, broken: [], hipRelative: []  },
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

/** A second linked project OUTSIDE the character folder — the sweep never
 *  scans those, so only a store entry or a drawer scan can answer for it. */
const OUTSIDE = 'D:/Templates/G9_Skin_Base.hiplc'
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'

/** A minimal material node the drawer's node picker will name on screen. */
const node = (networkBox: string) => ({
  path: '/obj/DazToHue/DazToHueMaterial',
  name: 'DazToHueMaterial',
  nodeType: 'material',
  networkBox,
  materials: 0,
  uvChannels: 0,
  bakers: 0,
  layers: 0,
  bakerNames: [],
  materialNames: [],
  slots: [],
  sectionCounts: [],
})

/** Link OUTSIDE as the demo character's second project. */
function linkOutside(seed: { files: Record<string, string> }) {
  seed.files[OUTSIDE] = 'hip-fixture'
  const charPath = `${P.charFolder}/Kira.json`
  const char = JSON.parse(seed.files[charPath] ?? '{}')
  char.houdiniProjects = [P.houdini, OUTSIDE]
  seed.files[charPath] = JSON.stringify(char)
}

test('the drawer merges the store with a scan of what it does not cover', async ({ page }) => {
  // One linked project the store answers for (inside the character folder,
  // fresh entry) and one it cannot answer for yet (linked from outside — the
  // sweep skips those by design). The drawer must show BOTH: the cache is only
  // an answer for the projects it covers, and a partial cache silently hiding
  // a linked project from the node lists and the repairs was a real bug.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  // hython configured, so the drawer CAN scan the uncovered link itself.
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: 'C:/Users/dev/Documents/houdini22.0',
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  linkOutside(seed)
  // The fake hython only knows the OUTSIDE project's nodes. If the drawer
  // re-scanned the inside one instead of taking the store's word, its card
  // would come back empty and 'CachedBox' would be missing below.
  seed.materialScan = { [OUTSIDE]: [node('ScannedBox')] }
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: `${P.houdini.toLowerCase()}|__MTIME__`,
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ nodes: [node('CachedBox')] }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.replace('__MTIME__', String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // Two cards, two Utils buttons — either opens the same drawer.
  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('tab', { name: 'Material' }).click()

  // The cached project, served from the store…
  await expect(drawer.getByText('CachedBox')).toBeVisible()
  // …and the outside link, scanned on the spot and merged in.
  await expect(drawer.getByText('ScannedBox')).toBeVisible()

  // The drawer's own scan persisted under the CHARACTER's store — target scans
  // carry the character scope, so what the drawer earns is what the card badge
  // and the next open read (not the shared source store).
  await expect
    .poll(async () =>
      page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? '') as string, STORE),
    )
    .toContain('g9_skin_base')
})

test('a store that covers every linked project serves the drawer without a scan', async ({
  page,
}) => {
  // Both projects fresh in the store — the outside one earned by a previous
  // drawer open (the sweep's prune keeps everything still LINKED, it does not
  // throw drawer-earned scans away). No hython is configured here, so if the
  // drawer tried to scan ANYTHING the picker would show an error instead of
  // these nodes.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  linkOutside(seed)
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: `${P.houdini.toLowerCase()}|__MTIME__`,
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ nodes: [node('CachedBox')] }),
      },
      [OUTSIDE.toLowerCase()]: {
        key: `${OUTSIDE.toLowerCase()}|__MTIME__`,
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ hipPath: OUTSIDE, nodes: [node('OutsideBox')] }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.addInitScript((storePath: string) => {
    const mock = (window as any).__tauriMock
    const raw = mock.files.get(storePath) as string
    mock.files.set(storePath, raw.split('__MTIME__').join(String(mock.mtimeMs)))
  }, STORE)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  await page.getByRole('button', { name: /^Utils/ }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('tab', { name: 'Material' }).click()

  await expect(drawer.getByText('CachedBox')).toBeVisible()
  await expect(drawer.getByText('OutsideBox')).toBeVisible()
})

test('unresolved imports and blank parms are both named', async ({ page }) => {
  await openWithStore(
    page,
    scan({
      refs: { collapsible: 0, foreign: 0, broken: ['/obj/dth import_character_dtu_file'], hipRelative: []  },
      prefill: { fillable: ['export_directory'], missing: [] },
    }),
  )

  const badge = page.getByText('Needs attention')
  await expect(badge).toBeVisible()
  const title = (await badge.getAttribute('title')) ?? ''
  expect(title).toContain('import_character_dtu_file')
  expect(title).toContain('export_directory')
})

test('a badge from a STALE store clears itself once the sweep re-reads the project', async ({
  page,
}) => {
  // The contradiction this guards: the card said "Needs attention" while the
  // Utils drawer — which scans live — reported every check passing. The badge
  // is painted from the STORE, and the sweep that refreshes the store was
  // started un-awaited, so nothing ever re-read it.
  //
  // Seeded here as a store entry whose key no longer matches the file (a stale
  // scan, exactly what a regenerated project leaves behind): the first paint
  // has nothing to show, and the sweep's fresh result must land without a
  // reload.
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  seed.files[STORE] = JSON.stringify({
    version: 1,
    projects: {
      [P.houdini.toLowerCase()]: {
        key: `${P.houdini.toLowerCase()}|1`,
        scannedAt: '2026-08-07T00:00:00.000Z',
        project: scan({ job: 'D:/DTH Projects/Demo/Ita' }),
      },
    },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // The stale entry keys on a mtime the file no longer has, so it is ignored —
  // and the badge must not appear on the strength of it.
  await expect(page.getByText('Needs attention')).toHaveCount(0)
})
