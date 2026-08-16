import { expect, test } from '@playwright/test'

import { P, buildSeed, fakeDll } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'
import type { TauriMockSeed } from './tauri-mock.ts'

// Daz plugins go into EVERY Daz Studio on the machine, paired by generation.
//
// The bug this guards: both plugins ship one binary per Studio generation, but
// the panel asked for ONE release folder and installed into ONE Daz — so on a
// DS4 + DS6 machine it could only ever describe half the setup, and happily
// offered to copy a DS4 build into a DS6 install (which cannot even load it:
// DS6 only loads `dsp_*.dll`, and that prefix is exactly what names a build's
// generation).

const ROAMING = 'C:/Users/dev/AppData/Roaming'
const DAZ_APPDATA = `${ROAMING}/DAZ 3D`
const DS4 = 'C:/Program Files/DAZ 3D/DAZStudio4'
const DS6 = 'C:/Program Files/DAZ 3D/DAZStudio6'
const RESOURCES = 'C:/Program Files/DTH Character Studio'
const EXPORTER_ROOT = 'X:/_resources/_DazToHue/ExporterPlugin'

/** A DS4 + DS6 machine, DIM-described, with both plugin releases on hand. */
function machineSeed(over: (seed: TauriMockSeed) => void = () => {}): TauriMockSeed {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dazInstallFolder: DS6 })
  seed.roamingDir = ROAMING
  seed.resourceDir = RESOURCES
  seed.files[`${DAZ_APPDATA}/dzInstall.ini`] = [
    '[General]',
    'InstalledApplications=dzStudio6InstallDir-64 dzStudio4InstallDir-64',
    '',
    '[ApplicationPath]',
    `dzStudio6InstallDir-64=${DS6}`,
    `dzStudio4InstallDir-64=${DS4}`,
    '',
  ].join('\n')
  // Each install's own exe carries the version the generation is read from.
  seed.files[`${DS6}/DAZStudio.exe`] = fakeDll('6.0.1.0')
  seed.files[`${DS4}/DAZStudio.exe`] = fakeDll('4.22.0.16')
  // The bundled Runner, as the app ships it.
  seed.files[`${RESOURCES}/resources/dth-runner/version.txt`] = '1.1.4'
  seed.files[`${RESOURCES}/resources/dth-runner/ds4/dthcharacterstudiorunner.dll`] = fakeDll('1.1.4.0')
  seed.files[`${RESOURCES}/resources/dth-runner/ds6/dsp_dthcharacterstudiorunner.dll`] = fakeDll('1.1.4.0')
  // The Exporter as mrpdean publishes it: one folder, a subfolder per Studio.
  seed.files[`${EXPORTER_ROOT}/Daz Studio 4/dth_exporter.dll`] = fakeDll('2.0.2.0')
  seed.files[`${EXPORTER_ROOT}/Daz Studio 4/dth_tools.dll`] = 'companion'
  seed.files[`${EXPORTER_ROOT}/Daz Studio 6/dsp_dth_exporter.dll`] = fakeDll('2.0.2.0')
  // DS6 already has an OLDER exporter; DS4 has none at all.
  seed.files[`${DS6}/plugins/dsp_dth_exporter.dll`] = fakeDll('2.0.1.0')
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    dazInstallFolder: DS6,
    dazInstallKey: 'dzstudio6installdir-64',
    dthExporterFolders: [EXPORTER_ROOT],
  })
  over(seed)
  return seed
}

const installCalls = (page: Page) =>
  page.evaluate(() =>
    ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
      .filter((c) => c.cmd === 'install_dth_plugin')
      .map((c) => ({
        from: c.args.request.exporterFolder,
        to: c.args.request.dazInstallFolder,
        label: c.args.request.label,
      })),
  )

/** The elevated helper's calls — one per BATCH, carrying every job. */
const elevatedCalls = (page: Page) =>
  page.evaluate(() =>
    ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
      .filter((c) => c.cmd === 'install_dth_plugins_elevated')
      .map((c) => (c.args.request.jobs as Array<{ label: string }>).map((j) => j.label)),
  )

async function openPlugins(page: Page, seed = machineSeed()) {
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  await page.getByRole('heading', { name: 'Daz Studio plugins' }).waitFor()
}

test('one release folder feeds BOTH generations, read from the DLL names', async ({ page }) => {
  await openPlugins(page)

  // The scan found each build and typed it by its own file name — the folder
  // names agree here, but they are not what decided.
  await expect(page.getByText('dth_exporter.dll', { exact: true })).toBeVisible()
  await expect(page.getByText('dsp_dth_exporter.dll', { exact: true })).toBeVisible()
  // The companion DLL is not a release of its own.
  await expect(page.getByText('dth_tools.dll')).toHaveCount(0)
  // Each hint sits under ITS folder row, and shows only the part BELOW the
  // entry (this fixture's one folder holds a subfolder per generation) — the
  // full path would just echo the field above it.
  const section = page.locator('section').filter({ hasText: 'Daz Studio plugins' })
  await expect(page.getByText('· Daz Studio 4', { exact: true })).toBeVisible()
  await expect(section.getByText(/· X:/)).toHaveCount(0)
  // The Runner's "ships with this app" line moved into the table header's
  // tooltip — a standing hint said it forever, the header says it on demand.
  await expect(section.getByText(/ships with this app/i)).toHaveCount(0)
  // Scroll first, then hover from a parked mouse: hover()'s own auto-scroll
  // fires its (async) scroll event AFTER the tooltip's show-timer armed, and
  // the host hides on scroll — a real mouse re-triggers on its next tiny
  // movement, Playwright's single surgical mouseover does not.
  const runnerTh = page.getByRole('columnheader', { name: 'Runner plugin' })
  await runnerTh.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await runnerTh.hover()
  await expect(page.getByRole('tooltip')).toContainText(/^Ships with this app \(1\.1\.4\)/)

  // Both installs are targets, each with its own verdict: DS6 has an older
  // exporter, DS4 has none, and neither has the Runner yet.
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('2.0.1.0 → 2.0.2.0')).toBeVisible()
  await expect(page.getByText('not installed → 2.0.2.0')).toBeVisible()
  await expect(page.getByText('4 plugin copies pending')).toBeVisible()
})

test('installing copies each build into the install it was built for', async ({ page }) => {
  await openPlugins(page)
  await page.getByRole('button', { name: /Install \/ update all/ }).click()
  await expect.poll(() => installCalls(page)).toHaveLength(4)

  const calls = await installCalls(page)
  const exporterInto = (target: string) =>
    calls.find((c) => c.to === target && c.label.startsWith('Exporter'))
  // The DS4 build goes to DS4 and the DS6 build to DS6 — never crossed.
  expect(exporterInto(DS4)?.from).toBe(`${EXPORTER_ROOT}/Daz Studio 4`)
  expect(exporterInto(DS6)?.from).toBe(`${EXPORTER_ROOT}/Daz Studio 6`)
  // …and the bundled Runner follows the same split.
  expect(calls.find((c) => c.to === DS4 && c.label.startsWith('Runner'))?.from).toBe(
    `${RESOURCES}/resources/dth-runner/ds4`,
  )
  expect(calls.find((c) => c.to === DS6 && c.label.startsWith('Runner'))?.from).toBe(
    `${RESOURCES}/resources/dth-runner/ds6`,
  )
})

test('a folder just ADDED is scanned before it is saved', async ({ page }) => {
  // Measured on the real app: the panel read the folder list from settings.json,
  // so a folder typed a second ago was invisible to the scan — two fields on
  // screen, one of them scanned, and the untouched half of the machine reported
  // as "no build for this generation". The readout has to describe the FIELDS.
  const seed = machineSeed((s) => {
    const settingsPath = `${P.appData}/settings.json`
    s.files[settingsPath] = JSON.stringify({
      ...JSON.parse(s.files[settingsPath] ?? '{}'),
      // Only the DS4 folder is saved…
      dthExporterFolders: [`${EXPORTER_ROOT}/Daz Studio 4`],
    })
  })
  await openPlugins(page, seed)
  await expect(page.getByText('dsp_dth_exporter.dll', { exact: true })).toHaveCount(0)

  // …and the DS6 one is typed into a new row, never saved.
  await page.getByRole('button', { name: 'Add folder' }).click()
  await page.getByRole('textbox').last().fill(`${EXPORTER_ROOT}\\Daz Studio 6`)

  await expect(page.getByText('dsp_dth_exporter.dll', { exact: true })).toBeVisible()
  await expect(page.getByText('no Daz Studio 6 build among your release folders')).toHaveCount(0)
})

test('the pre-list single folder becomes a row instead of an invisible source', async ({ page }) => {
  // The migration from `dthExporterFolder`: it was merged into the SCAN but not
  // shown, so the panel listed a build with no field behind it — unremovable,
  // and impossible to reconcile with what was on screen.
  const seed = machineSeed((s) => {
    const settingsPath = `${P.appData}/settings.json`
    const saved = JSON.parse(s.files[settingsPath] ?? '{}')
    delete saved.dthExporterFolders
    saved.dthExporterFolder = `${EXPORTER_ROOT}/Daz Studio 4`
    s.files[settingsPath] = JSON.stringify(saved)
  })
  await openPlugins(page, seed)
  const section = page.locator('section').filter({ hasText: 'Daz Studio plugins' })
  await expect(section.getByRole('textbox')).toHaveValue(`${EXPORTER_ROOT}/Daz Studio 4`)
  await expect(page.getByText('dth_exporter.dll', { exact: true })).toBeVisible()
})

test('a release folder for only one generation leaves the other install named, not guessed at', async ({
  page,
}) => {
  // The failure mode a single folder + single target used to hide: half the
  // machine silently unserved. It has to be visible, and it must never be
  // "solved" by copying the wrong binary.
  const seed = machineSeed((s) => {
    delete s.files[`${EXPORTER_ROOT}/Daz Studio 6/dsp_dth_exporter.dll`]
  })
  await openPlugins(page, seed)

  await expect(page.getByText('no Daz Studio 6 build among your release folders')).toBeVisible()
  await page.getByRole('button', { name: /Install \/ update all/ }).click()
  await expect.poll(() => installCalls(page)).toHaveLength(3)
  const calls = await installCalls(page)
  expect(calls.filter((c) => c.label.startsWith('Exporter'))).toEqual([
    { from: `${EXPORTER_ROOT}/Daz Studio 4`, to: DS4, label: 'Exporter plugin → DAZ Studio 4' },
  ])
})

// The two ways a plugin copy fails look identical from the outside and have
// nothing in common as remedies: administrator rights fix a refused write and do
// NOTHING for a DLL Daz Studio has loaded. Offering the elevation button for the
// second would prompt, fail identically, and teach the user the button is a lie.
// The details below are the real Rust wording (report.rs), which is what the
// panel reads — the constants are pinned by a Rust test on the other side.
const DENIED = String.raw`couldn't write C:\Program Files\DAZ 3D\DAZStudio6\plugins\dsp_dth_exporter.dll: Access is denied. (os error 5) — writing there needs administrator rights — use "Install with administrator rights"`
const LOCKED = String.raw`couldn't write C:\Program Files\DAZ 3D\DAZStudio6\plugins\dsp_dth_exporter.dll: The process cannot access the file because it is being used by another process. (os error 32) — Daz Studio has this plugin loaded — close every Daz Studio window and try again`

test('a refused copy offers administrator rights — ONE prompt for the whole batch', async ({
  page,
}) => {
  await openPlugins(page, machineSeed((s) => (s.pluginInstallFailure = DENIED)))
  await page.getByRole('button', { name: /Install \/ update all/ }).click()

  // Four copies attempted in this process, four refused.
  await expect.poll(() => installCalls(page)).toHaveLength(4)
  const elevate = page.getByRole('button', { name: 'Install with administrator rights' })
  await expect(elevate).toBeVisible()
  // …and the studio does not ask to be restarted: that was the old answer, and
  // it cost the whole session its mapped drives and drag-and-drop.
  const section = page.locator('section').filter({ hasText: 'Daz Studio plugins' })
  await expect(section.getByText(/restart DTH Character Studio as administrator/i)).toHaveCount(0)

  await elevate.click()
  // ONE elevated call carrying every job — a UAC prompt per DLL would be
  // intolerable, and is exactly what a per-job loop would produce.
  await expect.poll(() => elevatedCalls(page)).toHaveLength(1)
  expect((await elevatedCalls(page))[0]).toHaveLength(4)
  // The unelevated command was not re-run alongside it.
  expect(await installCalls(page)).toHaveLength(4)
  await expect(elevate).toHaveCount(0)
})

test('a LOCKED plugin asks for Daz to be closed, and offers no elevation', async ({ page }) => {
  await openPlugins(page, machineSeed((s) => (s.pluginInstallFailure = LOCKED)))
  await page.getByRole('button', { name: /Install \/ update all/ }).click()
  await expect.poll(() => installCalls(page)).toHaveLength(4)

  await expect(page.getByText(/close every Daz Studio window and install again/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Install with administrator rights' }),
  ).toHaveCount(0)
})

test('a migrated folder can be REMOVED — the legacy field does not put it back', async ({
  page,
}) => {
  // The trap in migrating by COPY: `exporterSourceFolders` merges the legacy
  // single field into every scan, so a value left in settings.json outlives the
  // row it seeded. Remove that row and the panel (which scans the fields) shows
  // it gone while the install (which reads the saved settings) keeps installing
  // from it — the folder is on screen nowhere and in the plan anyway. The
  // migration therefore MOVES the value: seeds the list, clears the field.
  const seed = machineSeed((s) => {
    const settingsPath = `${P.appData}/settings.json`
    const saved = JSON.parse(s.files[settingsPath] ?? '{}')
    delete saved.dthExporterFolders
    saved.dthExporterFolder = EXPORTER_ROOT
    s.files[settingsPath] = JSON.stringify(saved)
  })
  await openPlugins(page, seed)
  const section = page.locator('section').filter({ hasText: 'Daz Studio plugins' })
  await expect(section.getByRole('textbox')).toHaveValue(EXPORTER_ROOT)

  // Drop the only row, then save — the legacy value has to go with it.
  await section.getByRole('button', { name: 'Remove folder' }).click()
  await expect(section.getByRole('textbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/No release folder yet/)).toBeVisible()

  const settings = await page.evaluate(
    (p) => JSON.parse(((window as any).__tauriMock.files.get(p) ?? '{}') as string),
    `${P.appData}/settings.json`,
  )
  expect(settings.dthExporterFolders).toEqual([])
  expect(settings.dthExporterFolder).toBe('')

  // …and the install genuinely has no exporter to copy any more (only the two
  // Runner copies remain), instead of quietly using the removed folder.
  await page.getByRole('button', { name: /Install \/ update all|Reinstall all/ }).click()
  await expect.poll(() => installCalls(page)).toHaveLength(2)
  expect((await installCalls(page)).every((c) => c.label.startsWith('Runner'))).toBe(true)
})
