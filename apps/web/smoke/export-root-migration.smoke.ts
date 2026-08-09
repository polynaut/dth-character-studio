import { expect, test } from '@playwright/test'

import { P, buildSeed } from './fixtures.ts'
import { installTauriMock } from './tauri-mock.ts'

// The v0.69 export-root move, from the only angle that matters to somebody who
// already has a library: does **Tools → Refresh assets** carry it across?
//
// The migration itself lives on the character SAVE, which is fine for a
// character you open — and reaches nobody else. Refresh is what visits a whole
// library, so this is the ship path, and it is not the sort of thing a unit test
// can hold down: the bug it exists to prevent was the wiring being absent while
// every piece it wires worked. A `RUNTIME_VERSION` bump alone does NOT do it —
// the refresh clears a stale runtime by REGENERATING, and generation reads the
// stored `exportPath`, so without the relocation it would re-emit the old folder
// and stamp the new version over the very staleness that brought the user here.

/** Where this character's exports sat before v0.69. */
const OLD_ROOT = `${P.charFolder}/daz3d/dth-exports`
/** One already-exported scene folder under it, with a real payload. */
const OLD_DTH = `${OLD_ROOT}/primary/Kira.dth`
const NEW_DTH = `${P.exportDir}/primary/Kira.dth`
/** The studio's own record of which folders under the root are its to move. */
const RECORD = `${P.charMeta}/.dth_export_folders.json`

function seedPreMove() {
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  // A character as it stands on disk before the update: definition still naming
  // the old root, files still in it, and the record that says the studio wrote
  // them (nothing else is ever moved — see migrateExportRoot).
  const charPath = `${P.charFolder}/Kira.json`
  const char = JSON.parse(seed.files[charPath] ?? '{}')
  char.exportPath = OLD_ROOT
  seed.files[charPath] = JSON.stringify(char)
  seed.files[OLD_DTH] = 'dth-fixture'
  seed.files[`${OLD_ROOT}/primary/Kira.abc`] = 'abc-fixture'
  seed.files[RECORD] = JSON.stringify({ version: 1, exportDir: OLD_ROOT, folders: ['primary'] })
  return seed
}

test('Tools → Refresh assets moves an existing character onto the new export root', async ({
  page,
}) => {
  await page.addInitScript(installTauriMock, seedPreMove())
  await page.goto('/')

  await page.getByRole('link', { name: /Tools/ }).click()
  await page.getByRole('tab', { name: /Refresh assets/ }).click()
  await page.getByRole('button', { name: /^Refresh assets$/ }).click()

  const read = (path: string) =>
    page.evaluate(
      (p) => ((window as unknown as { __tauriMock: { files: Map<string, string> } }).__tauriMock.files.get(p) ?? '') as string,
      path,
    )

  // The FILES travelled — with their scene subfolder, not flattened onto the root.
  await expect.poll(() => read(NEW_DTH)).toBe('dth-fixture')
  expect(await read(OLD_DTH)).toBe('')
  expect(await read(`${P.exportDir}/primary/Kira.abc`)).toBe('abc-fixture')

  // …and the DEFINITION was repointed in the same pass. Either half alone is a
  // broken state: files at the new root with a definition naming the old one
  // sends the next export back to the vacated folder, and the reverse strands
  // the exports where nothing will look for them.
  const definition = JSON.parse((await read(`${P.charFolder}/Kira.json`)) || '{}')
  expect(definition.exportPath).toBe(P.exportDir)

  // The record described the OLD root. The migration drops it and the
  // generation in the same pass writes a fresh one for the layout that now
  // exists — so the housekeeping's delete is re-aimed rather than left pointing
  // at a tree that no longer exists.
  expect(JSON.parse((await read(RECORD)) || '{}')).toMatchObject({
    exportDir: P.exportDir,
    folders: ['primary'],
  })
})

test('a character already on the new root is left alone', async ({ page }) => {
  // Idempotence is the whole safety argument for running this unconditionally on
  // every character of every refresh: the trigger is the stored path differing
  // from the derived one, so a migrated character must be a no-op — no move, no
  // rewrite, and above all no resurrection of the old folder.
  const seed = buildSeed({ demo: true, activeProjectFile: P.dcsp })
  seed.files[NEW_DTH] = 'dth-fixture'
  await page.addInitScript(installTauriMock, seed)
  await page.goto('/')

  await page.getByRole('link', { name: /Tools/ }).click()
  await page.getByRole('tab', { name: /Refresh assets/ }).click()
  await page.getByRole('button', { name: /^Refresh assets$/ }).click()

  const read = (path: string) =>
    page.evaluate(
      (p) => ((window as unknown as { __tauriMock: { files: Map<string, string> } }).__tauriMock.files.get(p) ?? '') as string,
      path,
    )

  await expect.poll(() => read(`${P.charFolder}/Kira.json`)).not.toBe('')
  expect(await read(NEW_DTH)).toBe('dth-fixture')
  expect(await read(OLD_DTH)).toBe('')
  const definition = JSON.parse((await read(`${P.charFolder}/Kira.json`)) || '{}')
  expect(definition.exportPath).toBe(P.exportDir)
})
