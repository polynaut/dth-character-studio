import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Settings → Daz installation: the paths the studio needs are ones the user
// already gave the DAZ Install Manager, so it reads DIM's own INI files instead
// of asking a third time (or guessing across drive letters, which is what the
// manifests probe used to do).
//
// The fake serves those INIs from `%APPDATA%/DAZ 3D`, which is where DIM really
// writes them — so what this spec proves is the studio's half: the cards it
// finds, what activating one derives, and that the derivation reaches disk on
// its own (the paths follow from the choice; there is nothing left to "save").

const ROAMING = 'C:/Users/dev/AppData/Roaming'
const DAZ_APPDATA = `${ROAMING}/DAZ 3D`
const SETTINGS = `${P.appData}/settings.json`

const DS6 = 'C:/Program Files/DAZ 3D/DAZStudio6'
const DS4 = 'C:/Program Files/DAZ 3D/DAZStudio4'
const LIBRARY = 'D:/DAZ 3D/My DAZ 3D Library'
const MANIFESTS = 'D:/DAZ 3D/Install Manager/ManifestFiles'

/** A machine with DIM and both Daz Studios — the case that has to pick one. */
function dimSeed() {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  seed.roamingDir = ROAMING
  seed.files[`${DAZ_APPDATA}/dzInstall.ini`] = [
    '[General]',
    'InstalledApplications=dzStudio6InstallDir-64 dzStudio4InstallDir-64',
    '',
    '[ApplicationPath]',
    `dzStudio6InstallDir-64=${DS6}`,
    `dzStudio4InstallDir-64=${DS4}`,
    '',
  ].join('\n')
  seed.files[`${DAZ_APPDATA}/InstallManager/Settings/AppSettings.ini`] =
    '[General]\nCurrentUser=Remo\nApplicationVersion=1.4.1.96\n'
  seed.files[`${DAZ_APPDATA}/InstallManager/UserAccounts/Remo.ini`] = [
    '[General]',
    // The credential blob really does sit in this file. It must never reach
    // settings.json — the parser is a named whitelist so it cannot.
    'Account=DEADBEEFCAFE0123456789ABCDEF',
    'RememberPassword=true',
    `CurInstallPath=${LIBRARY}`,
    `OverrideManifestDir=${MANIFESTS}`,
    'DownloadPath=D:/DAZ 3D/Install Manager/Downloads',
    '',
  ].join('\n')
  // The install folders exist; the fake treats any file under a path as making
  // that folder real, so drop a marker in each.
  seed.files[`${DS6}/DAZStudio.exe`] = 'ds6'
  seed.files[`${DS4}/DAZStudio.exe`] = 'ds4'
  seed.files[`${LIBRARY}/readme.txt`] = 'library'
  seed.files[`${MANIFESTS}/IM00012345_1_Product.dsx`] = '<dsx/>'
  return seed
}

/** settings.json as the app has written it. */
async function savedSettings(page: Page): Promise<Record<string, unknown>> {
  const raw = await page.evaluate(
    (p) => ((window as any).__tauriMock.files.get(p) ?? '{}') as string,
    SETTINGS,
  )
  return JSON.parse(raw) as Record<string, unknown>
}

/** The Daz section's Rescan — the Houdini section below it has one too, and the
 *  Daz card block is rendered first. */
const dazRescan = (page: Page) => page.getByRole('button', { name: 'Rescan' }).first()

async function openDazSettings(page: Page, seed: ReturnType<typeof dimSeed>) {
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  // Via the header link, never a hard goto: main.tsx runs a one-time startup
  // navigation that a reload re-triggers, bouncing straight back home.
  await page.getByRole('link', { name: 'Settings' }).click()
  // A project window opens Settings on its Project tab; the Daz installation
  // lives on General, which leads everywhere else.
  await page.getByRole('tab', { name: 'General' }).click()
  // The HEADING, not the text: with an installation already active the section
  // also renders its derived paths, whose prose matches the same substring.
  await expect(page.getByRole('heading', { name: /Daz installation/ })).toBeVisible()
}

test('finds both Daz Studios and recommends the newest', async ({ page }) => {
  await openDazSettings(page, dimSeed())

  await expect(page.getByRole('button', { name: /DAZ Studio 6/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /DAZ Studio 4/ })).toBeVisible()
  // DS6 is the one pointed at; nothing is activated until the user says so.
  await expect(page.getByRole('button', { name: /DAZ Studio 6.*recommended/s })).toBeVisible()
})

test('activating an installation derives the paths and saves them itself', async ({ page }) => {
  const seed = dimSeed()
  await openDazSettings(page, seed)

  // Nothing derived yet: this is a first run, so the paths are still empty and
  // the manual field is the one on screen.
  expect(await savedSettings(page)).not.toHaveProperty('dazInstallKey', 'dzstudio6installdir-64')

  await page.getByRole('button', { name: /DAZ Studio 6/ }).click()
  await expect(page.getByText(/DAZ Studio 6 activated/)).toBeVisible()

  // Written to disk by the activation itself — no Save press in this test.
  await expect
    .poll(async () => (await savedSettings(page)).dazInstallKey)
    .toBe('dzstudio6installdir-64')
  const saved = await savedSettings(page)
  expect(saved.dazInstallFolder).toBe(DS6)
  expect(saved.dazLibraryFolder).toBe(LIBRARY)
  expect(saved.dimManifestsFolder).toBe(MANIFESTS)
  // The account file's credential never travels with the paths.
  expect(JSON.stringify(saved)).not.toContain('DEADBEEF')

  // …and the derived paths are shown read-only, with the manual field gone.
  await expect(page.getByText('Paths from this installation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set the paths manually' })).toBeVisible()
  // Gone from "Setup DTH Release" entirely, not echoed there read-only: the
  // card above already lists it, and a second copy can only ever agree.
  await expect(page.getByLabel('My DAZ 3D Library')).toHaveCount(0)
  await expect(page.getByLabel('Daz Studio install folder')).toHaveCount(0)
  // Each install still says where it will write — that part does belong beside
  // its buttons. Two of them: the release into the library, the plugin into the
  // Daz Studio folder.
  await expect(page.getByText(/Installs into.*from the Daz installation above/)).toHaveCount(2)
})

test('activating the other card re-derives from it', async ({ page }) => {
  await openDazSettings(page, dimSeed())

  await page.getByRole('button', { name: /DAZ Studio 6/ }).click()
  await expect.poll(async () => (await savedSettings(page)).dazInstallFolder).toBe(DS6)

  await page.getByRole('button', { name: /DAZ Studio 4/ }).click()
  await expect.poll(async () => (await savedSettings(page)).dazInstallFolder).toBe(DS4)
  // The library and product database belong to DIM, not to one Studio, so they
  // stay put — only the install folder follows the card.
  expect((await savedSettings(page)).dazLibraryFolder).toBe(LIBRARY)
})

test('"Set the paths manually" hands the fields back, keeping the values', async ({ page }) => {
  await openDazSettings(page, dimSeed())
  await page.getByRole('button', { name: /DAZ Studio 6/ }).click()
  await expect(page.getByText('Paths from this installation')).toBeVisible()

  await page.getByRole('button', { name: 'Set the paths manually' }).click()
  await expect(page.getByText(/yours to edit/)).toBeVisible()

  // Deactivated, but nothing is lost: the values stay exactly as derived.
  await expect.poll(async () => (await savedSettings(page)).dazInstallKey).toBe('')
  const saved = await savedSettings(page)
  expect(saved.dazInstallFolder).toBe(DS6)
  expect(saved.dazLibraryFolder).toBe(LIBRARY)
})

test('a library moved in DIM is picked up on the next visit, with no re-activation', async ({
  page,
}) => {
  // The scenario this exists for: activate an installation, then change DIM's
  // Advanced Settings. The stored paths were a SNAPSHOT taken at activation, so
  // without the re-derive the studio kept generating into the old library and
  // nothing said a word — re-clicking the already-active card was the only cure,
  // and the card reads "Active", which invites nobody to click it.
  const seed = dimSeed()
  await openDazSettings(page, seed)
  await page.getByRole('button', { name: /DAZ Studio 6/ }).click()
  await expect.poll(async () => (await savedSettings(page)).dazLibraryFolder).toBe(LIBRARY)

  // DIM now installs into a different library, and the manifests moved with it.
  const MOVED = 'E:/Daz Content/My DAZ 3D Library'
  const MOVED_MANIFESTS = 'E:/Daz Content/ManifestFiles'
  await page.evaluate(
    ([path, ini]) => (window as any).__tauriMock.files.set(path, ini),
    [
      `${DAZ_APPDATA}/InstallManager/UserAccounts/Remo.ini`,
      [
        '[General]',
        'Account=DEADBEEFCAFE0123456789ABCDEF',
        `CurInstallPath=${MOVED}`,
        `OverrideManifestDir=${MOVED_MANIFESTS}`,
        '',
      ].join('\n'),
    ] as const,
  )
  await page.evaluate(
    ([a, b]) => {
      const f = (window as any).__tauriMock.files
      f.set(a, 'library')
      f.set(b, '<dsx/>')
    },
    [`${MOVED}/readme.txt`, `${MOVED_MANIFESTS}/IM00012345_1_Product.dsx`] as const,
  )

  // Re-scan (what a fresh Settings visit does) — no card is clicked.
  await dazRescan(page).click()

  await expect.poll(async () => (await savedSettings(page)).dazLibraryFolder).toBe(MOVED)
  const saved = await savedSettings(page)
  expect(saved.dimManifestsFolder).toBe(MOVED_MANIFESTS)
  // The installation itself didn't move, and the key is untouched.
  expect(saved.dazInstallFolder).toBe(DS6)
  expect(saved.dazInstallKey).toBe('dzstudio6installdir-64')
  // The read-only list shows the new value, so it can't disagree with the card.
  // `.first()`: the new library also reaches everything derived FROM it on this
  // page (the script install location, the release install target) — which is
  // rather the point of syncing it.
  await expect(page.getByText(MOVED).first()).toBeVisible()
})

test('a DIM value that disappeared does NOT blank a working path', async ({ page }) => {
  // Only drift toward a REAL value is synced. DIM dropping its manifest override
  // (or an account file going unreadable) must not silently clear a path the
  // studio depends on — the explicit activation says so in its toast; a silent
  // sync has no way to.
  await openDazSettings(page, dimSeed())
  await page.getByRole('button', { name: /DAZ Studio 6/ }).click()
  await expect.poll(async () => (await savedSettings(page)).dimManifestsFolder).toBe(MANIFESTS)

  await page.evaluate(
    ([path, ini]) => (window as any).__tauriMock.files.set(path, ini),
    [
      `${DAZ_APPDATA}/InstallManager/UserAccounts/Remo.ini`,
      ['[General]', `CurInstallPath=${LIBRARY}`, ''].join('\n'),
    ] as const,
  )
  await dazRescan(page).click()

  // Still there — and the library, which DIM still names, is still right.
  await expect.poll(async () => (await savedSettings(page)).dazLibraryFolder).toBe(LIBRARY)
  expect((await savedSettings(page)).dimManifestsFolder).toBe(MANIFESTS)
})

test('a machine with no DIM says so instead of showing empty cards', async ({ page }) => {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  seed.roamingDir = ROAMING
  await openDazSettings(page, seed)

  await expect(page.getByText(/No DAZ Install Manager settings found/)).toBeVisible()
  // The manual field is still there — detection is an offer, not a gate.
  await expect(page.getByLabel('My DAZ 3D Library')).toBeVisible()
})

// --- "Export only": which installation runs the export batch ----------------
//
// Everything the studio does in Daz goes through the activated install — except
// the batch handoff, which needs the Runner PLUGIN, and a plugin binary is built
// against one Studio major. So an older install can be flagged to take the
// exports while the newest stays active. The rule for WHICH installs may carry
// that flag is unit-tested (`lib/daz-install.test.ts`); what these prove is the
// half a unit test cannot: that the switch reaches settings.json, and that the
// flag can always be taken back off again.

const DS7 = 'C:/Program Files/DAZ 3D/DAZStudio7'

/** A machine that has moved to a Studio newer than 6 — the shape Export only is
 *  actually for, and the only one where it is offered. */
function ds7Seed() {
  const seed = dimSeed()
  seed.files[`${DAZ_APPDATA}/dzInstall.ini`] = [
    '[General]',
    'InstalledApplications=dzStudio7InstallDir-64 dzStudio6InstallDir-64 dzStudio4InstallDir-64',
    '',
    '[ApplicationPath]',
    `dzStudio7InstallDir-64=${DS7}`,
    `dzStudio6InstallDir-64=${DS6}`,
    `dzStudio4InstallDir-64=${DS4}`,
    '',
  ].join('\n')
  seed.files[`${DS7}/DAZStudio.exe`] = 'ds7'
  return seed
}

test('Export only is offered NOWHERE on a DS4 + DS6 machine', async ({ page }) => {
  // The trap this closes: DS4 takes the Runner plugin happily, so every cheap
  // check says yes — the gate would go green, the launcher would start it, the
  // Runner would claim the job file, and then every scene's export would skip,
  // because that build has no scripted export at all. A batch that completes and
  // exports nothing is the exact failure Export only exists to prevent, so DS4
  // is never offered, and on this machine there is nothing else to offer.
  const seed = dimSeed()
  await openDazSettings(page, seed)
  await page.getByRole('button', { name: /DAZ Studio 6/ }).click()
  await expect(page.getByText(/DAZ Studio 6 activated/)).toBeVisible()

  await expect(page.getByText('Export only')).toHaveCount(0)
})

test('Export only sends the batch to the older Studio, and only that one', async ({ page }) => {
  await openDazSettings(page, ds7Seed())
  await page.getByRole('button', { name: /DAZ Studio 7/ }).click()
  await expect(page.getByText(/DAZ Studio 7 activated/)).toBeVisible()

  // Offered on DS6 — older than the active one, and able to export. Never on
  // DS4, and never on the active install itself.
  const switches = page.getByRole('switch', { name: /Run export batches in/ })
  await expect(switches).toHaveCount(1)
  await expect(page.getByRole('switch', { name: 'Run export batches in DAZ Studio 6' })).toBeVisible()

  await switches.click()
  await expect(page.getByText(/Export batches will run in DAZ Studio 6/)).toBeVisible()

  // Both halves reach disk: the KEY is what arms the redirect, the FOLDER is
  // what the launcher can actually start.
  await expect
    .poll(async () => (await savedSettings(page)).dazExportInstallKey)
    .toBe('dzstudio6installdir-64')
  expect((await savedSettings(page)).dazExportInstallFolder).toBe(DS6)
  // …and the active install is untouched: only the batch moved.
  expect((await savedSettings(page)).dazInstallFolder).toBe(DS7)

  // Turning it off hands the exports back, clearing both fields — a leftover
  // folder must never keep quietly taking the batch.
  await switches.click()
  await expect(page.getByText(/Export batches follow the active installation again/)).toBeVisible()
  await expect.poll(async () => (await savedSettings(page)).dazExportInstallKey).toBe('')
  expect((await savedSettings(page)).dazExportInstallFolder).toBe('')
})

test('a flagged installation that vanishes can still be handed back', async ({ page }) => {
  // The one state the switches cannot express, because the card it belonged to
  // is gone. Left alone it is silent and total: every export would launch a
  // folder that is not there, and there would be nothing on screen to undo it.
  const seed = ds7Seed()
  seed.files[SETTINGS] = JSON.stringify({
    ...JSON.parse(seed.files[SETTINGS] ?? '{}'),
    dazInstallKey: 'dzstudio7installdir-64',
    dazInstallFolder: DS7,
    dazExportInstallKey: 'dzstudio6installdir-64',
    dazExportInstallFolder: DS6,
  })
  // DIM stops listing DS6 entirely — uninstalled between runs.
  seed.files[`${DAZ_APPDATA}/dzInstall.ini`] = [
    '[General]',
    'InstalledApplications=dzStudio7InstallDir-64',
    '',
    '[ApplicationPath]',
    `dzStudio7InstallDir-64=${DS7}`,
    '',
  ].join('\n')
  await openDazSettings(page, seed)

  await expect(page.getByText(/Export batches are still pointed at an installation/)).toBeVisible()
  await page.getByRole('button', { name: 'Use the active installation' }).click()

  await expect.poll(async () => (await savedSettings(page)).dazExportInstallKey).toBe('')
  expect((await savedSettings(page)).dazExportInstallFolder).toBe('')
  await expect(page.getByText(/Export batches are still pointed at an installation/)).toHaveCount(0)
})
