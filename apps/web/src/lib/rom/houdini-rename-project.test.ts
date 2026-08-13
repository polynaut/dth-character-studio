import { beforeEach, describe, expect, it, vi } from 'vitest'

// api-level pins for `renameHoudiniProject` — renaming a linked `.hip` in place.
//
// The rule worth pinning below the browser is the EXTENSION: a generated project
// is `.hiplc`, a hand-linked one can be `.hip` or `.hipnc`, and the licence tier
// lives in that suffix. Rewriting a commercial `.hip` to `.hiplc` would tell
// Houdini the file is licence-limited — a data-losing mislabel that no smoke
// assertion on a card title would ever notice.
//
// What this does NOT cover (the smoke spec does): the card wiring — that the
// title is editable only for a project inside the character folder, and that a
// successful rename repoints `houdiniProjects`.

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
  async copyFile() {},
  async remove(p: string) {
    files.delete(norm(p))
  },
  async readTextFile(p: string) {
    const body = files.get(norm(p))
    if (body == null) throw new Error(`ENOENT ${p}`)
    return body
  },
  async rename(from: string, to: string) {
    const body = files.get(norm(from))
    if (body == null) throw new Error(`ENOENT ${from}`)
    files.delete(norm(from))
    files.set(norm(to), body)
  },
}))

import { renameHoudiniProject } from './api/houdini'

const HOUDINI = 'D:/Projects/Nova/Kira/houdini'
const HIPLC = `${HOUDINI}/3d-workflow_LaraCroft_G81.hiplc`

beforeEach(() => {
  files.clear()
  files.set(HIPLC, 'hip-fixture')
})

describe('renameHoudiniProject', () => {
  it('renames in place, keeping the folder and the file contents', async () => {
    const dest = await renameHoudiniProject({ data: { hipPath: HIPLC, newName: 'Lara' } })

    expect(norm(dest)).toBe(`${HOUDINI}/Lara.hiplc`)
    expect(files.get(`${HOUDINI}/Lara.hiplc`)).toBe('hip-fixture')
    // The old name is gone — a rename is not a copy.
    expect(files.has(HIPLC)).toBe(false)
  })

  it('CARRIES the extension over instead of assuming .hiplc', async () => {
    // The licence tier lives in the suffix: `.hip` is commercial, `.hiplc`
    // Indie, `.hipnc` non-commercial. Renaming must never move a file between
    // them — Houdini would refuse to open, or silently limit, the result.
    for (const ext of ['.hip', '.hiplc', '.hipnc']) {
      files.clear()
      files.set(`${HOUDINI}/Old${ext}`, 'hip-fixture')
      const dest = await renameHoudiniProject({
        data: { hipPath: `${HOUDINI}/Old${ext}`, newName: 'Lara' },
      })
      expect(norm(dest)).toBe(`${HOUDINI}/Lara${ext}`)
    }
  })

  it('refuses an occupied name — and the original survives the refusal', async () => {
    files.set(`${HOUDINI}/Lara.hiplc`, 'somebody else’s project')

    await expect(
      renameHoudiniProject({ data: { hipPath: HIPLC, newName: 'Lara' } }),
    ).rejects.toThrow(/already exists in that folder/)

    // Refusing has to mean refusing: neither file moved.
    expect(files.get(`${HOUDINI}/Lara.hiplc`)).toBe('somebody else’s project')
    expect(files.get(HIPLC)).toBe('hip-fixture')
  })

  it('rejects a name that is not a plain file name, touching nothing', async () => {
    // REJECTED, not silently cleaned: this replaces a name the user already has,
    // and quietly substituting another is a worse answer than refusing.
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '.', '..']) {
      await expect(
        renameHoudiniProject({ data: { hipPath: HIPLC, newName: bad } }),
      ).rejects.toThrow(/plain file name/)
    }
    expect(files.get(HIPLC)).toBe('hip-fixture')
  })

  it('is a no-op when the name is unchanged, including only by CASE', async () => {
    // Windows paths are case-insensitive, so `Lara` → `lara` would rename onto
    // ITSELF. Returning the path untouched keeps the caller from persisting a
    // repoint that changes nothing.
    const same = await renameHoudiniProject({
      data: { hipPath: HIPLC, newName: '3d-workflow_LaraCroft_G81' },
    })
    expect(norm(same)).toBe(HIPLC)
    expect(files.get(HIPLC)).toBe('hip-fixture')
  })
})
