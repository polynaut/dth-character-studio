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
