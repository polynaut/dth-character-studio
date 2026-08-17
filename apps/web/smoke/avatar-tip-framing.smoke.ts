import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Daz does not frame every Genesis generation the same way in the `.tip.png` it
// renders: G3/G8/G8.1 figures come out sitting noticeably HIGHER in the square
// than G9 does. The header portrait is a fixed pan over that square, so ONE set
// of offsets cannot serve both — the G9-tuned pan crops the top of a G8 head and
// leaves a band of empty tile under the chin.
//
// The offsets live in styles.css as `--dth-avatar-pan-*`; which pair applies is
// decided by `data-tip-framing` on the wrapper, from a Record keyed by every
// GenesisVersion (so a new generation can't silently inherit a framing nobody
// looked at). This pins the wiring end to end — the variable actually reaching
// the painted transform — rather than the attribute alone, which could be set
// and still do nothing.

/** The portrait's resting vertical offset in painted px (the pan's `from` end,
 *  which is what shows before the header starts collapsing at 130px). */
const panY = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.avatar-scroll-pan')
    if (!el) throw new Error('no .avatar-scroll-pan on the page')
    return new DOMMatrix(getComputedStyle(el).transform).f
  })

/** The painted height the percentage offsets resolve against. */
const panHeight = (page: Page) =>
  page.evaluate(() => document.querySelector('.avatar-scroll-pan')!.getBoundingClientRect().height)

async function openCharacter(page: Page, genesis: string) {
  // With an active project the window opens INTO it, so the character is one
  // click away — `/` alone lands on the launcher's recents list.
  const seed = buildSeed({ activeProjectFile: P.dcsp })
  const file = `${P.charFolder}/Kira.json`
  seed.files[file] = JSON.stringify({
    ...(JSON.parse(seed.files[file]!) as Record<string, unknown>),
    genesis,
  })
  // The generated script's NAME carries the generation (`characterScriptName` =
  // slug_genesis), so re-stamping the character without moving its script leaves
  // the startup staleness probe seeing "runtime: not generated" — it redirects
  // the whole window to Refresh assets and there is no header to measure. Rename
  // rather than add: a leftover G9 script would be a second, stale generation.
  const g9 = `${P.scriptsDir}/ROM_Kira_G9.dsa`
  if (genesis !== 'G9') {
    seed.files[`${P.scriptsDir}/ROM_Kira_${genesis}.dsa`] = seed.files[g9]!
    delete seed.files[g9]
  }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.locator('.avatar-scroll-pan').waitFor()
}

test('a G9 portrait rests at the G9 pan', async ({ page }) => {
  await openCharacter(page, 'G9')
  const height = await panHeight(page)
  // 11% — the offset the pan was originally tuned to, on the generation it was
  // tuned against. Tolerant by a pixel: the wrapper is laid out in CSS px and
  // the matrix comes back as a float.
  expect(await panY(page)).toBeCloseTo(height * 0.11, 0)
})

for (const genesis of ['G8.1', 'G8', 'G3']) {
  test(`a ${genesis} portrait rests LOWER, where Daz puts that generation's face`, async ({
    page,
  }) => {
    await openCharacter(page, genesis)
    const height = await panHeight(page)
    // 15% — four points further down than G9. The assertion is on the painted
    // transform, so it fails if the attribute is set but the variable never
    // reaches the image (a broken cascade looks identical from the DOM).
    expect(await panY(page)).toBeCloseTo(height * 0.15, 0)
  })
}
