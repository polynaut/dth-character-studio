import { expect, test, type Locator, type Page } from '@playwright/test'

import { buildSeed, DIM_FOLDER, P, UPROJECT, prime, settle, type SeedOptions } from './fixtures.ts'

// Documentation screenshots for docs/guide/*. Reuses the smoke Tauri fake +
// fixture world (one project "Demo", one character "Kira"). Each `test`
// navigates to a screen/state and writes a PNG; the final `coverage` test is
// the only assertion — it keeps the guide and this suite in lockstep.
//
// ── REGENERATING EVERYTHING (e.g. after a restyle) ──────────────────────────
// One command, from the repo root:
//
//     pnpm screenshots
//
// That regenerates every PNG in docs/guide/screenshots/ deterministically:
//  - the world is the in-memory fixture (no real Daz install, no personal data),
//  - the clock is FROZEN (prime() pins Date/Date.now via page.clock), and the
//    config pins locale + timezone — so file dates and "saved …" strings render
//    identically on every machine and every run,
//  - viewport (1280×720 @2x, dark) and the self-hosted font are fixed by the
//    config — no OS fonts, no theme drift.
// Contract: a SECOND full run right after the first must leave `git diff`
// empty. If it doesn't, a new source of nondeterminism crept in — fix it here
// (never hand-revert PNGs as a workaround).
// After a restyle, every PNG changing is EXPECTED — review the diff visually,
// commit the lot. There are NO hand-tuned crop constants: `shoot`/`shootStrip`
// drop the app's sticky chrome, scroll the feature to the top and clip tight to
// it, so a changed header / section-title height can't tuck a feature under it.
// NOT covered here: the guide's Daz-/Houdini-side photos (user-attachments
// CDN links in docs/guide/*.md) — those are taken manually in Daz/Houdini and
// are unaffected by an app restyle.
//
// To ADD a screenshot: write a test that navigates/clicks to the state, then
// call `shoot(page, join(OUT, '<name>.png'), <feature?>)` and reference the
// PNG from a guide page (the coverage test fails on unreferenced or missing
// shots). Pass a `feature` locator when the doc is about one region so the
// shot trims to it; omit it to grab the realistic 16:9 viewport from the top.
// Keep the width constant (never override it) so every image lines up.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'

// Absolute output dir (repo/docs/guide/screenshots) — a relative path resolves
// against Playwright's cwd, which isn't the repo root.
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/guide/screenshots')

/** App width (px) — kept constant across every shot so the guide lines up. */
const VW = 1280
/** 16:9 of the width — a realistic widescreen viewport; the height cap. */
const MAX_H = 720

// prime() (frozen clock + devtools flag + Tauri fake) and settle() are shared
// with guide.clips.ts — they live in fixtures.ts (see FIXED_TIME there).

/**
 * Screenshot the documented feature at a realistic height — you work on a 16:9
 * screen and don't see a whole tall page at once. Always the constant app width.
 *
 * - no `feature`: the viewport from the top (VW×MAX_H) — for pages whose start
 *   is the point.
 * - a small `feature` (fits under MAX_H): height trimmed to the feature so the
 *   whole thing shows and nothing else.
 * - a big `feature`: capped at MAX_H, aligned to the feature's top (its start /
 *   most important part visible).
 */
// ── Framing a feature (dynamic — lead with the feature, no pixel constants) ───
// Every feature shot should START at the feature, not show the page header or a
// pinned section title above it. So for an in-flow feature we DROP all sticky/fixed
// chrome (nothing can pin over it or sit above it), scroll it to the top, and clip
// tight to its box — a restyle that changes chrome heights can no longer tuck a
// feature's title under a header. A `position: fixed` feature (a modal dialog) is
// left in its overlay and only tight-clipped. Every shot asserts the feature is
// visible, so a selector that matched a collapsed/off-screen node fails loudly
// instead of yielding a blank or mis-cropped PNG.

/** Tall viewport so any page can scroll far enough to bring a feature to the top. */
const VH = MAX_H + 280

/** Un-stick every sticky/fixed bar (page header, pinned section title, pinned table
 *  column headers) so nothing overlays or sits above the feature being framed. */
async function dropStickyChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const node of Array.from(document.querySelectorAll('body *'))) {
      const el = node as HTMLElement
      const pos = getComputedStyle(el).position
      if (pos === 'sticky' || pos === 'fixed') el.style.position = 'static'
    }
  })
}

/** True when `feature` lives inside a `position: fixed` subtree (a modal dialog) —
 *  such a feature must NOT be un-stuck (it would drop out of its centered overlay). */
async function inFixedOverlay(feature: Locator): Promise<boolean> {
  return feature.evaluate((el) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true
    }
    return false
  })
}

/** Scroll `feature` so its top lands `target` px below the viewport top and return its
 *  box. `scrollIntoView` on a tall section can OVER-scroll (its top ends up above the
 *  viewport), so after the initial jump we measure the real top and nudge the window
 *  scroll until it lands — no hand-tuned offsets, robust to any height change. Throws
 *  if the feature has no visible height, so a broken selector fails loudly. */
async function frame(page: Page, feature: Locator, label: string, scroll: boolean, target = 20) {
  if (scroll) {
    await feature.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    for (let i = 0; i < 6; i++) {
      await settle(page)
      const top = await feature.evaluate((el) => Math.round(el.getBoundingClientRect().top))
      const delta = top - target
      if (Math.abs(delta) <= 2) break // landed on target
      await page.evaluate((d) => window.scrollBy(0, d), delta)
    }
  }
  const box = await feature.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.ceil(r.bottom), height: r.height }
  })
  if (box.height < 4) throw new Error(`screenshot "${label}": feature has no visible height`)
  return box
}

async function shoot(page: Page, path: string, feature?: Locator) {
  await page.mouse.move(0, 0) // park the cursor off any control so no hover state is caught
  await settle(page)
  if (!feature) {
    await page.screenshot({ path })
    return
  }
  await page.setViewportSize({ width: VW, height: VH })
  const fixed = await inFixedOverlay(feature)
  if (!fixed) await dropStickyChrome(page) // nothing pins over or above the feature
  const box = await frame(page, feature, path, !fixed)
  const pad = 24
  // Clip tight so the shot LEADS with the feature (a dialog frames the same way, just
  // without the scroll/un-stick above).
  const y = Math.max(0, box.top - 12)
  const height = Math.min(box.bottom + pad, VH) - y
  await page.screenshot({ path, clip: { x: 0, y, width: VW, height } })
}

/**
 * A tight, full-width horizontal strip framing one region (`topEl` → `bottomEl`, or
 * just `topEl`): drops the sticky chrome so nothing overlaps, scrolls the region to
 * the top, and clips exactly it (+pad). Width stays VW like every other shot, so a
 * small control (a toggle row, the footer bar) documents as a clean band.
 */
async function shootStrip(page: Page, path: string, topEl: Locator, bottomEl?: Locator) {
  await page.mouse.move(0, 0) // park the cursor off any control so no hover state is caught
  await settle(page)
  await page.setViewportSize({ width: VW, height: VH })
  await dropStickyChrome(page)
  const topBox = await frame(page, topEl, path, true)
  const bottom = await (bottomEl ?? topEl).evaluate((el) =>
    Math.ceil(el.getBoundingClientRect().bottom),
  )
  const pad = 20
  const y = Math.max(0, topBox.top - pad)
  const height = Math.max(1, bottom - y + pad)
  await page.screenshot({ path, clip: { x: 0, y, width: VW, height } })
}

test('home', async ({ page }) => {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await shoot(page, join(OUT, 'home.png'))
})

// NOTE: navigate to /tools and /settings by CLICKING the header links, not
// page.goto — main.tsx runs a one-time startup navigation (project → its route,
// else → '/') that a hard goto/reload would re-trigger, bouncing the shot back
// to the home screen. A client-side Link click doesn't reload, so the route sticks.
test('tools-page', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-page.png'))
})

test('tools-daz-assets', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-daz-assets.png'), card(page, 'Daz assets'))
})

test('tools-deduplicate', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-deduplicate.png'), card(page, 'Deduplicate'))
})

test('tools-danger-zone', async ({ page }) => {
  await openTools(page)
  await shoot(page, join(OUT, 'tools-danger-zone.png'), card(page, 'Danger zone'))
})

test('tools-refresh', async ({ page }) => {
  await openTools(page)
  await page.getByRole('tab', { name: 'Refresh assets' }).click()
  await shoot(page, join(OUT, 'tools-refresh.png'))
})

/** The `<section>` card that contains a given heading — the app's consistent
 *  card wrapper, so a feature crops to exactly its card. */
function card(page: Page, heading: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) })
}

/** Open the Tools page (Home window → header "Tools" link). */
async function openTools(page: Page) {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Tools' }).click()
}

/** Open the demo character's editor in a project window. Extra seed options tune
 *  the project (e.g. `dazProductsEnabled` to reveal the Products tab). */
async function openCharacter(page: Page, seedOpts: SeedOptions = {}) {
  await prime(page, buildSeed({ demo: true, activeProjectFile: P.dcsp, ...seedOpts }))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
}

/** Open the demo project's overview (character list + Unreal footer). */
async function openProject(page: Page, seedOpts: SeedOptions = {}) {
  await prime(page, buildSeed({ demo: true, activeProjectFile: P.dcsp, ...seedOpts }))
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).waitFor()
}

/** Open Settings in a project window (its Project tab leads) via the header link. */
async function openProjectSettings(page: Page, seedOpts: SeedOptions = {}) {
  await openProject(page, seedOpts)
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Project' }).waitFor()
}

/** The `.dcsp`-manifest toggle row (Settings → Project) carrying a given label. */
function projectRow(page: Page, label: string): Locator {
  return page.locator('div.border-t', { hasText: label })
}

test('settings-dth-release', async ({ page }) => {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await shoot(page, join(OUT, 'settings-dth-release.png'), card(page, 'Setup DTH Release'))
})

test('home-new-project', async ({ page }) => {
  // First-run Home (no recents) + a seeded folder pick, so the create form fills
  // in with a chosen folder and its auto-derived name instead of staying empty.
  await prime(page, buildSeed({ emptyRecents: true, dialogPath: P.project }))
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await page.getByRole('button', { name: /Choose folder/ }).click()
  // The picked folder + auto-filled name now show — wait for the Create button.
  await page.getByRole('button', { name: 'Create' }).waitFor()
  await shoot(page, join(OUT, 'home-new-project.png'), page.getByRole('dialog'))
})

test('project-open-window', async ({ page }) => {
  // The just-created project, opened in its own window: no characters yet.
  await prime(page, buildSeed({ activeProjectFile: P.dcsp, emptyProject: true }))
  await page.goto('/')
  await page.getByText('No characters yet').waitFor()
  await shoot(page, join(OUT, 'project-open-window.png'))
})

/** Exception to the 16:9 cap: shoot from the top of the page DOWN THROUGH
 *  `endFeature`, so a feature below the fold (e.g. the linked Daz scene card)
 *  isn't cut off. Grows the viewport first so everything renders in one frame. */
async function shootTopThrough(page: Page, path: string, endFeature: Locator) {
  await page.mouse.move(0, 0) // park the cursor off any control so no hover state is caught
  await page.setViewportSize({ width: VW, height: 1500 })
  await settle(page)
  // Selecting a scene card (openCharacterOnOutfitScene) scrolls the page down to
  // click it; anchor back at the top so the from-top clip stays in-bounds.
  await page.evaluate(() => window.scrollTo(0, 0))
  const bottom = await endFeature.evaluate((el) => Math.ceil(el.getBoundingClientRect().bottom))
  await page.screenshot({
    path,
    clip: { x: 0, y: 0, width: VW, height: bottom + 24 },
  })
}

test('character-settings', async ({ page }) => {
  await openCharacter(page)
  // The top of the character page ("Character settings"): Genesis/Gender + the
  // Genesis-9-specific box, the primary Daz scene card, the Hair-items toggle +
  // selected item, and the linked Houdini project. Taller than 16:9 (an exception).
  await shootTopThrough(
    page,
    join(OUT, 'character-settings.png'),
    page.getByRole('button', { name: /Add project/ }),
  )
})

test('character-header', async ({ page }) => {
  await openCharacter(page)
  await shootTopThrough(page, join(OUT, 'character-header.png'), page.getByRole('tab', { name: 'Character' }))
})

test('character-rom-sections', async ({ page }) => {
  await openCharacter(page)
  await shoot(page, join(OUT, 'character-rom-sections.png'), card(page, 'ROM'))
})

test('character-export-directory', async ({ page }) => {
  await openCharacter(page)
  await shoot(page, join(OUT, 'character-export-directory.png'), card(page, 'Export directory'))
})

test('character-advanced-options', async ({ page }) => {
  await openCharacter(page)
  // "Advanced options" is a plain always-open section now (preserve morphs + node
  // transforms) — no longer a collapsible <details>. Frame just its card (title →
  // last field) so the shot leads with the "Advanced options" heading.
  await shootStrip(
    page,
    join(OUT, 'character-advanced-options.png'),
    page.getByRole('heading', { name: 'Advanced options' }).locator('xpath=ancestor::section[1]'),
  )
})

test('jcm-modify-grid', async ({ page }) => {
  await openCharacter(page)
  // Expand the JCM ROM section, then its "Modify JCM frames" grid (the fixture
  // seeds two real thigh-bone rules driving glute morphs).
  await page.getByRole('button', { name: /Joint Corrective/ }).click()
  await page.getByText('Modify JCM frames').click()
  const grid = page
    .getByText('Modify JCM frames')
    .locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
  await shoot(page, join(OUT, 'jcm-modify-grid.png'), grid)
})

test('character-bone-scale-toggle', async ({ page }) => {
  await openCharacter(page)
  // Expand the FBM section (a big custom morph list) — its pose table carries the
  // per-row "Bone scale" column (the reference-skeleton FBX marker).
  await page.getByRole('button', { name: /FBM/ }).click()
  const boxes = page.getByTitle(
    'This morph scales bones — export a reference-skeleton FBX for it',
  )
  await boxes.first().waitFor()
  // Tick the 2nd pose's Bone scale box, then park the cursor so the column's hover
  // tooltip closes before the shot.
  await boxes.nth(1).check()
  await page.mouse.move(0, 0)
  await settle(page)
  await page.setViewportSize({ width: VW, height: 900 })
  // Un-stick the page chrome so a short crop of the top rows has no pinned overlap
  // (the character page stacks a header + section title + column headers, all
  // sticky), then bring the pose table's column headers to the top.
  await page.evaluate(() => {
    const h = document.querySelector('header.sticky')
    if (h) (h as HTMLElement).style.display = 'none'
    document.querySelectorAll('.sticky').forEach((el) => {
      ;(el as HTMLElement).style.position = 'static'
    })
  })
  const thead = page.locator('table').first().locator('thead')
  await thead.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await settle(page)
  const top = await thead.evaluate((el) => Math.floor(el.getBoundingClientRect().top))
  const theadH = await thead.evaluate((el) => el.getBoundingClientRect().height)
  const rowH = await boxes
    .nth(0)
    .locator('xpath=ancestor::tr[1]')
    .evaluate((el) => el.getBoundingClientRect().height)
  // Header + exactly 3 pose rows (nth(2).bottom mis-measures with the un-stuck table).
  const y = Math.max(0, top - 8)
  const height = Math.ceil(theadH + 3 * rowH + 8)
  await page.screenshot({
    path: join(OUT, 'character-bone-scale-toggle.png'),
    clip: { x: 0, y, width: VW, height },
  })
})

test('gen-art-direction', async ({ page }) => {
  await openCharacter(page)
  // Expand the GEN section (preset Golden Palace), then its VaginaOpen art-direction
  // frame — the fixture seeds one morph on it, the rest read "preset default".
  await page.getByRole('button', { name: /Genitalia/ }).click()
  await page.getByText('VaginaOpen').click()
  const gen = page
    .getByRole('button', { name: /Genitalia/ })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
  await shoot(page, join(OUT, 'gen-art-direction.png'), gen)
})

test('combine-morphs', async ({ page }) => {
  await openCharacter(page)
  await page.getByRole('button', { name: /FBM/ }).click()
  // Two real multi-morph poses from the fixture: SLGlutesSS (4 morphs) and
  // SLGlutesHipBendSpandex (2) — expand both to show the combined-morph editor.
  // Also expand the last single-morph row (InvictaWaistGarterBelt — the one right
  // above the combined examples) so the shot shows all three cases back to back:
  // an expanded single morph, then the 4- and 2-morph combined poses.
  await page.getByText('morphs', { exact: true }).last().click()
  await page.getByText('4 morphs', { exact: true }).click()
  await page.getByText('2 morphs', { exact: true }).click()
  await page.mouse.move(0, 0)
  await settle(page)
  await page.setViewportSize({ width: VW, height: 1000 })
  // Scroll the expanded single-morph row just below the pinned FBM section title +
  // column headers, so all three expanded examples sit under them (the real
  // scrolled view — poses above are hidden behind the pinned headers).
  const firstRow = page
    .getByText('morphs', { exact: true })
    .last()
    .locator('xpath=ancestor::tr[1]')
  await firstRow.evaluate((el) => {
    ;(el as HTMLElement).style.scrollMarginTop = '250px'
    el.scrollIntoView({ block: 'start' })
  })
  await settle(page)
  // Capture from the pinned section title (context) down through the 2nd example —
  // dropping the character page header above it (start the clip at the title).
  const title = page
    .getByRole('button', { name: /FBM/ })
    .locator('xpath=ancestor::div[contains(@class,"sticky")][1]')
  const top = await title.evaluate((el) => Math.floor(el.getBoundingClientRect().top))
  const bottom = await page
    .getByRole('button', { name: 'Add morph', exact: true })
    .last()
    .evaluate((el) => Math.ceil(el.getBoundingClientRect().bottom))
  const y = Math.max(0, top)
  await page.screenshot({
    path: join(OUT, 'combine-morphs.png'),
    clip: { x: 0, y, width: VW, height: Math.min(bottom - y + 24, 1000 - y) },
  })
})

/** Open the demo character with the second (outfit) scene linked and SELECT it —
 *  the state the multi-scene docs describe (per-scene hair, header tag, override). */
async function openCharacterOnOutfitScene(page: Page) {
  await openCharacter(page, { extraScene: true })
  await page.getByText('KiraSummertide_G9_GP', { exact: true }).first().click()
}

test('character-daz-scenes', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  // The Daz scenes block: both cards (outfit selected) + its per-scene hair
  // list. The hair picker (an unnamed combobox) is the page's last combobox.
  await shootStrip(
    page,
    join(OUT, 'character-daz-scenes.png'),
    page.getByText('Daz scenes', { exact: true }),
    page.getByRole('combobox').last(),
  )
})

test('character-scene-tag', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  // The header with the selected scene tagged next to the character name.
  await shootTopThrough(
    page,
    join(OUT, 'character-scene-tag.png'),
    page.getByRole('tab', { name: 'Character' }),
  )
})

test('rom-override-grid', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  await page.getByRole('button', { name: /FBM/ }).click()
  // On a non-primary scene the grid is ALWAYS in override mode — no toggle. Edit the
  // SECOND pose's value to arm it as a per-scene override: the row turns green and
  // gains a reset button, sitting between untouched (still fully editable) base rows.
  const values = page.locator('table').first().locator('input[inputmode="decimal"]')
  await values.nth(1).fill('80')
  await values.nth(1).press('Enter')
  await page.locator('[title="Reset this frame to the base ROM"]').first().waitFor()
  await page.mouse.move(0, 0)
  await settle(page)
  await page.setViewportSize({ width: VW, height: 900 })
  // Same un-stick + slice approach as the bone-scale shot: column headers + the
  // first pose rows, without the page's stacked sticky chrome overlapping.
  await page.evaluate(() => {
    const h = document.querySelector('header.sticky')
    if (h) (h as HTMLElement).style.display = 'none'
    document.querySelectorAll('.sticky').forEach((el) => {
      ;(el as HTMLElement).style.position = 'static'
    })
  })
  const thead = page.locator('table').first().locator('thead')
  await thead.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await settle(page)
  const top = await thead.evaluate((el) => Math.floor(el.getBoundingClientRect().top))
  const theadH = await thead.evaluate((el) => el.getBoundingClientRect().height)
  const rowH = await page
    .locator('table')
    .first()
    .locator('tbody tr')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height)
  const y = Math.max(0, top - 8)
  const height = Math.ceil(theadH + 4 * rowH + 8)
  await page.screenshot({
    path: join(OUT, 'rom-override-grid.png'),
    clip: { x: 0, y, width: VW, height },
  })
})

test('products-tab', async ({ page }) => {
  // Daz Products on + a seeded per-scene scan CSV → the character page splits into
  // Character / Products, and the Products tab renders the matched-products table.
  await openCharacter(page, {
    dazProductsEnabled: true,
    dimManifestsFolder: DIM_FOLDER,
    productScan: true,
  })
  await page.getByRole('tab', { name: 'Products' }).click()
  await page.getByRole('heading', { name: 'Matched products' }).waitFor()
  await shoot(page, join(OUT, 'products-tab.png'), card(page, 'Matched products'))
})

test('settings-attachments', async ({ page }) => {
  await openProjectSettings(page, { assetsEnabled: true })
  await shootStrip(page, join(OUT, 'settings-attachments.png'), projectRow(page, 'Enable attachments'))
})

test('settings-daz-products', async ({ page }) => {
  await openProjectSettings(page, { dazProductsEnabled: true, dimManifestsFolder: DIM_FOLDER })
  // Through the DIM field below the toggle — the whole product-scanning config.
  await shootStrip(
    page,
    join(OUT, 'settings-daz-products.png'),
    projectRow(page, 'Enable Daz Products'),
    page.getByRole('button', { name: /Detect installed location/ }),
  )
})

test('settings-dim-manifests', async ({ page }) => {
  await openProjectSettings(page, { dazProductsEnabled: true, dimManifestsFolder: DIM_FOLDER })
  const dim = page.getByRole('button', { name: /Detect installed location/ }).locator('xpath=..')
  await shootStrip(page, join(OUT, 'settings-dim-manifests.png'), dim)
})

test('attachment-add-panel', async ({ page }) => {
  await openProject(page, { assetsEnabled: true })
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  // 'Attachment' (panel tab) is a substring of 'Attachments' (list tab) — exact.
  await page.getByRole('tab', { name: 'Attachment', exact: true }).click()
  await shoot(page, join(OUT, 'attachment-add-panel.png'), page.getByRole('dialog'))
})

test('project-unreal-footer', async ({ page }) => {
  await openProject(page, { unrealProjects: [UPROJECT] })
  // The linked-Unreal footer bar docked at the bottom of the viewport.
  const bar = page.getByText('Unreal projects', { exact: true }).locator('xpath=ancestor::div[1]')
  await shootStrip(page, join(OUT, 'project-unreal-footer.png'), bar)
})

test('character-create-panel', async ({ page }) => {
  // The picker returns the demo scene, so choosing it fills the create form
  // (scene preview, name, Genesis/Gender, ROM prefill) instead of staying empty.
  await openProject(page, { dialogPath: P.scene })
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  await page.getByRole('button', { name: /Choose Daz scene/ }).click()
  await page.getByText('Character name').waitFor()
  await shoot(page, join(OUT, 'character-create-panel.png'), page.getByRole('dialog'))
})

/**
 * A tight detail crop around one element (+pad) — for the small `detail-*.png`
 * shots the guide shows at natural size (guide.css exempts them from the
 * column stretch). Deliberately does NOT park the mouse: hover states are
 * often the point of a detail shot.
 */
async function shootTight(page: Page, path: string, el: Locator) {
  // Room for the hover badge that overlaps the top-right corner; tight on the
  // other sides so neighbouring UI stays out of the crop.
  const pad = { top: 14, right: 14, bottom: 6, left: 6 }
  const b = (await el.boundingBox())!
  await page.screenshot({
    path,
    clip: {
      x: b.x - pad.left,
      y: b.y - pad.top,
      width: b.width + pad.left + pad.right,
      height: b.height + pad.top + pad.bottom,
    },
  })
}

// (The plain hover/copy interaction is a WebP clip now — guide.clips.ts' path-chip-copy.)

test('detail-path-chip-alt', async ({ page }) => {
  await openProject(page)
  // Alt held: the hover badge flips to the folder icon — previewing that
  // Alt+click opens the location in Explorer instead of copying.
  const chip = page.getByRole('button', { name: 'Copy path' }).first()
  await settle(page)
  await page.keyboard.down('Alt')
  await chip.hover()
  await page.waitForTimeout(250)
  await shootTight(page, join(OUT, 'detail-path-chip-alt.png'), chip)
  await page.keyboard.up('Alt')
})

test('settings-exporter-plugin', async ({ page }) => {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await shoot(
    page,
    join(OUT, 'settings-exporter-plugin.png'),
    card(page, 'Setup DTH Exporter Plugin Release'),
  )
})

test('detail-morph-autocomplete', async ({ page }) => {
  await openCharacter(page)
  await page.getByRole('button', { name: /FBM/ }).click()
  await settle(page)
  // Focus a Morph-name cell (found by its fixture value) and retype a prefix —
  // the seeded morphs_G9.json index answers with suggestions.
  const handle = await page.evaluateHandle(() => {
    const input = [...document.querySelectorAll('input')].find(
      (i) => i.value === 'SS_body_bs_Glute UpDown',
    )!
    input.scrollIntoView({ block: 'center' })
    return input
  })
  const input = handle.asElement()
  await input.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Glute', { delay: 30 })
  const dropdown = page.locator('div.top-full.z-30')
  await dropdown.waitFor()
  await page.waitForTimeout(250)
  const a = (await input.boundingBox())!
  const b = (await dropdown.boundingBox())!
  const pad = 14
  const x = Math.min(a.x, b.x) - pad
  const y = Math.min(a.y, b.y) - pad
  await page.screenshot({
    path: join(OUT, 'detail-morph-autocomplete.png'),
    clip: {
      x,
      y,
      width: Math.max(a.x + a.width, b.x + b.width) - x + pad,
      height: Math.max(a.y + a.height, b.y + b.height) - y + pad,
    },
  })
})

// ── Coverage guard ───────────────────────────────────────────────────────────
// The one asserting test: keeps docs/guide and this suite in lockstep, both
// directions. Fails when a guide page references a PNG nothing generates
// (typo/rename/deleted test) or a PNG sits in screenshots/ that no guide page
// references anymore (orphan — delete its test + file, or reference it).
// Runs LAST (single worker, file order), so a full `pnpm screenshots` run
// verifies its own completeness.
test('coverage: guide references and generated screenshots match 1:1', async () => {
  const guideDir = join(OUT, '..')
  const referenced = new Set<string>()
  const referencedClips = new Set<string>()
  for (const md of (await readdir(guideDir)).filter((f) => f.endsWith('.md'))) {
    const text = await readFile(join(guideDir, md), 'utf8')
    for (const m of text.matchAll(/screenshots\/([\w.-]+\.png)/g)) referenced.add(m[1])
    for (const m of text.matchAll(/clips\/([\w.-]+\.webp)/g)) referencedClips.add(m[1])
  }
  const onDisk = (await readdir(OUT)).filter((f) => f.endsWith('.png'))
  const missing = [...referenced].filter((f) => !onDisk.includes(f)).sort()
  const orphans = onDisk.filter((f) => !referenced.has(f)).sort()
  expect(missing, `referenced in docs/guide but missing from screenshots/: ${missing.join(', ')}`).toEqual([])
  expect(orphans, `in screenshots/ but referenced by no guide page: ${orphans.join(', ')}`).toEqual([])
  // Same lockstep for the interaction clips (guide.clips.ts → docs/guide/clips).
  const clipsOnDisk = await readdir(join(guideDir, 'clips')).catch(() => [] as string[])
  const missingClips = [...referencedClips].filter((f) => !clipsOnDisk.includes(f)).sort()
  const orphanClips = clipsOnDisk.filter((f) => f.endsWith('.webp') && !referencedClips.has(f)).sort()
  expect(missingClips, `referenced in docs/guide but missing from clips/: ${missingClips.join(', ')}`).toEqual([])
  expect(orphanClips, `in clips/ but referenced by no guide page: ${orphanClips.join(', ')}`).toEqual([])
})
