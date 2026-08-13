import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// A scene card's open menu, and the one thing it used to refuse: opening a
// saved ROM animation that had gone STALE.
//
// The freshness test dates the generated ROM script, which EVERY character save
// rewrites — so editing anything at all makes every saved animation of that
// character stale. The menu swapped the open entry for "Open and Generate" at
// that moment, which is how a primary scene whose ROM had been built and
// exported ended up offering only to build it again (a Daz run of many minutes)
// with no way to open the file sitting right there. Stale is not wrong; it is
// "not from the current definition", which is the user's call.

const DS4 = 'C:/Program Files/DAZ 3D/DAZStudio4'
/** Where the primary scene's saved ROM animation lives — the rule in
 *  `romAnimationPath`: `<dir>/rom-animations/<stem>_ROM.duf`. */
const ROM = `${P.charFolder}/daz3d/rom-animations/KiraDefault_G9_GP_ROM.duf`

const callsNamed = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      ((window as any).__tauriMock.calls as Array<{ cmd: string; args: any }>)
        .filter((c) => c.cmd === name)
        .map((c) => c.args),
    cmd,
  )

/** Open the demo character with a saved ROM animation on disk, `stale` deciding
 *  whether it predates the scene it was built from. */
async function openCharacter(page: Page, { stale }: { stale: boolean }) {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dazInstallFolder: DS4 })
  seed.files[ROM] = 'duf-fixture'
  await page.addInitScript(installTauriMock, seed)
  if (stale) {
    // Every file in the fake world shares one mtime, which reads as current.
    // Age THIS one and the freshness test (rom >= scene) fails, exactly as a
    // character save does in the real app by re-writing the ROM script.
    await page.addInitScript((romPath: string) => {
      const mock = (window as any).__tauriMock
      mock.setMtime(romPath, mock.mtimeMs - 60_000)
    }, ROM)
  }
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByRole('button', { name: /Open in Daz/ }).first().click()
}

test('a STALE ROM animation is still offered — with the rebuild under it', async ({ page }) => {
  await openCharacter(page, { stale: true })

  const open = page.getByRole('button', { name: /Open ROM Animation/ })
  await expect(open).toBeVisible()
  // …and says why it might not be what you want, rather than hiding itself.
  await expect(open).toContainText('From an earlier run')
  // The rebuild is the other entry now, not a replacement for this one.
  await expect(page.getByRole('button', { name: /Open and Generate ROM Animation/ })).toBeVisible()

  // Opening it opens THAT file — the ROM animation, not the source scene.
  await open.click()
  await expect
    .poll(() => callsNamed(page, 'launch_daz_studio'))
    .toEqual([{ installFolder: DS4, scenePath: ROM }])
})

test('a CURRENT one opens without offering a pointless rebuild', async ({ page }) => {
  await openCharacter(page, { stale: false })

  await expect(page.getByRole('button', { name: /Open ROM Animation/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Open ROM Animation/ })).not.toContainText(
    'From an earlier run',
  )
  // Nothing to refresh, so the multi-minute Daz run is not offered (Ctrl still
  // reveals it — a forced rebuild is a deliberate act).
  await expect(page.getByRole('button', { name: /Open and Generate ROM Animation/ })).toHaveCount(0)
})

test('no saved animation at all — only the scene and the build', async ({ page }) => {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dazInstallFolder: DS4 })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByRole('button', { name: /Open in Daz/ }).first().click()

  await expect(page.getByRole('button', { name: /Open scene/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Open ROM Animation/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Open and Generate ROM Animation/ })).toBeVisible()
})
