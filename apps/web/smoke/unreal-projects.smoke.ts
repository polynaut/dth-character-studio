import { expect, test } from '@playwright/test'

import { P, UPROJECT, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The project window's Unreal-projects footer bar: unlinking a project pauses
// on a confirm dialog (the same recipe as removing a Daz scene / Houdini
// project from a character) — links only, the files always stay on disk.

test('unreal unlink pauses on a confirm dialog', async ({ page }) => {
  await page.addInitScript(
    installTauriMock,
    buildSeed({ activeProjectFile: P.dcsp, unrealProjects: [UPROJECT] }),
  )
  await page.goto('/')
  await expect(page.getByText('DemoGame', { exact: true })).toBeVisible()

  // Cancel keeps the link.
  await page.getByRole('button', { name: 'Unlink DemoGame' }).click()
  await expect(page.getByRole('dialog', { name: 'Unlink Unreal project?' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('DemoGame', { exact: true })).toBeVisible()

  // Confirm actually unlinks.
  await page.getByRole('button', { name: 'Unlink DemoGame' }).click()
  await page.getByRole('button', { name: 'Unlink', exact: true }).click()
  await expect(page.getByText('Unlinked Unreal project')).toBeVisible()
  await expect(page.getByText('DemoGame', { exact: true })).toHaveCount(0)
})

test('the install dialog offers DTH content + the engine-matched plugin builds', async ({
  page,
}) => {
  const bridge = 'D:/Unreal Plugins/DazToUnrealBridge'
  await page.addInitScript(
    installTauriMock,
    buildSeed({
      activeProjectFile: P.dcsp,
      unrealProjects: [UPROJECT], // seeded with EngineAssociation 5.7
      unrealPluginFolders: [bridge],
      unrealPlugins: [
        {
          name: 'DazToUnreal',
          path: `${bridge}/UE_5.7/Plugins/DazToUnreal`,
          engineVersion: '5.7',
          sourceFolder: bridge,
        },
        // The other build in the multi-build root — must NOT be offered.
        {
          name: 'DazToUnreal',
          path: `${bridge}/UE_5.6/Plugins/DazToUnreal`,
          engineVersion: '5.6',
          sourceFolder: bridge,
        },
      ],
    }),
  )
  await page.goto('/')
  await expect(page.getByText('DemoGame', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Install DTH content and plugins into DemoGame' }).click()
  const dialog = page.getByRole('dialog', { name: /Install into DemoGame/ })
  await expect(dialog).toBeVisible()
  // The engine is read from the .uproject; every offered item is pre-checked,
  // and only the 5.7 build of the bridge plugin is offered (one row, not two).
  // Three rows: DTH content, the studio's own DTHStudioBridge, that one build.
  await expect(dialog.getByText('Unreal Engine 5.7')).toBeVisible()
  const boxes = dialog.getByRole('checkbox')
  await expect(boxes).toHaveCount(3)
  for (const box of await boxes.all()) await expect(box).toBeChecked()

  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  // Success toast names every install; the dialog closes.
  await expect(page.getByText(/Installed into DemoGame/)).toBeVisible()
  await expect(page.getByText(/DTH content \(7 files\)/)).toBeVisible()
  await expect(page.getByText(/DazToUnreal \(3 files\)/)).toBeVisible()
  // The bridge is written by the FS layer, not by a native install command —
  // the one item whose whole install path runs above the mocked boundary.
  await expect(page.getByText(/DTH Studio Bridge \(3 files\)/)).toBeVisible()
  await expect(dialog).toHaveCount(0)
})

test('the install dialog judges plugin builds by BuildId, not by their folder name', async ({
  page,
}) => {
  // The whole path, unmocked above the native boundary: the fake's wire shape →
  // the zod schema → `buildUnrealScan` → the dialog. The component tests can't
  // prove this stretch — they mock `detectUnrealEngines` — and it is precisely
  // where the check was inert once already (a mapper that named its fields
  // dropped `buildId` on the way to the UI). See `.ai/gotchas.md`.
  const plugins = 'D:/Unreal Plugins'
  const ue57 = 'C:/Program Files/Epic Games/UE_5.7'
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    unrealProjects: [UPROJECT], // seeded with EngineAssociation 5.7
    unrealPluginFolders: [plugins],
    unrealEngineInstalls: [{ version: '5.7', path: ue57, buildId: '47537391' }],
    unrealPlugins: [
      // Underscore-versioned folders: NEITHER reads as a version, so the label
      // says `any engine` for both and only the BuildId separates them.
      {
        name: 'KawaiiPhysics',
        path: `${plugins}/KawaiiPhysics_5_8_0/Plugins/KawaiiPhysics`,
        engineVersion: '',
        sourceFolder: plugins,
        buildId: '55116800',
      },
      // Two builds of ONE plugin, and the alphabetically first is the wrong
      // one — offering it and hiding the other is the bug this ranking fixes.
      {
        name: 'DazToUnreal',
        path: `${plugins}/DazToUnreal_5_8/Plugins/DazToUnreal`,
        engineVersion: '',
        sourceFolder: plugins,
        buildId: '55116800',
      },
      {
        name: 'DazToUnreal',
        path: `${plugins}/DazToUnreal_5_7/Plugins/DazToUnreal`,
        engineVersion: '',
        sourceFolder: plugins,
        buildId: '47537391',
      },
    ],
  })
  seed.files[`${ue57}/Engine/Build/Build.version`] = '{}'

  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await expect(page.getByText('DemoGame', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Install DTH content and plugins into DemoGame' }).click()
  const dialog = page.getByRole('dialog', { name: /Install into DemoGame/ })
  await expect(dialog).toBeVisible()

  // KawaiiPhysics has only a 5.8 build: listed, marked, and NOT pre-checked —
  // a warning, never a refusal.
  const kawaii = dialog.locator('li').filter({ hasText: 'KawaiiPhysics' })
  await expect(kawaii.getByText('built for another engine build')).toBeVisible()
  await expect(kawaii.getByRole('checkbox')).not.toBeChecked()

  // DazToUnreal has both: exactly one row, unmarked and pre-checked, because
  // the 5.7-matching build won the pick.
  const bridge = dialog.locator('li').filter({ hasText: 'DazToUnreal' })
  await expect(bridge).toHaveCount(1)
  await expect(bridge.getByText('built for another engine build')).toHaveCount(0)
  await expect(bridge.getByRole('checkbox')).toBeChecked()
})
