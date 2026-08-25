import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The path rule itself, not a copy of it — this seed has to land exactly where
// the app stats, and both the folder name and the `_ROM` suffix have moved
// before (the folder was the hidden `.ROM_Animations` until runtime v48). Taken
// from the import-FREE leaf module that exists for this: dsa.ts, which
// re-exports it, drags in csv.ts's Vite `?raw` templates that Playwright's
// node-side loader cannot resolve.
import { romAnimationPath } from '../../../packages/rom/src/rom-animation.ts'

import type { Page } from '@playwright/test'

// A scene card's open menu, and the TWO things a freshness verdict used to take
// away from it. Both rows are unconditional on that verdict now, and each test
// below pins one of the two directions it used to swing.
//
// - Read STALE, it hid the OPEN row (swapped for "Open and Generate"). Staleness
//   is cheap to earn: the test dates the generated ROM script, which every
//   character save rewrites, so editing anything at all stales every saved
//   animation of that character — and a primary scene whose ROM had been built
//   and exported ended up offering only to build it again, a Daz run of many
//   minutes, with no way to open the file sitting right there.
// - Read CURRENT, it hid the REBUILD row, behind a Ctrl-held escape hatch nobody
//   finds. That reading has no ground truth outside our own writes: a Perforce
//   sync that writes `rom-animations/` after the scenes marks every animation
//   current, and the rebuild vanished from every scene in the tree.
//
// Stale is not wrong; it is "not from the current definition", which is the
// user's call. It picks the open row's TOOLTIP and gates nothing.

const DS4 = 'C:/Program Files/DAZ 3D/DAZStudio4'
/** Where the primary scene's saved ROM animation lives. */
const ROM = romAnimationPath(P.scene)

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

  const open = page.getByRole('button', { name: /Open last ROM/ })
  await expect(open).toBeVisible()
  // …and its tooltip says why it might not be what you want, rather than the
  // row hiding itself (an inline hint line once — dropped, it made the menu
  // wide). Read title OR data-tooltip: TooltipHost rewrites a hovered
  // control's title into data-tooltip (see override.smoke.ts).
  await expect
    .poll(async () => (await open.getAttribute('title')) ?? (await open.getAttribute('data-tooltip')))
    .toMatch(/earlier run/)
  // The rebuild is the other entry now, not a replacement for this one.
  await expect(page.getByRole('button', { name: /Generate new ROM/ })).toBeVisible()

  // Opening it opens THAT file — the ROM animation, not the source scene.
  await open.click()
  await expect
    .poll(() => callsNamed(page, 'launch_daz_studio'))
    .toEqual([{ installFolder: DS4, scenePath: ROM }])
})

test('a CURRENT one is offered unmarked — with the rebuild still under it', async ({ page }) => {
  await openCharacter(page, { stale: false })

  const open = page.getByRole('button', { name: /Open last ROM/ })
  await expect(open).toBeVisible()
  // title OR data-tooltip — same TooltipHost caveat as the stale test above.
  await expect
    .poll(async () => `${await open.getAttribute('title')}${await open.getAttribute('data-tooltip')}`)
    .not.toMatch(/earlier run/)
  // THE REGRESSION THIS FILE EXISTS FOR: the rebuild used to hide right here,
  // on "nothing to refresh", and this is the reading a synced tree gives every
  // animation it holds (see the header). It is unconditional now.
  await expect(page.getByRole('button', { name: /Generate new ROM/ })).toBeVisible()
})

test('no saved animation at all — only the scene and the build', async ({ page }) => {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dazInstallFolder: DS4 })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByRole('button', { name: /Open in Daz/ }).first().click()

  await expect(page.getByRole('button', { name: /Open scene/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Open last ROM/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Generate new ROM/ })).toBeVisible()
})
