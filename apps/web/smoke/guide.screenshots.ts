// Playwright drives a real browser: every action below is ORDERED by
// definition — a cursor glide is frames in sequence, a scroll-settle loop
// converges by re-measuring after each nudge. `Promise.all` over these is not a
// faster version of the same thing, it is a different (broken) script.
/* oxlint-disable no-await-in-loop */
import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  buildSeed,
  DIM_FOLDER,
  FIXED_TIME,
  P,
  UPROJECT,
  fakeDll,
  prime,
  settle,
  type SeedOptions,
} from './fixtures.ts'

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

/** For a shot whose state contains a RUNNING animation (a spinner on a live
 *  run): Playwright fast-forwards finite transitions to their end state and
 *  cancels infinite ones back to their start, so the frame is the same every
 *  time. Opt-in per shot rather than global — a still page needs it and the
 *  option shifts settled transitions, which would rewrite every other PNG for
 *  nothing. If a NEW shot ever fails the "second run = empty diff" contract,
 *  this is the fix. */
const STILL = { animations: 'disabled' } as const

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
  const height = bottom - y + pad
  // `frame` already fails loudly for a broken TOP locator; a bottom anchor that
  // resolves to the wrong element (above the top, or hidden) must fail the same
  // way — a degenerate strip once shipped as a 2px sliver without any test red.
  if (height < 40) {
    throw new Error(`screenshot "${path}": strip collapsed to ${height}px — stale bottom anchor?`)
  }
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
  // The page's intro shot shows the DEFAULT tab — Scan & index — which only
  // shows its full panel inside a project window, so open Tools there.
  await openScanTab(page)
  await shoot(page, join(OUT, 'tools-page.png'))
})

test('tools-daz-assets', async ({ page }) => {
  await openInstallTab(page)
  await shoot(page, join(OUT, 'tools-daz-assets.png'), card(page, 'Daz assets'))
})

test('tools-deduplicate', async ({ page }) => {
  await openInstallTab(page)
  await shoot(page, join(OUT, 'tools-deduplicate.png'), card(page, 'Deduplicate'))
})

test('tools-danger-zone', async ({ page }) => {
  await openInstallTab(page)
  await shoot(page, join(OUT, 'tools-danger-zone.png'), card(page, 'Danger zone'))
})

test('tools-refresh', async ({ page }) => {
  await openTools(page)
  await page.getByRole('tab', { name: 'Refresh assets' }).click()
  await shoot(page, join(OUT, 'tools-refresh.png'))
})

test('tools-scan-index', async ({ page }) => {
  await openScanTab(page)
  await shoot(page, join(OUT, 'tools-scan-index.png'), scanCard(page))
})

test('tools-scan-scenes', async ({ page }) => {
  await openScanTab(page)
  await page.getByRole('button', { name: 'Scenes to scan' }).click()
  // Expanded: Kira's tri-state row + one green scene card per linked scene.
  await page.getByRole('checkbox').first().waitFor()
  await shoot(page, join(OUT, 'tools-scan-scenes.png'), scanCard(page))
})

/** The Scan project card — its title is a `<label>` (not a heading), so locate
 *  it by the Start-scan button it uniquely contains. */
function scanCard(page: Page): Locator {
  return page.locator('section').filter({ has: page.getByRole('button', { name: 'Start scan' }) })
}

/** Tools → Scan & index in the PROJECT window (from Home the scene passes are
 *  disabled). Both demo scenes linked; Daz Products + DIM on so all three scan
 *  options render live; a Daz install folder so the Runner gate doesn't block. */
async function openScanTab(page: Page) {
  await prime(
    page,
    buildSeed({
      demo: true,
      activeProjectFile: P.dcsp,
      extraScene: true,
      dazProductsEnabled: true,
      dimManifestsFolder: DIM_FOLDER,
      dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio4 64-bit',
    }),
  )
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).waitFor()
  await page.getByRole('link', { name: 'Tools' }).click()
  // Scan & index is the default tab — just wait for the panel to be ready.
  await page.getByRole('button', { name: 'Start scan' }).waitFor()
}

/** The `<section>` card that contains a given heading — the app's consistent
 *  card wrapper, so a feature crops to exactly its card. */
function card(page: Page, heading: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) })
}

/** Open the Tools page (Home window → header "Tools" link). Lands on the
 *  default Scan & index tab. */
async function openTools(page: Page) {
  await prime(page, buildSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Tools' }).click()
}

/** Tools → the Daz Studio & Houdini installers tab (no longer the default). */
async function openInstallTab(page: Page) {
  await openTools(page)
  await page.getByRole('tab', { name: 'Daz Studio & Houdini' }).click()
  await page.getByRole('heading', { name: 'Daz assets' }).waitFor()
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

/** A machine with DIM and both Daz Studios — the case the cards exist for.
 *  Seeded as DIM's own INI files (`%APPDATA%/DAZ 3D`), which is what the app
 *  really reads, so a shot can never show a layout the code doesn't produce. */
const DIM_ROAMING = 'C:/Users/You/AppData/Roaming'
const DS6_DIR = 'C:/Program Files/DAZ 3D/DAZStudio6'
const DS4_DIR = 'C:/Program Files/DAZ 3D/DAZStudio4'
const DAZ_LIBRARY = 'D:/DAZ 3D/My DAZ 3D Library'
const DIM_MANIFESTS = 'D:/DAZ 3D/Install Manager/ManifestFiles'

/** …and two registered Houdini installs, with the prefs folders they pair to. */
const H22_DIR = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const H20_DIR = 'C:/Program Files/Side Effects Software/Houdini 20.5.864'
const HOUDINI_DOCS_ROOT = 'C:/Users/You/Documents'

function dimSeed() {
  const dazAppData = `${DIM_ROAMING}/DAZ 3D`
  const seed = buildSeed()
  seed.roamingDir = DIM_ROAMING
  seed.documentDir = HOUDINI_DOCS_ROOT
  seed.houdiniInstalls = [
    { version: '20.5.0.864', path: H20_DIR },
    { version: '22.0.0.368', path: H22_DIR },
  ]
  seed.files[`${H22_DIR}/bin/hython.exe`] = 'hython22'
  seed.files[`${H20_DIR}/bin/hython.exe`] = 'hython20'
  seed.files[`${HOUDINI_DOCS_ROOT}/houdini22.0/houdini.env`] = 'env22'
  seed.files[`${HOUDINI_DOCS_ROOT}/houdini20.5/houdini.env`] = 'env20'
  seed.files[`${dazAppData}/dzInstall.ini`] =
    `[General]\nInstalledApplications=dzStudio6InstallDir-64 dzStudio4InstallDir-64\n\n` +
    `[ApplicationPath]\ndzStudio6InstallDir-64=${DS6_DIR}\ndzStudio4InstallDir-64=${DS4_DIR}\n`
  seed.files[`${dazAppData}/InstallManager/Settings/AppSettings.ini`] =
    '[General]\nCurrentUser=Account\n'
  seed.files[`${dazAppData}/InstallManager/UserAccounts/Account.ini`] =
    `[General]\nCurInstallPath=${DAZ_LIBRARY}\nOverrideManifestDir=${DIM_MANIFESTS}\n` +
    'DownloadPath=D:/DAZ 3D/Install Manager/Downloads\n'
  seed.files[`${DS6_DIR}/DAZStudio.exe`] = 'ds6'
  seed.files[`${DS4_DIR}/DAZStudio.exe`] = 'ds4'
  seed.files[`${DAZ_LIBRARY}/readme.txt`] = 'library'
  seed.files[`${DIM_MANIFESTS}/IM00012345_1_Product.dsx`] = '<dsx/>'
  return seed
}

/** Settings → General with DAZ Studio 6 activated — the state the guide's
 *  setup page describes, and the one most machines land in. */
async function openDazSettings(page: Page) {
  await prime(page, dimSeed())
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /DAZ Studio 6/ }).click()
  await page.getByText('Paths from this installation').waitFor()
}

test('settings-daz-install', async ({ page }) => {
  await openDazSettings(page)
  await shoot(page, join(OUT, 'settings-daz-install.png'), card(page, 'Daz installation'))
})

test('settings-houdini-install', async ({ page }) => {
  await openDazSettings(page)
  // Activated too, so the shot shows the pair it derives — the install folder
  // and the matching houdini<major>.<minor>, which is the whole point.
  await page.getByRole('button', { name: /Houdini 22\.0\.368/ }).click()
  await card(page, 'Houdini installation').getByText('Paths from this installation').waitFor()
  await shoot(page, join(OUT, 'settings-houdini-install.png'), card(page, 'Houdini installation'))
})

/** Both detections in one frame, each with a card ACTIVATED — the state the
 *  setup page's opening describes. The two separate shots below/above show each
 *  section's detail; this one exists to show that Settings → General *opens*
 *  with your machine already found, which is the point of the cards. */
test('settings-installations', async ({ page }) => {
  await openDazSettings(page)
  await page.getByRole('button', { name: /Houdini 22\.0\.368/ }).click()
  await card(page, 'Houdini installation').getByText('Paths from this installation').waitFor()
  await shootStrip(
    page,
    join(OUT, 'settings-installations.png'),
    card(page, 'Daz installation'),
    card(page, 'Houdini installation'),
  )
})

test('settings-dth-release', async ({ page }) => {
  // Shot with an installation ACTIVE: the library path is derived from it, so
  // this section carries no path field of its own — which is what the guide's
  // step 2 now describes.
  await openDazSettings(page)
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
async function shootTopThrough(page: Page, path: string, endFeature: Locator, still = false) {
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
    ...(still ? STILL : {}),
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

test('character-scripts-section', async ({ page }) => {
  await openCharacter(page)
  // "Daz scripts generated": the install-location chip and the read-only
  // Export directory sub-section (the standalone Export directory panel folded
  // in here once the directory became derived). Purely informational since
  // v38 — the two export switches it used to carry are gone.
  await shoot(page, join(OUT, 'character-scripts-section.png'), card(page, 'Daz scripts generated'))
})

test('houdini-generate-dialog', async ({ page }) => {
  // TWO scenes, so the dialog shows its "Daz scene to import" picker — the shot
  // is what the guide points at when it explains generating one project per
  // scene. (A single-scene character has nothing to pick and isn't asked.)
  await openCharacter(page, { extraScene: true })
  // The demo character carries the new-character export setup (seeded export
  // dir + `<Project>_<Character>` project folder), so Generate project is
  // available; the dialog opens prefilled with the same default name.
  await page.getByRole('button', { name: 'Generate project' }).click()
  const dialog = page.getByRole('dialog')
  // The CHARACTER's name, not `<Project>_<Character>`: a generated scene already
  // lives inside its project's folder, so repeating the project there only made
  // the filename longer.
  await expect(dialog.getByLabel('Project name')).toHaveValue('Kira')
  await expect(dialog.getByLabel('Daz scene to import')).toBeVisible()
  await shoot(page, join(OUT, 'houdini-generate-dialog.png'), dialog)
})

// ── The Utils drawer (Houdini material / skeleton transfer) ──────────────────
// The drawer's scan runs hython, which this fake never starts: `materialScan`
// seeds what a scan of each `.hip` finds (tauri-mock's
// `run_houdini_material_util` answers from it), and the two settings below are
// exactly what api/houdini-material.ts requires before it will scan at all —
// a Houdini installation folder plus its VERSION-MATCHED documents folder.
const HOUDINI_INSTALL = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const HOUDINI_DOCS = 'C:/Users/You/Documents/houdini22.0'
/** The project the drawer copies FROM — browsed for, so it needs no character
 *  of its own (the fixture world has exactly one). */
const SOURCE_HIP = 'D:/DTH Projects/Demo/Ita/houdini/Ita.hiplc'

/** A material slot's surface claims, in the shape the node stores them —
 *  `material_group#` is a space-separated list of group expressions, and the
 *  drawer counts and merges by those. */
const surfaces = (names: Array<string>): Array<string> =>
  names.map((name) => `@fbx_material_name=${name}`)

/** The 15 Daz surfaces a Genesis 9 skin merges — measured on a real project,
 *  and the number the guide quotes beside this screenshot. */
const G9_SKIN_SURFACES = [
  'Body', 'Fingernails', 'Toenails', 'Legs', 'MouthCavity', 'Arms', 'Head',
  'GPTorso', 'GPVagina', 'GPLabiaMinora', 'GPUrethra', 'GPRectum', 'GPTorsoBack',
  'Mouth', 'Teeth',
]

/** The source node: a dressed character's finished material setup. The slot
 *  numbers are the ones docs/guide/06-into-houdini.md quotes, so the shot and
 *  the prose beside it can't drift apart. */
const SOURCE_NODE = {
  path: '/obj/DazToHue/DazToHueMaterial',
  name: 'DazToHueMaterial',
  nodeType: 'material',
  networkBox: 'ItaDefault',
  materials: 4,
  uvChannels: 3,
  bakers: 11,
  layers: 43,
  bakerNames: ['T_Skin_Colour', 'T_Skin_Normal'],
  materialNames: ['MI_Skin', 'Skin'],
  slots: [
    { name: 'Skin', displayName: 'MI_Skin', surfaces: surfaces(G9_SKIN_SURFACES), bakers: 4, layers: 30, channelUvs: ['uv_geoshell'] },
    { name: 'Dress', displayName: 'MI_Dress', surfaces: surfaces(['Dress']), bakers: 4, layers: 4, channelUvs: [] },
    { name: 'YogaPants', displayName: 'MI_YogaPants', surfaces: surfaces(['Trousers', 'Waist']), bakers: 2, layers: 2, channelUvs: [] },
    { name: 'HighBoots', displayName: 'MI_HighBoots', surfaces: surfaces(['Eyelets', 'Lace', 'Inside', 'BaseLeather', 'Overlays', 'SoleBase', 'SoleBottom']), bakers: 1, layers: 7, channelUvs: [] },
  ],
  sectionCounts: [],
}

/** The target node — the demo character's own project: a DTH network that is
 *  set up but has no bakers yet, which is what you open the drawer to fix. */
const TARGET_NODE = {
  path: '/obj/DazToHue/DazToHueMaterial',
  name: 'DazToHueMaterial',
  nodeType: 'material',
  networkBox: 'KiraDefault',
  materials: 2,
  uvChannels: 0,
  bakers: 0,
  layers: 0,
  bakerNames: [],
  materialNames: ['MI_Skin', 'Skin'],
  slots: [],
  sectionCounts: [],
}

/** Open the demo character's Utils drawer, scanned and ready. It opens on
 *  General; the transfer shots switch tab themselves.
 *
 *  `staleJob` gives the project the pre-v0.64 `$JOB` (the shared
 *  `houdini/houdini-project` folder, below the exports) so the General tab has
 *  the case it exists for: one check that differs, the rest passing. */
async function openUtilsDrawer(page: Page, staleJob = false): Promise<Locator> {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dialogPath: SOURCE_HIP })
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI_INSTALL,
    houdiniDocsFolder: HOUDINI_DOCS,
  })
  seed.files[`${HOUDINI_INSTALL}/bin/hython.exe`] = 'hython-exe-fixture'
  seed.files[SOURCE_HIP] = 'hip-fixture'
  seed.materialScan = { [P.houdini]: [TARGET_NODE], [SOURCE_HIP]: [SOURCE_NODE] }
  if (staleJob) seed.materialJob = { [P.houdini]: `${P.charFolder}/houdini/houdini-project` }
  await prime(page, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()
  await page.getByRole('button', { name: /^Utils/ }).click()
  return page.getByRole('dialog')
}

/** …and on the Material tab with a source picked — the state both transfer
 *  shots document. */
async function openMaterialTab(page: Page): Promise<Locator> {
  const drawer = await openUtilsDrawer(page)
  await drawer.getByRole('tab', { name: 'Material' }).click()
  // The open-scan landed once the character's own node is listed as a target
  // (opening from the card also preselects it).
  await drawer.getByRole('checkbox', { name: 'KiraDefault' }).waitFor()
  // Browse… returns the seeded pick, which scans that one file as the source.
  await drawer.getByRole('button', { name: 'Browse…' }).click()
  await drawer.getByRole('radio', { name: 'ItaDefault' }).click()
  return drawer
}

test('houdini-utils-general', async ({ page }) => {
  const drawer = await openUtilsDrawer(page, true)
  // The scan landed once the project card carries its verdicts.
  await drawer.getByText('Project folder ($JOB)').waitFor()
  await shoot(page, join(OUT, 'houdini-utils-general.png'), drawer)
})

test('houdini-utils-drawer', async ({ page }) => {
  const drawer = await openMaterialTab(page)
  await shoot(page, join(OUT, 'houdini-utils-drawer.png'), drawer)
})

test('houdini-utils-materials', async ({ page }) => {
  const drawer = await openMaterialTab(page)
  // The Materials list — the slot-by-slot cost of the source setup. The drawer
  // scrolls its OWN body, so bring the section up before framing it (`shoot`
  // deliberately doesn't scroll a fixed-overlay feature).
  const materials = drawer.locator('section').filter({ hasText: 'needs UV channels' })
  await materials.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await shoot(page, join(OUT, 'houdini-utils-materials.png'), materials)
})

test('houdini-utils-recent-sources', async ({ page }) => {
  const drawer = await openMaterialTab(page)
  // The Browse… pick `openMaterialTab` already made IS what seeds the row: a
  // source is remembered the moment it lands, and the row re-reads itself — so
  // the chip is there without a second trip through the drawer.
  const source = drawer.locator('section').filter({ hasText: 'Recently used' })
  await source.getByText('Recently used').waitFor()
  await source.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await shoot(page, join(OUT, 'houdini-utils-recent-sources.png'), source)
})

test('dth-export-panel', async ({ page }) => {
  // A configured Daz install folder lets the panel's Runner-update check
  // settle open (the fake holds no readable install, and an unreadable Runner
  // state deliberately never blocks exporting).
  await openCharacter(page, { dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio6' })
  await page.getByRole('button', { name: 'DTH Export' }).click()
  const panel = page.getByRole('dialog')
  // One page now: Daz scenes + their Mode, Houdini projects + theirs. Wait for
  // the affected-detection to settle — the never-exported scene reads
  // "changed", which is what the full run pre-checks (and what auto-selects
  // the Houdini projects).
  await panel.getByText('Changed since the last export').waitFor()
  await shoot(page, join(OUT, 'dth-export-panel.png'), panel)
})

test('dth-export-running', async ({ page }) => {
  // The header's LIVE pipeline display (guide: "Watching the run"). Neither the
  // Runner plugin nor Houdini exists in the fake, so the run is staged the way
  // houdini-export.smoke.ts stages it — by writing exactly the files they
  // write. TWO scenes deliberately: a multi-unit leg is what puts the second
  // (overall) meter on screen, and it gives the card column something to be.
  const SCRIPTS_ROOT = `${P.dazLib}/Scripts/DTH-Character-Studio`
  const seed = buildSeed({
    demo: true,
    extraScene: true,
    activeProjectFile: P.dcsp,
    dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio6',
  })
  // The batch runs the HIDDEN bulk script — a missing one is refused up front,
  // before any job file is written.
  seed.files[`${SCRIPTS_ROOT}/Demo/Kira/.Bulk_ROM_Export.dsa`] = '// bulk-export fixture'
  await prime(page, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await page.getByText(/custom ROM frames/).waitFor()

  await page.getByRole('button', { name: 'DTH Export' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Changed since the last export').first().waitFor()
  // Both scenes and the linked Houdini project: three cards, in run order.
  await dialog.getByRole('checkbox', { name: /Export KiraDefault/ }).check()
  await dialog.getByRole('checkbox', { name: /Export KiraSummertide/ }).check()
  await dialog.getByRole('checkbox', { name: /Run in Kira/ }).check()
  await page.getByRole('button', { name: 'Start' }).click()

  const pendingJob = `${SCRIPTS_ROOT}/dth_exporter_jobs.json`
  const runningJob = `${SCRIPTS_ROOT}/running_dth_exporter_jobs.json`
  await expect
    .poll(() =>
      page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, pendingJob),
    )
    .toBe(true)

  // Stand in for the Runner mid-batch: it claims the job file (the `running_`
  // prefix IS the claim) and appends the per-step lines to the progress log.
  // The last line is a step it just STARTED — which is what the display is for.
  await page.evaluate(
    ([pending, running, progressPath]) => {
      const mock = (window as any).__tauriMock
      // A sub-100 running file with no Daz alive reads as a DEAD run.
      mock.dazRunning = true
      const files = mock.files as Map<string, string>
      const job = JSON.parse(files.get(pending) ?? '{}')
      files.delete(pending)
      files.set(
        running,
        JSON.stringify({
          ...job,
          progress: 20,
          jobsDone: 0,
          jobs: job.jobs.map((row: Record<string, unknown>, index: number) =>
            Object.assign({}, row, { status: index === 0 ? 'running' : 'pending' }),
          ),
        }),
      )
      files.set(
        progressPath,
        [
          '[0] KiraDefault_G9_GP: opening scene',
          '[20] KiraDefault_G9_GP: scene opened',
          '[20] KiraDefault_G9_GP: generating ROM',
          '[40] KiraDefault_G9_GP: ROM generated',
          '[40] KiraDefault_G9_GP: exporting character',
          '',
        ].join('\n'),
      )
    },
    [pendingJob, runningJob, `${P.appData}/export-progress.log`],
  )
  // Wait for the poll to have digested all of it: the status line on the newest
  // message, and the bar off 0 (a run visibly under way is the shot's point).
  await expect(page.locator('[data-export-status]')).toHaveText('Exporting character', {
    timeout: 15_000,
  })
  await expect(page.locator('[data-progressbar="run"]')).not.toHaveAttribute('data-percent', '0')
  // Close the "Started Daz Studio" toast the way a user would — it sits over
  // the task list, which is the whole subject of this shot.
  const toast = page.locator('[data-sonner-toast]')
  await toast.first().locator('[data-close-button]').click()
  await expect(toast).toHaveCount(0)
  // Age the run. `startedAtMs` was stamped `Date.now()` at Start, and the clock
  // is PINNED (fixtures.ts) — so the Working button read `00:00` beside a bar
  // at 13% and a scene already exporting, which is a state the real app cannot
  // be in. Moving the pinned "now" forward is the honest lever: the run really
  // did start 3m12s of app-time ago. Timers are not faked by setFixedTime, so
  // ElapsedSince's 1s tick still repaints it.
  await page.clock.setFixedTime(new Date(FIXED_TIME.getTime() + 192_000))
  await expect(page.getByRole('button', { name: /Working/ })).toContainText('03:12')
  // `still`: the Working button spins, and a running animation would land on a
  // different frame every regeneration.
  await shootTopThrough(
    page,
    join(OUT, 'dth-export-running.png'),
    page.getByRole('tab', { name: 'Character' }),
    true,
  )
})

test('character-advanced-options', async ({ page }) => {
  await openCharacter(page)
  // "Advanced options" is a plain always-open section now (morphs on frame 0 +
  // preserve node transforms) — no longer a collapsible <details>. Frame just its
  // card (title → last field) so the shot leads with the "Advanced options" heading.
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
  // The full accordion-button name ("GEN Genitalia") — a bare /Genitalia/ also
  // matches the section title's "i" popup trigger now.
  await page.getByRole('button', { name: 'GEN Genitalia' }).click()
  await page.getByText('VaginaOpen').click()
  const gen = page
    .getByRole('button', { name: 'GEN Genitalia' })
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
  // The card's SELECT cover button, clicked over the avatar strip — the visible
  // title is the inline-RENAME button now, and the card's center holds the
  // z-10 path chip; both sit above the cover and would swallow the click.
  await page
    .getByRole('button', { name: 'KiraSummertide_G9_GP', exact: true })
    .click({ position: { x: 40, y: 52 } })
}

test('character-daz-scenes', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  // The Daz scenes block: both cards (outfit selected) with the per-scene
  // column (hair items, FACS/flexion, tear UV) beside them. `#daz-scenes` — the
  // title Label carries an InfoPopup, so an exact text match would skip it and
  // land on the docked scene bar's label instead. Bottom: the panel's "Add
  // scene" button (the docked bar's twin is aria-hidden while the cards are on
  // screen, so the role query sees only this one).
  await shootStrip(
    page,
    join(OUT, 'character-daz-scenes.png'),
    page.locator('#daz-scenes'),
    page.getByRole('button', { name: 'Add scene', exact: true }),
  )
})

test('character-scene-footer', async ({ page }) => {
  await openCharacterOnOutfitScene(page)
  // The docked scene bar keeps the selected scene on screen once the Daz-scene cards
  // scroll out of view. Bring the ROM section to the top (so the cards above it leave
  // the viewport and the bar slides up), then grab the whole viewport — the bar docked
  // at the bottom WITH the page content above it for context, not a lone strip.
  await page.setViewportSize({ width: VW, height: MAX_H })
  await settle(page)
  await card(page, 'ROM').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  const footer = page.locator('div.fixed.inset-x-0.bottom-0').last()
  await expect(footer).toHaveAttribute('aria-hidden', 'false')
  await page.mouse.move(0, 0)
  await settle(page)
  await page.screenshot({ path: join(OUT, 'character-scene-footer.png') })
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
    projectRow(page, 'Show the Daz Products tab'),
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
  // The picker returns a FRESH scene — NOT one of Kira's linked ones: the
  // duplicate-scene guard flags those "already linked to Kira", and the docs
  // shot must show a clean create with every check green. KiraSummertide's
  // files exist here WITHOUT being linked (no extraScene), and its read
  // carries the GP geograft so the Gender badge reads ♀ — the documented
  // scene derivation, not the mock's Unknown fallback.
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp, dialogPath: P.scene2 })
  seed.files[P.scene2] = 'duf-fixture'
  seed.files[`${P.scene2}.tip.png`] = seed.files[`${P.scene}.tip.png`]
  seed.sceneWearables = {
    ...(seed.sceneWearables ?? {}),
    [P.scene2]: [{ id: 'GoldenPalace_G9', label: 'Golden Palace', conformTarget: '#Genesis9' }],
  }
  await prime(page, seed)
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).waitFor()
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

/** A two-Studio machine, which is the whole point of the Daz-plugins panel: one
 *  release folder holding a build per generation, installed into every Daz
 *  found — with an update pending on the DS6 exporter. Shared by the panel shot
 *  and the needs-admin failure shot. */
function dazPluginsSeed() {
  const roaming = 'C:/Users/You/AppData/Roaming'
  const dazAppData = `${roaming}/DAZ 3D`
  const ds4 = 'C:/Program Files/DAZ 3D/DAZStudio4'
  const ds6 = 'C:/Program Files/DAZ 3D/DAZStudio6'
  const resources = 'C:/Program Files/DTH Character Studio'
  const exporter = 'X:/DazToHue/ExporterPlugin'
  const seed = buildSeed({ dazInstallFolder: ds6 })
  seed.roamingDir = roaming
  seed.resourceDir = resources
  seed.files[`${dazAppData}/dzInstall.ini`] = [
    '[General]',
    'InstalledApplications=dzStudio6InstallDir-64 dzStudio4InstallDir-64',
    '',
    '[ApplicationPath]',
    `dzStudio6InstallDir-64=${ds6}`,
    `dzStudio4InstallDir-64=${ds4}`,
    '',
  ].join('\n')
  seed.files[`${ds6}/DAZStudio.exe`] = fakeDll('6.0.1.0')
  seed.files[`${ds4}/DAZStudio.exe`] = fakeDll('4.22.0.16')
  seed.files[`${resources}/resources/dth-runner/version.txt`] = '1.1.4'
  seed.files[`${resources}/resources/dth-runner/ds4/dthcharacterstudiorunner.dll`] = fakeDll('1.1.4.0')
  seed.files[`${resources}/resources/dth-runner/ds6/dsp_dthcharacterstudiorunner.dll`] = fakeDll('1.1.4.0')
  seed.files[`${exporter}/Daz Studio 4/dth_exporter.dll`] = fakeDll('2.0.2.0')
  seed.files[`${exporter}/Daz Studio 4/dth_tools.dll`] = 'companion'
  seed.files[`${exporter}/Daz Studio 6/dsp_dth_exporter.dll`] = fakeDll('2.0.2.0')
  seed.files[`${ds6}/plugins/dsp_dth_exporter.dll`] = fakeDll('2.0.1.0')
  seed.files[`${ds6}/plugins/dsp_dthcharacterstudiorunner.dll`] = fakeDll('1.1.4.0')
  const settingsPath = `${P.appData}/settings.json`
  seed.files[settingsPath] = JSON.stringify({
    ...JSON.parse(seed.files[settingsPath] ?? '{}'),
    dazInstallFolder: ds6,
    dazInstallKey: 'dzstudio6installdir-64',
    dthExporterFolders: [exporter],
  })
  return seed
}

/** Land on Settings with the Daz-plugins scan finished (never an empty table). */
async function openDazPlugins(page: Page, seed: ReturnType<typeof dazPluginsSeed>) {
  await prime(page, seed)
  await page.goto('/')
  await page.getByRole('heading', { name: 'DTH Character Studio' }).waitFor()
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'Daz Studio plugins' }).waitFor()
  await page.getByText('pending').first().waitFor()
}

test('settings-daz-plugins', async ({ page }) => {
  await openDazPlugins(page, dazPluginsSeed())
  await shoot(page, join(OUT, 'settings-daz-plugins.png'), card(page, 'Daz Studio plugins'))
})

test('settings-daz-plugins-admin', async ({ page }) => {
  // The needs-admin state: a copy into Program Files refused, the panel
  // explaining the one-shot elevated retry. The detail is report.rs's real
  // wording (pinned by a Rust test; also mirrored in the plugin-install smoke).
  const seed = dazPluginsSeed()
  seed.pluginInstallFailure = String.raw`couldn't write C:\Program Files\DAZ 3D\DAZStudio6\plugins\dsp_dth_exporter.dll: Access is denied. (os error 5) — this needs administrator rights — use "Install with administrator rights"`
  await openDazPlugins(page, seed)
  await page.getByRole('button', { name: /Install \/ update all/ }).click()
  const elevate = page.getByRole('button', { name: 'Install with administrator rights' })
  await elevate.waitFor()
  // Frame the failure box itself (explainer + button): the full card grew past
  // the height cap with the report rows, and a top-aligned crop would cut off
  // exactly this region at the card's bottom.
  const failureBox = card(page, 'Daz Studio plugins')
    .locator('div')
    .filter({ hasText: 'needs administrator' })
    .filter({ has: elevate })
    .last()
  await shoot(page, join(OUT, 'settings-daz-plugins-admin.png'), failureBox)
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
  // A clip also ships `<name>.poster.webp` (its first frame, written by
  // webp-recorder.ts and shown by the built site until the reader presses play).
  // The poster is referenced exactly when its clip is, so derive it rather than
  // skip it — same rule as the build's guard in scripts/build-guide-site.mjs.
  const clipsOnDisk = (await readdir(join(guideDir, 'clips')).catch(() => [] as string[])).filter((f) =>
    f.endsWith('.webp'),
  )
  for (const clip of [...referencedClips]) referencedClips.add(clip.replace(/\.webp$/, '.poster.webp'))
  const missingClips = [...referencedClips].filter((f) => !clipsOnDisk.includes(f)).sort()
  const orphanClips = clipsOnDisk.filter((f) => !referencedClips.has(f)).sort()
  expect(missingClips, `referenced in docs/guide but missing from clips/: ${missingClips.join(', ')}`).toEqual([])
  expect(orphanClips, `in clips/ but referenced by no guide page: ${orphanClips.join(', ')}`).toEqual([])
})
