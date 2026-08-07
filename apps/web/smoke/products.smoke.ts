import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

const fileExists = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__tauriMock.files.has(p) as boolean, path)
const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

/** Where the Daz product scan drops its per-scene CSV (app data, transport only). */
const DROP_CSV = `${P.appData}/product-scans/proj-smoke/char-kira/KiraDefault_G9_GP.csv`
/** Where the studio files the results (per character, in the project's meta folder). */
const STORE = `${P.charMeta}/products.json`

// The unattended pickup, through the REAL app: opening the character runs the
// route loader, which parses whatever Daz left in the drop folder into the
// store and deletes the CSV it consumed. There is no button in this flow — that
// is the point of it, and it is why the CSV disappearing has to be pinned.
test('project window: opening a character files the Daz product scan and consumes the CSV', async ({
  page,
}) => {
  await page.addInitScript(
    installTauriMock,
    buildSeed({
      activeProjectFile: P.dcsp,
      demo: true,
      productScan: true,
      dazProductsEnabled: true,
      dimManifestsFolder: 'D:/DAZ 3D/Install Manager/ManifestFiles',
    }),
  )
  await page.goto('/')

  // Before the visit: the transport is there, nothing is stored.
  expect(await fileExists(page, DROP_CSV)).toBe(true)
  expect(await fileExists(page, STORE)).toBe(false)

  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
  await page.getByRole('tab', { name: 'Products' }).click()

  // The results are on screen without anything having been confirmed — no
  // "Store on character", no found-vs-stored banner.
  await expect(page.getByRole('heading', { name: 'Matched products' })).toBeVisible()
  await expect(page.getByText('Golden Palace 9')).toBeVisible()
  await expect(page.getByRole('button', { name: /Store on character/ })).toHaveCount(0)

  // Filed under the character in the project's meta folder…
  const stored = JSON.parse((await fileContent(page, STORE))!)
  expect(stored.scans).toHaveLength(1)
  expect(stored.scans[0].sceneName).toBe('KiraDefault_G9_GP')
  expect(stored.scans[0].products.length).toBeGreaterThan(0)
  // …and the CSV is gone, but only because its contents got there first.
  expect(await fileExists(page, DROP_CSV)).toBe(false)

  // Nothing lands on the definition any more (schema v30 dropped those fields).
  const definition = JSON.parse((await fileContent(page, `${P.charFolder}/Kira.json`))!)
  expect(definition.products).toBeUndefined()
  expect(definition.productsScannedAt).toBeUndefined()

  expect(await unhandledCommands(page)).toEqual([])
})

// The tab toggle is a VIEW switch now: with it off the scan still runs and the
// results are still filed — only the tab is missing. Turning it on later must
// therefore show data that was collected while nobody was looking.
test('project window: with the Products tab off, the scan is still picked up', async ({ page }) => {
  await page.addInitScript(
    installTauriMock,
    buildSeed({
      activeProjectFile: P.dcsp,
      demo: true,
      productScan: true,
      dazProductsEnabled: false,
      dimManifestsFolder: 'D:/DAZ 3D/Install Manager/ManifestFiles',
    }),
  )
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()

  // No tab to click…
  await expect(page.getByRole('tab', { name: 'Products' })).toHaveCount(0)
  // …but the pickup ran all the same.
  expect(await fileExists(page, STORE)).toBe(true)
  expect(await fileExists(page, DROP_CSV)).toBe(false)

  expect(await unhandledCommands(page)).toEqual([])
})
