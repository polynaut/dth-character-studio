import { expect, test } from '@playwright/test'

import {
  CHARACTER_SCHEMA_VERSION,
  characterSchema,
} from '../../../packages/rom/src/types.ts'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

import type { Page } from '@playwright/test'

// The whole-character zip operations: EXPORT (Operations → Export, the toggle
// dialog, the folder pick, the pack request handed to Rust) and IMPORT
// (Operations → Import → the overwrite confirm → the staged restore with every
// stored path repointed to the new folder). The zip bytes themselves never
// exist here — the fake's `characterZipEntries` ARE the archive.

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

async function openKira(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: /Kira/ }).click()
  await expect(page.getByText(/custom ROM frames/)).toBeVisible()
}

test('export: toggle dialog → folder pick → the pack request Rust receives', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp, houdiniProject: true })
  // The native picker answers the FOLDER pick after the dialog's confirm.
  seed.dialogPath = 'D:/Backups'
  await page.addInitScript(installTauriMock, seed)
  await openKira(page)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Export “Kira”' })).toBeVisible()
  // Two switches, both OFF by default (the export trees are regenerable).
  const switches = page.getByRole('dialog').getByRole('switch')
  await expect(switches).toHaveCount(2)
  await expect(switches.nth(0)).not.toBeChecked()
  await expect(switches.nth(1)).not.toBeChecked()
  // Take the Daz exports along, leave the Houdini exports out.
  await switches.nth(0).click()

  await page.getByRole('button', { name: 'Export…' }).click()
  await expect(page.getByText(/Exported “Kira” \(7 files\)/)).toBeVisible()

  const [call] = (await commandCalls(page, 'export_character_zip')) as Array<{
    request: {
      zipPath: string
      manifestJson: string
      roots: Array<{ prefix: string; dir: string; excludeRel: Array<string>; excludeDirNames: Array<string> }>
    }
  }>
  expect(call.request.zipPath.replaceAll('\\', '/')).toMatch(
    /^D:\/Backups\/Kira_\d{4}-\d{2}-\d{2}\.dcsc\.zip$/,
  )
  const manifest = JSON.parse(call.request.manifestJson)
  expect(manifest.format).toBe('dcs-character')
  expect(manifest.characterId).toBe('char-kira')
  expect(manifest.sourceFolder).toBe(P.charFolder)
  expect(manifest.includes).toEqual({ dazExports: true, houdiniExports: false })
  const [charRoot, metaRoot] = call.request.roots
  expect(charRoot).toMatchObject({ prefix: 'character', dir: P.charFolder })
  // Daz exports ON → no name-pruned trees; Houdini exports OFF → the final
  // export folder is pruned by rel path, beside the always-pruned job transport.
  expect(charRoot.excludeDirNames).toEqual([])
  expect(charRoot.excludeRel).toContain('export')
  expect(charRoot.excludeRel).toContain('.dth_houdini_job.json')
  expect(metaRoot).toMatchObject({ prefix: 'meta', dir: P.charMeta })

  expect(await unhandledCommands(page)).toEqual([])
})

test('import: overwrite wizard → merge-restore with every stored path repointed', async ({ page }) => {
  const seed = buildSeed({ activeProjectFile: P.dcsp })
  const veraFolder = 'D:/Old Machine/Projects/Vera'
  const vera = characterSchema.parse({
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    id: 'char-vera',
    name: 'Vera',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: `${veraFolder}/daz3d/primary/Vera.duf`,
    image: 'char-vera--sc-1.png',
  })
  seed.characterZipManifest = JSON.stringify({
    format: 'dcs-character',
    formatVersion: 1,
    studioVersion: seed.version,
    exportedAt: '2026-08-01T10:00:00.000Z',
    characterId: 'char-vera',
    characterName: 'Vera',
    definitionFile: 'Vera.json',
    sourceFolder: veraFolder,
    sourceProjectName: 'Old Machine',
    includes: { dazExports: false, houdiniExports: false },
  })
  seed.characterZipEntries = {
    'character/Vera.json': JSON.stringify(vera),
    'character/Vera.notes.md': 'vera notes',
    'character/daz3d/primary/Vera.duf': 'duf-fixture',
    'meta/.dth_export_folders.json': JSON.stringify({
      version: 1,
      exportDir: `${veraFolder}/houdini/daz-export`,
      folders: ['primary'],
    }),
    'images/char-vera--sc-1.png': 'png-bytes',
  }
  // The native picker answers the zip pick.
  seed.dialogPath = 'D:/Downloads/Vera_2026-08-01.dcsc.zip'
  await page.addInitScript(installTauriMock, seed)
  await openKira(page)

  await page.getByRole('button', { name: 'Import', exact: true }).click()
  // The wizard: name pre-filled with the zip's, the primary scene locked in.
  await expect(page.getByRole('heading', { name: 'Import over “Kira”' })).toBeVisible()
  await expect(page.getByLabel('Character name')).toHaveValue('Vera')
  const primaryRow = page.getByRole('dialog').locator('label', { hasText: 'Vera.duf' })
  await expect(primaryRow).toContainText('primary')
  await expect(primaryRow.locator('input[type=checkbox]')).toBeDisabled()
  await expect(primaryRow.locator('input[type=checkbox]')).toBeChecked()
  await page.getByRole('button', { name: 'Import', exact: true }).click()

  await expect(page.getByText('Imported “Vera” over “Kira”')).toBeVisible()
  // The character ENTITY persists: same id, same route — the page remounts.
  await expect(page).toHaveURL(/char-kira/)

  // Kira's folder is gone; Vera's took its place — with the definition's stored
  // paths repointed from the export-time folder to the new one, and the id
  // staying the target's (the zip's avatar file re-keys with it).
  expect(await fileContent(page, `${P.project}/Kira/Kira.json`)).toBeNull()
  const imported = JSON.parse((await fileContent(page, `${P.project}/Vera/Vera.json`))!) as {
    id: string
    image: string
    scenePath: string
    projectPath: string
    exportPath: string
  }
  expect(imported.id).toBe('char-kira')
  expect(imported.image).toBe('char-kira--sc-1.png')
  expect(imported.scenePath).toBe(`${P.project}/Vera/daz3d/primary/Vera.duf`)
  expect(imported.projectPath).toBe(P.project)
  expect(imported.exportPath).toBe(`${P.project}/Vera/houdini/daz-export`)
  // The scene file itself was restored.
  expect(await fileContent(page, `${P.project}/Vera/daz3d/primary/Vera.duf`)).toBe('duf-fixture')
  // The meta record moved to the new folder key AND its exportDir repointed.
  const record = JSON.parse(
    (await fileContent(page, `${P.project}/.dcsmeta/characters/Vera/.dth_export_folders.json`))!,
  ) as { exportDir: string }
  expect(record.exportDir).toBe(`${P.project}/Vera/houdini/daz-export`)
  // The avatar bytes landed in the project's image store, re-keyed to the id.
  expect(await fileContent(page, `${P.project}/.dcsmeta/images/char-kira--sc-1.png`)).toBe(
    'png-bytes',
  )
  // The staging folder was cleaned up.
  const staging = await page.evaluate(
    () =>
      [...(window as any).__tauriMock.files.keys()].filter((k: string) =>
        k.includes('/.dcsmeta/import-'),
      ) as Array<string>,
  )
  expect(staging).toEqual([])

  expect(await unhandledCommands(page)).toEqual([])
})
