import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// **One `imageOffsetY` has to mean the same fraction of the PICTURE in every
// avatar variant** — that is the whole reason it is a percentage and not a
// pixel nudge (lib/avatar-offset). This is not an appearance test: it asserts a
// ratio, so it survives every retune of the crops themselves and only fails if
// the offset stops landing where it is meant to.
//
// It exists because that failure already shipped once, invisibly. The offset was
// a plain `translateY(%)`, which resolves against the element's HEIGHT — right
// for a portrait frame, but a landscape scene chip holds an `object-cover`
// square whose painted height is the frame's WIDTH, so the chip under-shifted by
// height/width. Portrait variants read a correct 7.00% while the landscape chips
// read 4.20%, and nothing in the suite could tell. A human spotted it.
//
// The two probes are deliberately opposite SHAPES, which is the axis the bug
// lived on: a 3:4 scene card and the docked footer's landscape chip.
const CHAR_JSON = `${P.charFolder}/Kira.json`
const OFFSET = 7

const PROBES = {
  'scene card (portrait 3:4)': '.daz-card img',
  'footer chip (landscape)': '[class*="group/scene"] img',
}

/** Each image's offset WITHIN ITS OWN FRAME, plus the painted picture's height.
 *  The picture is a square as tall as the longer side of the image's box — the
 *  source is square and every frame is `object-cover`. */
async function probe(page: Page) {
  return page.evaluate((probes: Record<string, string>) => {
    const out: Record<string, { top: number; picture: number }> = {}
    for (const [name, sel] of Object.entries(probes)) {
      const img = document.querySelector(sel)
      if (!img) continue
      const r = img.getBoundingClientRect()
      const f = (img.parentElement as HTMLElement).getBoundingClientRect()
      out[name] = { top: r.y - f.y, picture: Math.max(r.width, r.height) }
    }
    return out
  }, PROBES)
}

async function openAt(page: Page, offsetY: number) {
  const seed = buildSeed({ activeProjectFile: P.dcsp, demo: true })
  const character = JSON.parse(seed.files[CHAR_JSON]) as Record<string, unknown>
  character.imageOffsetY = offsetY
  seed.files[CHAR_JSON] = JSON.stringify(character, null, 2)
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  // Scroll far enough to dock the scene footer, which is where the landscape
  // chip lives — without this the second probe simply isn't in the DOM.
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(600)
  return probe(page)
}

test('one offset shifts every avatar variant by the same fraction of the picture', async ({
  page,
}) => {
  const before = await openAt(page, 0)
  const after = await openAt(page, OFFSET)

  // Both probes must actually have been found — a renamed class would otherwise
  // turn this spec into a green no-op.
  expect(Object.keys(before)).toEqual(Object.keys(PROBES))
  expect(Object.keys(after)).toEqual(Object.keys(PROBES))

  for (const name of Object.keys(PROBES)) {
    const shift = after[name].top - before[name].top
    const pct = (shift / before[name].picture) * 100
    expect(pct, `${name} moved ${pct.toFixed(2)}% of its picture, want ${OFFSET}%`).toBeCloseTo(
      OFFSET,
      1,
    )
  }
})

test('no offset paints no transform at all — an un-nudged avatar is untouched', async ({
  page,
}) => {
  await openAt(page, 0)
  // The knob costs nothing when it is 0: no inline style, so no containment and
  // nothing for a future reader to explain away.
  const styles = await page.evaluate((sel: string) => {
    const img = document.querySelector(sel) as HTMLElement
    return { img: img.getAttribute('style'), frame: img.parentElement!.getAttribute('style') }
  }, PROBES['scene card (portrait 3:4)'])
  expect(styles.img).toBeNull()
  expect(styles.frame).toBeNull()
})
