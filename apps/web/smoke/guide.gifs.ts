import { expect, test, type Page } from '@playwright/test'

import { buildSeed, P, prime, settle } from './fixtures.ts'
import { GifRecorder } from './gif-recorder.ts'

// Interaction GIFs for docs/guide/* — the moving-picture siblings of
// guide.screenshots.ts. Same fixture world, same determinism contract (a
// second full run must leave `git diff` empty): interactions are scripted as
// FIXED frame sequences — a fake cursor glides between UI states, every frame
// is a plain screenshot, gifenc encodes them reproducibly. See
// smoke/gif-recorder.ts for the machinery.
//
// Run: pnpm --filter @dth/web gifs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/guide/gifs')

// prime()/settle()/FIXED_TIME are shared with guide.screenshots.ts — they live
// in fixtures.ts. Only the clipboard stub is gif-specific:
// headless Chromium rejects the async clipboard API (permission grants
// included proved flaky) — stub it so click-to-copy takes its SUCCESS path
// and the "Copied" check badge shows in recordings. The app code path is
// unchanged; only the OS clipboard itself is faked.
const stubClipboard = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
    })
  })

test('path-chip-copy', async ({ page }) => {
  await prime(page, buildSeed({ demo: true, activeProjectFile: P.dcsp }))
  await stubClipboard(page)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).waitFor()
  await settle(page)

  const chip = page.getByRole('button', { name: 'Copy path' }).first()
  const box = (await chip.boundingBox())!
  const target = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.6 }

  // Clip: the chip's neighbourhood, wide enough to show the approach.
  const rec = new GifRecorder(page, {
    x: Math.max(0, box.x - 120),
    y: Math.max(0, box.y - 56),
    width: box.width + 240,
    height: box.height + 112,
  })
  await rec.install()
  await rec.placeAt(target.x + 170, target.y + 46) // enter from bottom-right
  await rec.hold(500)
  await rec.glideTo(target.x, target.y, 10) // hover: the copy badge pops in
  await rec.hold(600)
  await rec.click() // click: copies — the badge flips to the check mark
  // The copy must actually land (clipboard stub!) — otherwise the GIF silently
  // records a click with no feedback. NOTE: assert via a name-stable locator;
  // the `chip` locator above filters BY the name 'Copy path' and so can never
  // observe the 'Copied' state itself.
  await expect(page.locator('span[data-alt-reveal]').first()).toHaveAccessibleName('Copied')
  await rec.hold(1400)
  rec.save(join(OUT, 'path-chip-copy.gif'))
})
