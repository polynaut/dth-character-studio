import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// Settings → General, the Unreal pair: the engines panel (informational — a
// `.uproject` names its own engine, there is nothing to activate) and the
// plugin-folders panel with its per-folder preview. The registry read and the
// folder walk are native with no stand-in here; the fake states what the
// machine has. What this spec proves is the studio's half — the numeric
// newest-first sort, the stale-registry flag, and the per-folder preview.

const UE510 = 'D:/Epic/UE_5.10'
const UE57 = 'C:/Program Files/Epic Games/UE_5.7'
const BRIDGE = 'D:/Unreal Plugins/DazToUnrealBridge'
const EMPTY = 'D:/Unreal Plugins/Nothing Here'

test('engines list newest-first with the stale-registry flag; plugin folders preview their builds', async ({
  page,
}) => {
  const seed = buildSeed({
    activeProjectFile: P.dcsp,
    unrealPluginFolders: [BRIDGE, EMPTY],
    // Registry order deliberately not the display order — the panel must sort.
    unrealEngineInstalls: [
      { version: '5.7', path: UE57 },
      { version: '5.10', path: UE510 },
    ],
    unrealPlugins: [
      {
        name: 'DazToUnreal',
        path: `${BRIDGE}/UE_5.10/Plugins/DazToUnreal`,
        engineVersion: '5.10',
        sourceFolder: BRIDGE,
      },
      { name: 'AnyTool', path: `${BRIDGE}/AnyTool`, engineVersion: '', sourceFolder: BRIDGE },
    ],
  })
  // 5.10 is really on disk; 5.7 is a stale registry leftover (measured on the
  // dev machine: Epic's key can outlive an uninstall).
  seed.files[`${UE510}/Engine/Build/Build.version`] = '{}'

  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()

  // Engines: NUMERIC newest-first — a string sort (descending) would put
  // "5.7" above "5.10". The uninstalled 5.7 is flagged, not hidden.
  await expect(page.getByRole('button', { name: 'Rescan Unreal Engines' })).toBeVisible()
  await expect(page.getByText('Unreal Engine 5.10', { exact: true })).toBeVisible()
  const engineCards = page.locator('li').filter({ hasText: /Unreal Engine 5\./ })
  await expect(engineCards.first()).toContainText('Unreal Engine 5.10')
  await expect(page.getByText(/folder not found — the launcher/)).toBeVisible()

  // Plugin folders: the bridge previews both builds with their engine labels…
  await expect(page.getByRole('button', { name: 'Add Unreal plugins folder' })).toBeVisible()
  await expect(page.getByText('DazToUnreal', { exact: true })).toBeVisible()
  await expect(page.getByText('UE 5.10', { exact: true })).toBeVisible()
  await expect(page.getByText('AnyTool', { exact: true })).toBeVisible()
  await expect(page.getByText('any engine', { exact: true })).toBeVisible()
  // …and the folder with nothing recognized says so instead of staying blank.
  await expect(page.getByText(/No Unreal plugin found here/)).toBeVisible()
})
