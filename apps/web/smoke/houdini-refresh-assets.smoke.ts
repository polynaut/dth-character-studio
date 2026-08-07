import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'
import type { TauriMockSeed } from './tauri-mock.ts'

// The General tab's "Refresh assets": the studio running the DazToHue shelf's
// OWN tool against a project, the way a user would from inside Houdini.
//
// Nothing here impersonates that tool — there is no Houdini and no shelf — so
// what these specs assert is the studio's half: that every readable project is
// offered (no check gates this one, because none can), what the request asks
// for, and that the report says only what was actually observed.

const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'
/** Where the fake's `_backup` lands for the demo character's linked project. */
const BACKUP = `${P.charFolder}/houdini/backup/Kira_dthbak.hip`

/** A readable project with the `$JOB` the studio expects — so the tab's three
 *  CHECKS are all quiet and only the refresh action is on offer. */
function healthySeed(): TauriMockSeed {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.materialScan = { [P.houdini]: [] }
  seed.materialJob = { [P.houdini]: P.charFolder }
  return seed
}

/** Open the drawer (it opens on General) and get to the refresh confirm modal. */
async function openRefresh(page: Page, seed: TauriMockSeed) {
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: /^Utils/ }).click()
  const drawer = page.getByRole('dialog')
  // The scan landed and found nothing to fix — the refresh is offered anyway.
  await expect(drawer.getByText('Nothing to fix — every check already passes.')).toBeVisible()

  await drawer.getByRole('button', { name: 'Refresh assets' }).click()
  return {
    drawer,
    confirm: page.getByRole('dialog', { name: 'Refresh the DazToHue assets?' }),
  }
}

/**
 * The last material-utility request the studio wrote.
 *
 * Read from the fake's own record, not from its filesystem: the studio deletes
 * the request file as soon as the run returns.
 */
async function lastRequest(page: Page) {
  return page.evaluate(() => {
    const seen = (window as any).__tauriMock.materialRequests as Array<Record<string, unknown>>
    return seen[seen.length - 1]
  })
}

test('a run asks for every readable project and reports the tool that ran', async ({ page }) => {
  const { drawer, confirm } = await openRefresh(page, healthySeed())
  await expect(confirm.getByText('Kira.hip')).toBeVisible()

  await confirm.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('1 project refreshed and saved.')).toBeVisible()

  // The op and its targets come off the request file the real Python reads.
  const request = await lastRequest(page)
  expect(request.op).toBe('refresh')
  expect(request.dryRun).toBe(false)
  expect(request.targets).toEqual([{ hipPath: P.houdini }])

  // Reported by what happened: the tool that ran, and that the scene came back
  // modified — never a claim about WHAT the third-party tool changed. The modal
  // closed on success, so the report is the drawer's.
  await expect(drawer.getByText(/Refresh Assets.*ran/)).toBeVisible()
  await expect(drawer.getByText(/reported changes and was saved/)).toBeVisible()
})

test('a project the shelf tool was not found for names what WAS on the shelf', async ({ page }) => {
  const seed = healthySeed()
  seed.materialRefresh = {
    [P.houdini]: {
      ok: false,
      error: 'No "Refresh Assets" tool was found on the DazToHue shelf.',
      availableTools: ['DazToHue', 'Open Documentation'],
    },
  }
  const { confirm } = await openRefresh(page, seed)
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()

  await expect(page.getByText('1 of 1 projects failed — see below.')).toBeVisible()
  // The one failure the user can act on, so it is a diagnosis and not a wall.
  await expect(
    confirm.getByText(/On the DazToHue shelf hython could see: DazToHue, Open Documentation\./),
  ).toBeVisible()
})

test('a dry run runs the tool and saves nothing', async ({ page }) => {
  const { confirm } = await openRefresh(page, healthySeed())
  await confirm.getByRole('button', { name: 'Dry run' }).click()

  // The honest wording: this executes third-party code, so "not saved" is the
  // promise — not the other dry runs' "nothing was written".
  await expect(confirm.getByText('Dry run — no project file was saved')).toBeVisible()
  expect(await lastRequest(page)).toMatchObject({ op: 'refresh', dryRun: true })

  const files = await page.evaluate(
    () => [...(window as any).__tauriMock.files.keys()] as Array<string>,
  )
  expect(files).not.toContain(BACKUP)
})

test('a project that reported no change is not re-saved', async ({ page }) => {
  const seed = healthySeed()
  seed.materialRefresh = { [P.houdini]: { changed: false } }
  const { confirm } = await openRefresh(page, seed)
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()

  await expect(
    page.getByText('Refreshed — no project reported a change, so nothing was re-saved.'),
  ).toBeVisible()
  const files = await page.evaluate(
    () => [...(window as any).__tauriMock.files.keys()] as Array<string>,
  )
  expect(files).not.toContain(BACKUP)
})
