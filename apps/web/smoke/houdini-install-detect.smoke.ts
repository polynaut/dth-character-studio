import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// Settings → Houdini installation: the twin of the Daz one. SideFX registers
// every install, so the studio reads them instead of asking — and pairs each
// with its own `houdini<major>.<minor>` preferences folder, which is the part
// that matters: hython gets that folder as HOUDINI_USER_PREF_DIR, and pointed
// at another version's it loads the wrong DazToHue assets, or none.
//
// The registry read itself is native and has no stand-in here; the fake states
// what the machine has. What this spec proves is the studio's half — the
// pairing, the recommendation, and that activating writes both paths at once.

const H22 = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const H20 = 'C:/Program Files/Side Effects Software/Houdini 20.5.864'
// Deliberately NOT under the home directory: a redirected Documents folder is
// the case that broke naive detection, and it is this machine's real layout.
const DOCS = 'D:/User Data/Documents'
const HOME = 'C:/Users/dev'
const SETTINGS = `${P.appData}/settings.json`

/** A machine with two Houdinis, a redirected Documents, and a leftover prefs
 *  folder from a version that is no longer installed. */
function houdiniSeed() {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  seed.documentDir = DOCS
  seed.homeDir = HOME
  seed.houdiniInstalls = [
    // Registry order — oldest first, so the card order proves the sort.
    { version: '20.5.0.864', path: H20 },
    { version: '22.0.0.368', path: H22 },
  ]
  seed.files[`${H22}/bin/hython.exe`] = 'hython22'
  seed.files[`${H20}/bin/hython.exe`] = 'hython20'
  seed.files[`${DOCS}/houdini22.0/houdini.env`] = 'env22'
  seed.files[`${DOCS}/houdini20.5/houdini.env`] = 'env20'
  // No Houdini 21 install — this is the trace of an uninstalled one.
  seed.files[`${DOCS}/houdini21.0/houdini.env`] = 'env21'
  return seed
}

async function savedSettings(page: Page): Promise<Record<string, unknown>> {
  const raw = await page.evaluate(
    (p) => ((window as any).__tauriMock.files.get(p) ?? '{}') as string,
    SETTINGS,
  )
  return JSON.parse(raw) as Record<string, unknown>
}

async function openHoudiniSettings(page: Page, seed: ReturnType<typeof houdiniSeed>) {
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  // By role: "Houdini installation" also matches the folder field's label.
  await expect(page.getByRole('heading', { name: 'Houdini installation' })).toBeVisible()
}

test('lists both Houdinis, newest first and recommended', async ({ page }) => {
  await openHoudiniSettings(page, houdiniSeed())

  await expect(page.getByRole('button', { name: /Houdini 22\.0\.368/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Houdini 20\.5\.864/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Houdini 22\.0\.368.*recommended/s })).toBeVisible()
  // The leftover prefs folder is named, not silently dropped.
  await expect(page.getByText(/no installed Houdini to match/)).toBeVisible()
  await expect(page.getByText(/houdini21\.0/)).toBeVisible()
})

test('activating pairs the install with its own prefs folder and saves both', async ({ page }) => {
  await openHoudiniSettings(page, houdiniSeed())

  await page.getByRole('button', { name: /Houdini 22\.0\.368/ }).click()
  await expect(page.getByText(/Houdini 22\.0\.368 activated/)).toBeVisible()

  await expect.poll(async () => (await savedSettings(page)).houdiniInstallKey).toBe('22.0.0.368')
  const saved = await savedSettings(page)
  expect(saved.houdiniInstallFolder).toBe(H22)
  // The 22.0 prefs folder, NOT 20.5 or the 21.0 leftover — the whole point.
  expect(saved.houdiniDocsFolder).toBe(`${DOCS}/houdini22.0`)

  // Both fields give way to their destinations, like the Daz half.
  await expect(page.getByLabel('Houdini installation folder (optional)')).toHaveCount(0)
  await expect(page.getByLabel('Houdini documents folder (optional)')).toHaveCount(0)
  // …and so does "add another folder": with a card driving the destination
  // there is ONE target, so a second hand-typed one would contradict it. The
  // line that replaces the button says where extra folders went.
  await expect(page.getByRole('button', { name: /Add another Houdini folder/ })).toHaveCount(0)
  await expect(page.getByText(/installs into the activated Houdini installation only/i)).toBeVisible()
})

test('activating the older Houdini re-pairs to its own prefs folder', async ({ page }) => {
  await openHoudiniSettings(page, houdiniSeed())

  await page.getByRole('button', { name: /Houdini 20\.5\.864/ }).click()
  await expect.poll(async () => (await savedSettings(page)).houdiniInstallFolder).toBe(H20)
  expect((await savedSettings(page)).houdiniDocsFolder).toBe(`${DOCS}/houdini20.5`)
})

test('an install with no prefs folder is offered, and says what is missing', async ({ page }) => {
  const seed = houdiniSeed()
  // Houdini 22 installed but never launched — its prefs folder doesn't exist.
  delete seed.files[`${DOCS}/houdini22.0/houdini.env`]
  await openHoudiniSettings(page, seed)

  await expect(page.getByText(/no .*houdini22\.0.* documents folder found/)).toBeVisible()
  // …so 20.5 is what gets recommended: hython with no prefs folder loads no
  // DazToHue otls at all, and recommending it would recommend the broken one.
  await expect(page.getByRole('button', { name: /Houdini 20\.5\.864.*recommended/s })).toBeVisible()
})

test('a machine with no Houdini says so and keeps the manual fields', async ({ page }) => {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  await openHoudiniSettings(page, seed)

  await expect(page.getByText(/No installed Houdini found/)).toBeVisible()
  await expect(page.getByLabel('Houdini documents folder (optional)')).toBeVisible()
  // The folders are the user's here, so adding another one still is too.
  await expect(page.getByRole('button', { name: /Add another Houdini folder/ })).toBeVisible()
})
