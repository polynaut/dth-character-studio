import { beforeEach, describe, expect, it, vi } from 'vitest'

// api-level pins for `copyHoudiniProject` — bringing a `.hip` that lives outside
// the character folder IN, and the "Delete original after copying" half of that
// decision, which is the only place the studio removes a Houdini project file
// the user picked from their own tree. That delete is permanent (no recycle
// bin), so it is pinned here rather than nowhere: the browser smoke spec that
// used to cover it drove the whole dialog and went flaky under CI load, and a
// destructive path deserves a check that answers the same question in
// milliseconds without a browser in the loop.
//
// What this does NOT cover (and the smoke spec did): the dialog wiring from the
// switch to `deleteOriginal`. The api contract below is the destructive half.

const files = new Map<string, string>()

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    return files.has(norm(p))
  },
  async mkdir() {},
  async copyFile(from: string, to: string) {
    const body = files.get(norm(from))
    if (body == null) throw new Error(`ENOENT ${from}`)
    files.set(norm(to), body)
  },
  async remove(p: string) {
    files.delete(norm(p))
  },
  async readTextFile(p: string) {
    const body = files.get(norm(p))
    if (body == null) throw new Error(`ENOENT ${p}`)
    return body
  },
}))

// Only the two fs-backed resolvers are faked — `charScopeInput`, `charsRoot` and
// `joinPath` stay REAL, so the path the copy lands on is the one the app computes.
vi.mock('./api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/core')>()
  return {
    ...actual,
    resolveProject: async () => ({ path: PROJECT, houdiniSubdir: 'houdini', charactersSubdir: '' }),
    locateCharacter: async () => ({
      folderAbs: CHAR,
      definitionAbs: `${CHAR}/Kira.json`,
      relFolder: 'Kira',
      libraryFolder: PROJECT,
    }),
  }
})

import { copyHoudiniProject } from './api/houdini'

const PROJECT = 'D:/Projects/Nova'
const CHAR = `${PROJECT}/Kira`
const OUTSIDE = 'D:/Templates/G9_Skin_Base.hiplc'
const DEST = `${CHAR}/houdini/G9_Skin_Base.hiplc`

beforeEach(() => {
  files.clear()
  files.set(OUTSIDE, 'hip-fixture')
})

describe('copyHoudiniProject', () => {
  it('copies the project into the character folder and LEAVES the original', async () => {
    const dest = await copyHoudiniProject({
      data: { projectId: PROJECT, id: 'kira', hipPath: OUTSIDE, deleteOriginal: false },
    })

    expect(norm(dest)).toBe(DEST)
    expect(files.get(DEST)).toBe('hip-fixture')
    // A COPY leaves the source alone — that is the whole difference from move.
    expect(files.has(OUTSIDE)).toBe(true)
  })

  it('deleteOriginal removes the source, but only once the copy is on disk', async () => {
    const dest = await copyHoudiniProject({
      data: { projectId: PROJECT, id: 'kira', hipPath: OUTSIDE, deleteOriginal: true },
    })

    expect(norm(dest)).toBe(DEST)
    expect(files.get(DEST)).toBe('hip-fixture')
    expect(files.has(OUTSIDE)).toBe(false)
  })

  it('refuses an occupied destination — and the original survives the refusal', async () => {
    files.set(DEST, 'somebody else’s project')

    await expect(
      copyHoudiniProject({
        data: { projectId: PROJECT, id: 'kira', hipPath: OUTSIDE, deleteOriginal: true },
      }),
    ).rejects.toThrow(/already in this character.s Houdini folder/)

    // Refusing has to mean refusing: neither file was touched. With Move on,
    // deleting the source here would destroy the only copy the user had.
    expect(files.get(DEST)).toBe('somebody else’s project')
    expect(files.get(OUTSIDE)).toBe('hip-fixture')
  })
})
