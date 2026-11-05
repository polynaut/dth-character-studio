import { expect, test, type Page } from '@playwright/test'

type Manifest = {
  screens: { module: string; id: string }[]
  demos: { module: string; export: string }[]
}

async function manifest(page: Page): Promise<Manifest> {
  await page.goto('/')
  await page.waitForSelector('html[data-ready]')
  return page.evaluate(() => (window as unknown as { __dsManifest: Manifest }).__dsManifest)
}

// Soft, so one run reports every broken frame instead of stopping at the first.
async function expectRenders(page: Page, url: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url)
  await page.waitForSelector('html[data-ready]')
  await expect.soft(page.locator('[data-screen-error]'), url).toHaveCount(0)
  const unhandled = await page.evaluate(
    () => (window as unknown as { __tauriMock?: { unhandled?: unknown[] } }).__tauriMock?.unhandled ?? [],
  )
  expect.soft(unhandled, url).toEqual([])
  expect.soft(errors, url).toEqual([])
}

const q = (params: Record<string, string>) => `/frame.html?${new URLSearchParams(params)}`

test('manifest is not empty', async ({ page }) => {
  const m = await manifest(page)
  expect(m.screens.length).toBeGreaterThan(0)
  expect(m.demos.length).toBeGreaterThan(0)
})

test('negative control: a failing frame is detected', async ({ page }) => {
  await page.goto('/frame.html?fail=1')
  await page.waitForSelector('html[data-ready]')
  await expect(page.locator('[data-screen-error]')).toHaveCount(1)
})

test('every screen and demo renders', async ({ page }) => {
  const m = await manifest(page)
  // One page, so the frames render one at a time.
  /* oxlint-disable no-await-in-loop */
  for (const s of m.screens) {
    await test.step(`screen ${s.module} ${s.id}`, async () => {
      await expectRenders(page, q({ module: s.module, screen: s.id }))
    })
  }
  for (const d of m.demos) {
    await test.step(`demo ${d.module} ${d.export}`, async () => {
      await expectRenders(page, q({ demo: d.module, export: d.export }))
    })
  }
})
