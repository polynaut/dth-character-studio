import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Renaming a character that HAS exports: the warning, and what confirming it
// actually does to the disk.
//
// The layer this belongs in: the rule for which folders are cleared is pure and
// unit-tested (`lib/rom/rename-exports.test.ts`), but "the dialog appears, and
// the files are gone afterwards" spans the title editor, the impact read, the
// save's folder rename and the cleanup — which only the real SPA against the
// fake native layer can answer.

const files = (page: Page) =>
  page.evaluate(() => [...(window as any).__tauriMock.files.keys()] as Array<string>)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/** The Daz→Houdini set of one scene, plus the final Unreal-bound tree — both
 *  named after the character, which is what makes them dead the moment it is
 *  renamed. Sizes don't matter here; the count does. */
const EXPORTS = {
  [`${P.exportDir}/primary/Kira.dth`]: 'dth',
  [`${P.exportDir}/primary/Kira.fbx`]: 'fbx',
  [`${P.exportDir}/primary/Kira_pose_asset.csv`]: 'csv',
  [`${P.charFolder}/export/Kira/DTH_Kira.dth`]: 'dth',
} as const

/** Houdini paired in Settings — what the retarget leg needs to run at all
 *  (`resolveHython`: an install folder, a real `hython.exe`, and a docs folder
 *  matching the install's version). */
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/dev/Documents/houdini22.0'

function seedWithExports(opts: { houdini?: boolean; exports?: boolean } = {}) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, houdiniProject: true })
  if (opts.exports !== false) Object.assign(seed.files, EXPORTS)
  if (opts.houdini) {
    const settingsPath = `${P.appData}/settings.json`
    seed.files[settingsPath] = JSON.stringify({
      ...JSON.parse(seed.files[settingsPath] ?? '{}'),
      houdiniInstallFolder: HOUDINI_INSTALL,
      houdiniDocsFolder: HOUDINI_DOCS,
    })
    seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  }
  return seed
}

async function openCharacterWithExports(
  page: Page,
  opts: { houdini?: boolean; exports?: boolean } = {},
) {
  await page.addInitScript(installTauriMock, seedWithExports(opts))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText('G9 · DQS · 0 custom ROM frames')).toBeVisible()
}

async function renameTo(page: Page, name: string) {
  await page.getByRole('button', { name: 'Rename — Kira', exact: true }).click()
  const input = page.getByRole('textbox').first()
  await input.fill(name)
  await input.press('Enter')
}

test('renaming with exports on disk warns first, then clears them', async ({ page }) => {
  await openCharacterWithExports(page)
  await renameTo(page, 'Nova')

  // The warning names both trees and what it costs — "all export files" is an
  // abstraction, a file count is a decision. Scoped to the dialog: the page
  // behind it shows the same export path in the character's own folder chip.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Rename “Kira” to “Nova”?')).toBeVisible()
  await expect(dialog.getByText('houdini/daz-export', { exact: true })).toBeVisible()
  await expect(dialog.getByText('3 files ·', { exact: false })).toBeVisible()
  await expect(dialog.getByText('1 file ·', { exact: false })).toBeVisible()

  await dialog.getByRole('button', { name: 'Delete exports and rename' }).click()
  await expect(page.getByText(/Renamed to “Nova”/)).toBeVisible()

  // The exports travelled with the folder rename, so they are under the NEW
  // folder by the time the cleanup runs — and both trees are empty afterwards.
  await expect
    .poll(async () => (await files(page)).filter((p) => /\/(daz-export|export)\/.*Kira/i.test(p)))
    .toEqual([])
  // …while the character's own files are exactly where the rename put them.
  expect(await files(page)).toContain(`${P.project}/Nova/Nova.json`)

  expect(await unhandledCommands(page)).toEqual([])
})

test('cancelling the warning renames nothing and keeps the exports', async ({ page }) => {
  await openCharacterWithExports(page)
  await renameTo(page, 'Nova')

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Rename “Kira” to “Nova”?')).toBeVisible()
  // Houdini is NOT paired in this seed, so the linked project cannot be
  // repointed — and the heading says the thing that will actually happen. A
  // "1 Houdini project is repointed" above a note explaining that it can't be
  // is the half a user reads.
  await expect(dialog.getByText('1 Houdini project imports the old exports')).toBeVisible()
  await expect(dialog.getByText(/can’t be repointed right now/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // The title goes back to the old name (EditableTitle renders the character's
  // own `name`, so a cancelled commit needs no rollback of its own)…
  await expect(page.getByRole('button', { name: 'Rename — Kira', exact: true })).toBeVisible()
  // …and every export file is still there, under the old folder.
  expect(await files(page)).toEqual(expect.arrayContaining(Object.keys(EXPORTS)))

  expect(await unhandledCommands(page)).toEqual([])
})

test('with Houdini paired, the rename is followed into the linked project', async ({ page }) => {
  await openCharacterWithExports(page, { houdini: true })
  await renameTo(page, 'Nova')

  const dialog = page.getByRole('dialog')
  // No "can't be repointed" note this time — hython resolves, so the promise the
  // dialog makes about the projects is one it can keep.
  await expect(dialog.getByText('1 Houdini project is repointed')).toBeVisible()
  await expect(dialog.getByText(/can’t be repointed right now/)).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Delete exports and rename' }).click()

  await expect(page.getByText(/repointed 1 Houdini project/)).toBeVisible()

  // What the studio ASKED for — the half a fake can answer honestly (the rule
  // itself is Python). `$JOB` is repointed at the new folder first, because the
  // rename moved it; then the retarget carries both names and both folders.
  const requests = await page.evaluate(
    () => (window as any).__tauriMock.materialRequests as Array<Record<string, any>>,
  )
  const defaults = requests.find((r) => r.op === 'defaults')
  expect(defaults?.targets?.[0]?.jobDir).toBe(`${P.project}/Nova`)
  const retarget = requests.find((r) => r.op === 'retarget')
  expect(retarget?.dryRun).toBe(false)
  expect(retarget?.targets).toEqual([
    {
      // The `.hip` travelled with the character folder, so the rename is
      // followed into it at its NEW path — asking for the old one would open
      // nothing at all.
      hipPath: `${P.project}/Nova/houdini/Kira.hip`,
      nameFrom: 'Kira',
      nameTo: 'Nova',
      slugFrom: 'Kira',
      slugTo: 'Nova',
      folderFrom: `${P.project}/Kira`,
      folderTo: `${P.project}/Nova`,
    },
  ])

  expect(await unhandledCommands(page)).toEqual([])
})

test('a character with no exports yet is repointed without a dialog', async ({ page }) => {
  // The third state, and the one with no warning in it: nothing on disk to
  // lose, so the rename just happens — but the linked project still imports by
  // the old name, so the repoint runs anyway, behind its own toast.
  await openCharacterWithExports(page, { houdini: true, exports: false })
  await renameTo(page, 'Nova')

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(/Renamed to “Nova”/)).toBeVisible()

  // The RESULT is what a spec can hold: it opens with a capital (either half
  // can be the only one that happened, so neither carries its own) and asks for
  // the export that has never run, rather than for a rebuild of something that
  // never existed.
  //
  // Its in-flight line — "Repointing the Houdini projects…", the one that must
  // NOT claim to be clearing exports that do not exist — is deliberately not
  // asserted: the fake answers instantly, so the loading toast is replaced
  // before it can be observed, and a spec that raced it would be flaky rather
  // than strict.
  await expect(
    page.getByText('Repointed 1 Houdini project. Run DTH Export to fill them.'),
  ).toBeVisible()

  expect(await unhandledCommands(page)).toEqual([])
})
