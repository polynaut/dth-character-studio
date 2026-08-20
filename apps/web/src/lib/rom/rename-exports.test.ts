import { describe, expect, it } from 'vitest'

import { exportWipeTargets, formatBytes, hasExportFiles, movedFrom } from './rename-exports.ts'

import type { ExportWipeMeasure } from './rename-exports.ts'

const CHAR = 'D:/chars/Kira'

const targets = (over: Partial<Parameters<typeof exportWipeTargets>[0]> = {}) =>
  exportWipeTargets({
    charFolderAbs: CHAR,
    derivedExportRoot: `${CHAR}/houdini/daz-export`,
    storedExportRoot: `${CHAR}/houdini/daz-export`,
    finalExportDir: `${CHAR}/export`,
    ...over,
  })

describe('exportWipeTargets', () => {
  it('clears both export trees, the two Daz roots deduped', () => {
    expect(targets()).toEqual([
      { path: `${CHAR}/houdini/daz-export`, kind: 'daz' },
      { path: `${CHAR}/export`, kind: 'final' },
    ])
  })

  it('keeps a NOT-yet-migrated character’s stored root beside the derived one', () => {
    // A character that hasn't been saved since the export-root move still has
    // its files under the Daz subfolder — both have to go, or the rename leaves
    // gigabytes of dead exports behind at whichever one it didn't look at.
    expect(targets({ storedExportRoot: `${CHAR}/daz3d/dth-exports` })).toEqual([
      { path: `${CHAR}/houdini/daz-export`, kind: 'daz' },
      { path: `${CHAR}/daz3d/dth-exports`, kind: 'daz' },
      { path: `${CHAR}/export`, kind: 'final' },
    ])
  })

  it('dedupes the two Daz roots case-insensitively, keeping the real spelling', () => {
    const out = targets({ storedExportRoot: `d:/chars/kira/houdini/DAZ-EXPORT` })
    expect(out.filter((t) => t.kind === 'daz')).toEqual([
      { path: `${CHAR}/houdini/daz-export`, kind: 'daz' },
    ])
  })

  it('refuses a stored export root that is not NAMED like one', () => {
    // `exportPath` is user data for any character not saved since schema v29 —
    // it was a free directory picker, and its natural answer was somewhere
    // inside the Houdini folder, including that folder itself. Clearing that
    // would take the user's `.hiplc` files with it.
    const out = targets({ storedExportRoot: `${CHAR}/houdini` })
    expect(out.map((t) => t.path)).not.toContain(`${CHAR}/houdini`)
  })

  it('refuses anything outside the character folder, `..` included', () => {
    expect(
      targets({
        derivedExportRoot: 'D:/chars/Other/houdini/daz-export',
        storedExportRoot: `${CHAR}/houdini/../../Other/daz-export`,
        finalExportDir: 'D:/somewhere/else',
      }),
    ).toEqual([])
  })

  it('refuses the character folder ITSELF as the final export tree', () => {
    // An empty `exportSubdir` resolves `<char>/<exportSubdir>` to the character
    // folder — a rename must never become a delete of everything.
    expect(targets({ finalExportDir: CHAR })).toEqual([
      { path: `${CHAR}/houdini/daz-export`, kind: 'daz' },
    ])
    expect(targets({ finalExportDir: `${CHAR}/` })).toEqual([
      { path: `${CHAR}/houdini/daz-export`, kind: 'daz' },
    ])
  })

  it('never lists one folder under two kinds', () => {
    const out = targets({ finalExportDir: `${CHAR}/houdini/daz-export` })
    expect(out).toEqual([{ path: `${CHAR}/houdini/daz-export`, kind: 'daz' }])
  })

  it('normalizes separators and drops trailing ones', () => {
    expect(targets({ derivedExportRoot: 'D:\\chars\\Kira\\houdini\\daz-export\\' })[0]).toEqual({
      path: `${CHAR}/houdini/daz-export`,
      kind: 'daz',
    })
  })

  it('answers nothing without a character folder to contain it', () => {
    expect(targets({ charFolderAbs: '' })).toEqual([])
  })
})

describe('hasExportFiles', () => {
  const measure = (files: number): ExportWipeMeasure => ({
    path: `${CHAR}/export`,
    kind: 'final',
    files,
    bytes: files * 10,
  })

  it('is the dialog’s trigger: an EMPTY tree is not worth a warning', () => {
    expect(hasExportFiles([])).toBe(false)
    expect(hasExportFiles([measure(0)])).toBe(false)
    expect(hasExportFiles([measure(0), measure(1)])).toBe(true)
  })
})

describe('formatBytes', () => {
  it('reads like a size, one decimal only where it changes the answer', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(940)).toBe('940 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(9_000)).toBe('8.8 KB')
    expect(formatBytes(18_000)).toBe('18 KB')
    expect(formatBytes(177_666_960)).toBe('169 MB')
    expect(formatBytes(1_288_490_189)).toBe('1.2 GB')
  })
})

describe('movedFrom', () => {
  it('is the old folder when the rename moved it', () => {
    expect(movedFrom('D:/chars/Kira', 'D:/chars/Nova')).toBe('D:/chars/Kira')
  })

  it('is empty when the folder did not move', () => {
    // A character whose folder no longer tracks its name keeps it through a
    // rename — and a case-only rename targets the same physical folder.
    expect(movedFrom('D:/chars/Kira', 'D:/chars/Kira')).toBe('')
    expect(movedFrom('D:/chars/kira', 'D:\\chars\\Kira\\')).toBe('')
    expect(movedFrom('', 'D:/chars/Nova')).toBe('')
  })

  it('refuses a `..` spelling', () => {
    // The prefix is swapped out of absolute references on the Python side by a
    // plain string compare, so a traversal spelling would match paths that
    // belong to something else entirely.
    expect(movedFrom('D:/chars/Nova/../Kira', 'D:/chars/Nova')).toBe('')
  })
})
