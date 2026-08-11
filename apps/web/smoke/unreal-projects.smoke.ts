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
  // The engine is read from the .uproject; both offered items are pre-checked,
  // and only the 5.7 build of the bridge plugin is offered (one row, not two).
  await expect(dialog.getByText('Unreal Engine 5.7')).toBeVisible()
  const boxes = dialog.getByRole('checkbox')
  await expect(boxes).toHaveCount(2)
  for (const box of await boxes.all()) await expect(box).toBeChecked()

  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  // Success toast names both installs; the dialog closes.
  await expect(page.getByText(/Installed into DemoGame/)).toBeVisible()
  await expect(page.getByText(/DTH content \(7 files\)/)).toBeVisible()
  await expect(page.getByText(/DazToUnreal \(3 files\)/)).toBeVisible()
  await expect(dialog).toHaveCount(0)
})
