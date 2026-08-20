import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'
import type { TauriMockSeed } from './tauri-mock.ts'

// Tools → Refresh assets offering the OTHER half of the pipeline: DazToHue's own
// "Refresh Assets", run across every linked Houdini project, when the DTH
// release changed since the studio last looked.
//
// Nothing here impersonates that shelf tool — there is no Houdini and no shelf —
// so what these specs hold down is the studio's half: WHEN the offer appears,
// which projects it asks for, and that a run which did not fully succeed leaves
// the release outstanding instead of marking it handled.

const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'
/** The release the demo project's fixtures are generated against. */
const ACTIVE_DTH = '2.4.3'
/** The store the app keeps of what it has refreshed, and under which release. */
const STORE = `${P.appData}/houdini-refresh.json`
/** Where `_backup` writes the demo character's linked project — the ROLLING
 *  copy a run replaces, which is what the fat warning is about. */
const BACKUP = `${P.charFolder}/houdini/backup/Kira_dthbak.hip`

/**
 * A machine where the sweep CAN run (hython resolvable), with the studio's
 * record of the DTH release seeded to `lastSeen` — '' for a first-ever look.
 */
function seedFor(lastSeen: string, projects: Record<string, unknown> = {}): TauriMockSeed {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.files[STORE] = JSON.stringify({ version: 1, lastSeenDthVersion: lastSeen, projects })
  return seed
}

async function runStudioRefresh(page: Page, seed: TauriMockSeed) {
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Tools/ }).click()
  await page.getByRole('tab', { name: /Refresh assets/ }).click()
  await page.getByRole('button', { name: /^Refresh assets$/ }).click()
  return page.getByRole('dialog', { name: 'Also refresh the DazToHue assets in Houdini?' })
}

/** The last material-utility request the studio wrote (the fake's own record —
 *  the studio deletes the request file as soon as the run returns). */
function lastRequest(page: Page) {
  return page.evaluate(() => {
    const seen = (window as any).__tauriMock.materialRequests as Array<Record<string, unknown>>
    return seen[seen.length - 1]
  })
}

function readStore(page: Page) {
  return page.evaluate((path) => {
    const text = ((window as any).__tauriMock.files as Map<string, string>).get(path)
    return text ? JSON.parse(text) : null
  }, STORE)
}

test('a changed DTH release offers the linked projects, and a clean run records it', async ({
  page,
}) => {
  const offer = await runStudioRefresh(page, seedFor('2.3.0'))

  // Offered because the studio recorded a DIFFERENT release last time — and the
  // one linked project has never been swept, which the offer says plainly
  // rather than dressing up as a verdict.
  await expect(offer.getByText('Kira.hip')).toBeVisible()
  await expect(offer.getByText(/never refreshed by the studio/)).toBeVisible()
  await expect(offer.getByText(/it was 2\.3\.0 the last time/)).toBeVisible()

  await offer.getByRole('button', { name: /^Refresh 1 project$/ }).click()
  await expect(page.getByText('1 project refreshed and saved.')).toBeVisible()

  // It ran DazToHue's own tool, on exactly the linked project.
  const request = await lastRequest(page)
  expect(request.op).toBe('refresh')
  expect(request.dryRun).toBe(false)
  expect(request.targets).toEqual([{ hipPath: P.houdini }])

  // The clean run stamps the project AND marks the release handled, so a later
  // refresh has nothing left to say.
  await expect.poll(async () => (await readStore(page))?.lastSeenDthVersion).toBe(ACTIVE_DTH)
  const store = await readStore(page)
  expect(store.projects[P.houdini.toLowerCase()].dthVersion).toBe(ACTIVE_DTH)
})

test('a first-ever look records the release but offers nothing', async ({ page }) => {
  const offer = await runStudioRefresh(page, seedFor(''))

  // "I have never looked" is not "it changed" — an offer here would be a guess
  // dressed as a finding. The release is recorded so the NEXT change fires.
  await expect(page.getByText(/Refreshed 1 character|No characters to refresh/)).toBeVisible()
  await expect(offer).toBeHidden()
  await expect.poll(async () => (await readStore(page))?.lastSeenDthVersion).toBe(ACTIVE_DTH)
})

test('a project already refreshed under the active release is not offered again', async ({
  page,
}) => {
  const seed = seedFor('2.3.0', {
    [P.houdini.toLowerCase()]: { dthVersion: ACTIVE_DTH, refreshedAt: '2026-08-19T00:00:00.000Z' },
  })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Tools/ }).click()
  await page.getByRole('tab', { name: /Refresh assets/ }).click()
  await page.getByRole('button', { name: /^Refresh assets$/ }).click()

  // The release changed, but every linked project is already on it — nothing to
  // run, so nothing is asked.
  await expect(
    page.getByRole('dialog', { name: 'Also refresh the DazToHue assets in Houdini?' }),
  ).toBeHidden()
  await expect.poll(async () => (await readStore(page))?.lastSeenDthVersion).toBe(ACTIVE_DTH)
})

test('a failed run leaves the release outstanding so the next refresh re-offers it', async ({
  page,
}) => {
  const seed = seedFor('2.3.0')
  seed.materialRefresh = {
    [P.houdini]: {
      ok: false,
      error: 'No "Refresh Assets" tool was found on the DazToHue shelf.',
      availableTools: ['DazToHue'],
    },
  }
  const offer = await runStudioRefresh(page, seed)
  await offer.getByRole('button', { name: /^Refresh 1 project$/ }).click()

  await expect(page.getByText('1 of 1 projects failed — see the report.')).toBeVisible()
  // The one failure a user can act on, so it is a diagnosis and not a wall.
  await expect(offer.getByText(/On the DazToHue shelf hython could see: DazToHue\./)).toBeVisible()

  // NOT marked handled: the common cause of this failure (DazToHue not installed
  // for this Houdini) is one the user fixes and then expects to retry.
  const store = await readStore(page)
  expect(store.lastSeenDthVersion).toBe('2.3.0')
  expect(store.projects).toEqual({})
})

test('a dry run runs the tool, saves nothing, and claims nothing', async ({ page }) => {
  const offer = await runStudioRefresh(page, seedFor('2.3.0'))
  await offer.getByRole('button', { name: 'Dry run' }).click()

  // The honest wording: this executes third-party code, so "not saved" is the
  // promise — not the other dry runs' "nothing was written".
  await expect(offer.getByText('Dry run — no project file was saved')).toBeVisible()
  expect(await lastRequest(page)).toMatchObject({ op: 'refresh', dryRun: true })

  // A dry run leaves the file on its old definitions, so it stamps nothing.
  const store = await readStore(page)
  expect(store.lastSeenDthVersion).toBe('2.3.0')
  expect(store.projects).toEqual({})
})

test('dismissing writes nothing, so the offer returns on the next refresh', async ({ page }) => {
  const offer = await runStudioRefresh(page, seedFor('2.3.0'))
  await offer.getByRole('button', { name: 'Not now' }).click()
  await expect(offer).toBeHidden()

  const store = await readStore(page)
  expect(store.lastSeenDthVersion).toBe('2.3.0')

  await page.getByRole('button', { name: /^Refresh assets$/ }).click()
  await expect(
    page.getByRole('dialog', { name: 'Also refresh the DazToHue assets in Houdini?' }),
  ).toBeVisible()
})

// --- the existing-backup warning -------------------------------------------
//
// `_backup` keeps ONE rolling copy per project, so a run overwrites whatever is
// beside it — including the copy somebody kept to get a project back onto an
// older DazToHue release. These hold down that the loss is named, gated and
// then actually performed, rather than happening quietly inside the run.

/** Does the fake world still hold this file? */
function fileExists(page: Page, path: string) {
  return page.evaluate(
    (p) => ((window as any).__tauriMock.files as Map<string, string>).has(p),
    path,
  )
}

test('an existing backup is named, and the run is held until that is accepted', async ({
  page,
}) => {
  const seed = seedFor('2.3.0')
  seed.files[BACKUP] = 'an-older-backup'
  const offer = await runStudioRefresh(page, seed)

  await expect(offer.getByText(/1 project already has a studio backup/)).toBeVisible()
  await expect(offer.getByText('Kira_dthbak.hip')).toBeVisible()

  // Held: the destructive step has to be accepted before the run can start.
  const run = offer.getByRole('button', { name: /^Refresh 1 project$/ })
  await expect(run).toBeDisabled()

  await offer.getByRole('switch').click()
  await expect(run).toBeEnabled()
  await run.click()

  await expect(page.getByText('1 project refreshed and saved.')).toBeVisible()

  // The delete is the claim, so it is what gets asserted — and that it happened
  // BEFORE hython, in one visible step, rather than being an overwrite noticed
  // afterwards. (`files` alone cannot tell the two apart: the run's own
  // `_backup` puts a copy back at the same path either way.)
  const order = await page.evaluate((backup) => {
    const calls = (window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>
    return {
      removed: calls.findIndex(
        (c) => c.cmd === 'plugin:fs|remove' && c.args?.path === backup,
      ),
      ran: calls.findIndex((c) => c.cmd === 'run_houdini_material_util'),
    }
  }, BACKUP)
  expect(order.removed).toBeGreaterThanOrEqual(0)
  expect(order.ran).toBeGreaterThan(order.removed)

  // And the run put its OWN copy back, which is what the report's Undo needs.
  expect(await fileExists(page, BACKUP)).toBe(true)
})

test('a dry run destroys no backup, and needs no acceptance to say so', async ({ page }) => {
  const seed = seedFor('2.3.0')
  seed.files[BACKUP] = 'an-older-backup'
  const offer = await runStudioRefresh(page, seed)

  // A dry run never saves, so it never reaches `_backup` — it is not gated.
  const dry = offer.getByRole('button', { name: 'Dry run' })
  await expect(dry).toBeEnabled()
  await dry.click()

  await expect(offer.getByText('Dry run — no project file was saved')).toBeVisible()
  expect(await page.evaluate(
    (p) => ((window as any).__tauriMock.files as Map<string, string>).get(p),
    BACKUP,
  )).toBe('an-older-backup')
})

test('no existing backup, no warning — and nothing to accept', async ({ page }) => {
  const offer = await runStudioRefresh(page, seedFor('2.3.0'))
  await expect(offer.getByText(/already has a studio backup/)).toBeHidden()
  await expect(offer.getByRole('button', { name: /^Refresh 1 project$/ })).toBeEnabled()
})
