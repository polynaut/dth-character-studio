import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The scene-less character journey: create WITHOUT a Daz scene (the folder is
// seeded so the user can save their scene into it from Daz Studio), the locked
// character editor, and the first primary link that unlocks it and completes
// the scene-driven derivation (gender / GEN) creation couldn't do.

const fileContent = (page: Page, path: string) =>
  page.evaluate((p) => ((window as any).__tauriMock.files.get(p) ?? null) as string | null, path)
const commandCalls = (page: Page, cmd: string) =>
  page.evaluate(
    (c) =>
      (window as any).__tauriMock.calls
        .filter((call: { cmd: string }) => call.cmd === c)
        .map((call: { args: unknown }) => call.args) as Array<unknown>,
    cmd,
  )
const unhandledCommands = (page: Page) =>
  page.evaluate(() => (window as any).__tauriMock.unhandled as Array<string>)

// The scene the user "saved from Daz Studio" into the seeded folder after the
// create — a Dicktator scene, so the first link provably re-derives gender
// (the sceneless create defaulted to female) and enables GEN.
const VERA_SCENE = 'D:/DTH Projects/Demo/Vera/daz3d/Vera_G9_DK.duf'

test('sceneless create: seeded folder, locked editor, first link unlocks + derives', async ({
  page,
}) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp })
  // The native picker returns the scene once it "exists". NOT pre-seeded into
  // the fs: a file under Vera/ would make the folder pre-exist and the create
  // would dedupe to "Vera (2)" — the scene lands mid-test, like the real save.
  seed.dialogPath = VERA_SCENE
  seed.sceneFigure = { id: 'Genesis9', label: 'Vera' }
  seed.sceneWearables = {
    ...(seed.sceneWearables ?? {}),
    [VERA_SCENE]: [{ id: 'DK_Base', label: 'Dicktator 9', conformTarget: 'Genesis9' }],
  }
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')

  // ── Create with NO scene: just a name; the footer offers exactly that. ──
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Character name').fill('Vera')
  await page.getByRole('button', { name: 'Create without scene' }).click()
  await expect(page.getByText(/Created “Vera”/)).toBeVisible()

  // ── The editor landed LOCKED: banner, inert sections, Fill disabled. ──
  await expect(page.getByText(/the editor is locked/)).toBeVisible()
  expect(await page.locator('[data-scene-lock]').count()).toBeGreaterThan(0)
  // The ROM editor sits inside a lock wrapper — inert, not interactable.
  await expect(
    page.locator('[data-scene-lock]').getByRole('button', { name: /Retargeting/ }),
  ).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Fill from character' })).toBeDisabled()

  // The scenes panel is the one live control: it names the seeded folder the
  // user should save their scene into (created on disk at create time).
  await expect(page.getByText('D:/DTH Projects/Demo/Vera/daz3d')).toBeVisible()
  const mkdirs = (await commandCalls(page, 'plugin:fs|mkdir')).map((a) =>
    ((a as { path?: string }).path ?? '').replaceAll('\\', '/'),
  )
  expect(mkdirs.some((p) => p.endsWith('Demo/Vera/daz3d'))).toBe(true)

  // ── "Save" the scene from Daz Studio into the seeded folder, then link. ──
  await page.evaluate(
    (p) => void (window as any).__tauriMock.files.set(p, 'duf-fixture'),
    VERA_SCENE,
  )
  await page.getByRole('button', { name: 'Link Daz scene' }).click()
  await expect(page.getByText('Linked Daz scene')).toBeVisible()
  await expect(page.getByText(/Genitalia section enabled/)).toBeVisible()
  await expect(page.locator('[data-scene-lock]')).toHaveCount(0)
  // Subtitle gender prefix flipped to ♂ — the DK geograft decided it.
  await expect(page.getByText('♂ G9 · DQS · 0 custom ROM frames')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fill from character' })).toBeEnabled()

  // The persisted definition records the link + the derivation.
  const json = JSON.parse((await fileContent(page, `${P.project}/Vera/Vera.json`))!) as {
    scenePath: string
    gender: string
    sections: { GEN: { enabled: boolean } }
  }
  expect(json.scenePath).toBe(VERA_SCENE)
  expect(json.gender).toBe('male')
  expect(json.sections.GEN.enabled).toBe(true)

  expect(await unhandledCommands(page)).toEqual([])
})
