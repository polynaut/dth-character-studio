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
