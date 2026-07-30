import { beforeEach, describe, expect, it, vi } from 'vitest'

import { moveFolder } from '#/lib/rom/storage/characters.ts'
import { isLockedPathError, renameWithRetry } from '#/lib/rom/storage/fs.ts'

// Renaming a character folder on Windows fails with ERROR_ACCESS_DENIED while
// ANY file inside it is open in another process — in practice Daz Studio still
// holding the linked `.duf`. Reported from a Perforce workspace as a bare
// "failed to rename old path: …/characters/Ita to new path: …/characters/Ita_JM
// with error: Access is denied. (os error 5)" toast: no cause, no remedy, and
// no retry for the transient holders (AV, search indexer) that clear on their
// own. These pin both halves of the fix.

// vi.hoisted: the vi.mock factory below is hoisted above the const, so the mock
// has to be created in the hoisted scope to be referenceable from it.
const { renameMock } = vi.hoisted(() => ({ renameMock: vi.fn<(from: string, to: string) => Promise<void>>() }))

vi.mock('@tauri-apps/api/path', () => ({ appLocalDataDir: async () => '/appdata' }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  isTauri: () => false,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  rename: (from: string, to: string) => renameMock(from, to),
  // moveFolder's collision probe: nothing is ever taken in these tests, so the
  // rename is always reached.
  exists: async () => false,
  mkdir: async () => {},
  stat: async () => ({ isDirectory: false, isFile: false }),
  readDir: async () => [],
  readTextFile: async () => '',
  writeTextFile: async () => {},
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  remove: async () => {},
}))

/** The plugin-fs error shape, verbatim from the reported toast. */
function lockError(): Error {
  return new Error(
    'failed to rename old path: D:/Perforce/playground__assets/characters/Ita to new path: ' +
      'D:/Perforce/playground__assets/characters/Ita_JM with error: Access is denied. (os error 5)',
  )
}

beforeEach(() => {
  renameMock.mockReset()
  renameMock.mockResolvedValue(undefined)
})

describe('isLockedPathError', () => {
  it('recognises a lock by its OS error NUMBER, not the localized text', () => {
    // The "Access is denied" wording only appears on an English Windows; the
    // `(os error N)` suffix Rust appends is locale-independent, so that is what
    // the detection keys off.
    expect(isLockedPathError(new Error('Zugriff verweigert. (os error 5)'))).toBe(true)
    expect(isLockedPathError(new Error('sharing violation (os error 32)'))).toBe(true)
    expect(isLockedPathError(lockError())).toBe(true)
  })

  it('accepts the English texts too, as a fallback if the suffix ever goes away', () => {
    expect(isLockedPathError(new Error('Access is denied.'))).toBe(true)
    expect(isLockedPathError(new Error('The file is being used by another process'))).toBe(true)
  })

  it('does NOT match unrelated failures', () => {
    // os error 2 = not found, os error 183 = already exists: retrying either is
    // pointless and the mapped "something has it open" message would be a lie.
    expect(isLockedPathError(new Error('The system cannot find the file. (os error 2)'))).toBe(false)
    expect(isLockedPathError(new Error('Cannot create a file when it already exists. (os error 183)'))).toBe(false)
    expect(isLockedPathError(new Error('destination is not empty'))).toBe(false)
  })
})

describe('renameWithRetry', () => {
  it('rides out a TRANSIENT lock (AV / indexer) and succeeds', async () => {
    renameMock.mockRejectedValueOnce(lockError()).mockRejectedValueOnce(lockError())
    await renameWithRetry('/lib/Ita', '/lib/Ita_JM', [0, 0])
    expect(renameMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after the last delay and rethrows the ORIGINAL error', async () => {
    renameMock.mockRejectedValue(lockError())
    await expect(renameWithRetry('/lib/Ita', '/lib/Ita_JM', [0, 0])).rejects.toThrow('os error 5')
    expect(renameMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-lock failure', async () => {
    renameMock.mockRejectedValue(new Error('Cannot create a file when it already exists. (os error 183)'))
    await expect(renameWithRetry('/lib/Ita', '/lib/Ita_JM', [0, 0])).rejects.toThrow('os error 183')
    // One attempt only — retrying would just delay the same error.
    expect(renameMock).toHaveBeenCalledTimes(1)
  })
})

describe('moveFolder — the locked-folder message', () => {
  it('explains WHAT to close instead of surfacing the raw OS error', async () => {
    renameMock.mockRejectedValue(lockError())
    const thrown = await moveFolder('/lib/Ita', '/lib/Ita_JM').then(
      () => null,
      (e: unknown) => e as Error,
    )
    const message = thrown?.message ?? ''
    expect(message).toContain('a file inside it is open in another program')
    expect(message).toContain('Daz Studio')
    // The path stays in the message — with several characters open, which folder
    // failed is the first thing the user needs.
    expect(message).toContain('/lib/Ita')
    // The raw plugin text is REPLACED, not appended: it's what made the toast
    // unreadable in the first place.
    expect(message).not.toContain('os error 5')
  })

  it("leaves a non-lock failure's own message intact", async () => {
    renameMock.mockRejectedValue(new Error('The device is not ready. (os error 21)'))
    await expect(moveFolder('/lib/Ita', '/lib/Ita_JM')).rejects.toThrow('The device is not ready')
  })
})
