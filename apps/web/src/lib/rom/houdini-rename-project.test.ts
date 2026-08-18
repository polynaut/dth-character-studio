// These loops walk table-driven cases over ONE shared fixture (`files.clear()`
// per case) or assert insertion ORDER — running them together would have the
// cases overwrite each other's state. Sequential is the test, not an oversight.
/* oxlint-disable no-await-in-loop */
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

/**
 * The fake filesystem matches paths case-INSENSITIVELY, because Windows does
 * and that is the platform every Houdini path here lives on.
 *
 * Not decoration: it is what makes the case-only rename below a real test. On a
 * plain case-sensitive Map, `exists('…/Lara.hiplc')` would answer false while
 * `lara.hiplc` sat right there, the collision guard would never be reached, and
 * the test would pass with or without the fix it exists to prove.
 */
function findKey(p: string): string | undefined {
  const want = norm(p).toLowerCase()
  for (const key of files.keys()) if (key.toLowerCase() === want) return key
  return undefined
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    return findKey(p) !== undefined
  },
  async mkdir() {},
  async copyFile() {},
  async remove(p: string) {
    const key = findKey(p)
    if (key) files.delete(key)
  },
  async readTextFile(p: string) {
    const key = findKey(p)
    if (key == null) throw new Error(`ENOENT ${p}`)
    return files.get(key)!
  },
  async rename(from: string, to: string) {
    const key = findKey(from)
    if (key == null) throw new Error(`ENOENT ${from}`)
    const body = files.get(key)!
    files.delete(key)
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
    expect(findKey(HIPLC)).toBeUndefined()
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

  it('a CASE-only change is a real rename, not a silent no-op', async () => {
    // Fixing capitalisation is the whole point of an editable name, and it used
    // to return the path untouched — the card's title just snapped back with
    // nothing said. The collision guard has to be skipped for it: on Windows
    // the destination IS the source, so `exists` answers true and would refuse
    // the user their own file.
    files.clear()
    files.set(`${HOUDINI}/lara.hiplc`, 'hip-fixture')
    const dest = await renameHoudiniProject({
      data: { hipPath: `${HOUDINI}/lara.hiplc`, newName: 'Lara' },
    })

    expect(norm(dest)).toBe(`${HOUDINI}/Lara.hiplc`)
    expect([...files.keys()]).toEqual([`${HOUDINI}/Lara.hiplc`])
  })

  it('accepts a name typed WITH the extension instead of doubling it', async () => {
    // The card shows the stem, so typing the suffix back is a natural mistake —
    // and it used to produce `Lara.hiplc.hiplc` (measured), silently.
    for (const typed of ['Lara.hiplc', 'Lara.HIPLC', 'Lara']) {
      files.clear()
      files.set(HIPLC, 'hip-fixture')
      const dest = await renameHoudiniProject({ data: { hipPath: HIPLC, newName: typed } })
      expect(norm(dest)).toBe(`${HOUDINI}/Lara.hiplc`)
    }
  })

  it('drops trailing dots and spaces, which Windows would drop anyway', async () => {
    // Keeping them saves the project under a name the user cannot type back,
    // and which the studio then reports as missing on disk.
    const dest = await renameHoudiniProject({ data: { hipPath: HIPLC, newName: 'Lara. ' } })
    expect(norm(dest)).toBe(`${HOUDINI}/Lara.hiplc`)
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
    // and quietly substituting another is a worse answer than refusing. The
    // dots-only cases arrive here via `renameStem`, which strips them to ''.
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '.', '..']) {
      await expect(
        renameHoudiniProject({ data: { hipPath: HIPLC, newName: bad } }),
      ).rejects.toThrow(/plain file name/)
    }
    expect(files.get(HIPLC)).toBe('hip-fixture')
  })

  it('is a no-op when the name is unchanged', async () => {
    const same = await renameHoudiniProject({
      data: { hipPath: HIPLC, newName: '3d-workflow_LaraCroft_G81' },
    })
    expect(norm(same)).toBe(HIPLC)
    expect(files.get(HIPLC)).toBe('hip-fixture')
  })

  it('REFUSES a path with no folder rather than inventing one', async () => {
    // `lastIndexOf('/')` answering -1 used to slice a character off the name and
    // turn it into a directory: `Kira.hiplc` came back `Kira.hipl/Lara.hiplc`
    // (measured). Unreachable from the card, but this is exported api.
    files.set('Kira.hiplc', 'hip-fixture')
    await expect(
      renameHoudiniProject({ data: { hipPath: 'Kira.hiplc', newName: 'Lara' } }),
    ).rejects.toThrow(/full path/)
    expect(files.get('Kira.hiplc')).toBe('hip-fixture')
  })
})
