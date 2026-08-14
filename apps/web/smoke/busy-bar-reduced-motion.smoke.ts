// The busy accent bar must still ANIMATE under `prefers-reduced-motion: reduce`.
//
// This is a regression spec, not a nicety: `animation: none` shipped here for one
// commit and the bar sat frozen on a Windows machine whose Accessibility →
// Visual effects → "Animation effects" toggle is off (Chromium maps
// prefers-reduced-motion from SPI_GETCLIENTAREAANIMATION, NOT from MinAnimate —
// see .ai/gotchas-web.md). The stripes are a background-image, so they still
// RENDER when the animation is dead: the bar looked like decoration and the
// "this project is being re-read" signal was silently gone.
//
// Playwright's default context is `no-preference`, so the plain busy specs
// exercise the other branch and would never have caught it.
import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.506'

function dthNode(name: string) {
  return { path: `/obj/${name}`, type: 'DazToHue::dth_import::2.0', label: name, parms: {} }
}

test('the busy bar keeps moving under prefers-reduced-motion: reduce', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true, houdiniProject: true })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: 'C:/Users/dev/Documents/houdini22.0',
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.materialScan = { [P.houdini]: [dthNode('FreshBox')] }
  // Long enough that the bar is still busy across the two samples below.
  seed.materialScanDelayMs = 20_000
  // `page.emulateMedia` rather than `test.use({ reducedMotion })`: the fixture
  // form did NOT reach the page here (matchMedia still reported no-preference),
  // and a silently-inactive emulation would make this spec re-test the ordinary
  // branch while claiming to cover the reduced one. This call is asserted below.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // The media query really is active for this context — otherwise the assertion
  // below would pass by testing the ordinary branch all over again.
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  )
  await expect(page.getByRole('status', { name: /Reading this project in Houdini/ })).toHaveCount(1)

  const phase = () =>
    page.evaluate(() => {
      const el = document.querySelector('.busy-bar-sweep')
      if (!el) return null
      const cs = getComputedStyle(el)
      return { pos: cs.backgroundPosition, play: cs.animationPlayState, name: cs.animationName }
    })

  const before = await phase()
  expect(before).not.toBeNull()
  expect(before?.name).toBe('dth-busy-bar-stripes')
  expect(before?.play).toBe('running')

  // The proof of MOTION: the pattern's offset has to actually advance. Polled
  // rather than sampled once — a fixed wait would flake on a slow CI frame, and
  // "it moved at all" is the whole claim.
  await expect
    .poll(async () => (await phase())?.pos, { timeout: 5_000 })
    .not.toBe(before?.pos)
})
