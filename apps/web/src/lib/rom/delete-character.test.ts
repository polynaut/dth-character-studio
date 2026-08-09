import { beforeEach, describe, expect, it, vi } from 'vitest'

// api-level pins for deleteCharacter's KEEP-FLAG export purge — the one part of
// the delete that reaches back INTO a folder the user asked to keep.
//
// "Keep the Daz files" / "Keep the Houdini files" spare a whole subfolder, and
// since v0.69 the Houdini one contains the fixed `daz-export` root (before it,
// the Daz one contained `dth-exports`). Those are derived artifacts — gigabytes
// of regenerable `.abc`/`.dth` — so keeping the user's scenes or `.hip` files
// must not silently keep every export with them.
//
// Both roots are checked, because a character never SAVED since the move still
// has its exports at the old location and a delete is the last moment anyone
// looks. The second one comes from the STORED `exportPath`, which for a
// pre-v29 character is whatever directory the user once picked — hence the
// name guard these tests exist to hold down.

const files = new Map<string, string | Uint8Array>()
const dirs = new Set<string>()

function norm(p: string): string {
  let s = p.replace(/\\/g, '/')
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}
function addDir(p: string): void {
  let path = norm(p)
  while (path && path !== '/') {
    dirs.add(path)
    const idx = path.lastIndexOf('/')
    path = idx > 0 ? path.slice(0, idx) : ''
  }
}
function addFile(p: string): void {
  files.set(norm(p), 'x')
  const idx = norm(p).lastIndexOf('/')
  if (idx > 0) addDir(norm(p).slice(0, idx))
}
/** Every path still on disk under `prefix`, files and folders alike. */
function under(prefix: string): Array<string> {
  const t = `${norm(prefix)}/`
  return [...[...files.keys()], ...dirs].filter((k) => k.startsWith(t)).sort()
}

vi.mock('@tauri-apps/api/path', () => ({ appLocalDataDir: async () => '/appdata' }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  isTauri: () => false,
  convertFileSrc: (p: string) => p,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    const t = norm(p).toLowerCase()
    for (const k of files.keys()) if (k.toLowerCase() === t) return true
    for (const k of dirs) if (k.toLowerCase() === t) return true
    return false
  },
  async remove(p: string, opts?: { recursive?: boolean }) {
    const t = norm(p).toLowerCase()
    for (const k of [...files.keys()]) {
      const lower = k.toLowerCase()
      if (lower === t || (opts?.recursive && lower.startsWith(`${t}/`))) files.delete(k)
    }
    for (const k of [...dirs]) {
      const lower = k.toLowerCase()
      if (lower === t || (opts?.recursive && lower.startsWith(`${t}/`))) dirs.delete(k)
    }
  },
  async mkdir(p: string) {
    addDir(p)
  },
  async readTextFile(p: string) {
    const v = files.get(norm(p))
    if (v == null) throw new Error(`ENOENT ${p}`)
    return typeof v === 'string' ? v : new TextDecoder().decode(v)
  },
  async writeTextFile(p: string, c: string) {
    files.set(norm(p), c)
  },
  async readFile(p: string) {
    const v = files.get(norm(p))
    if (v == null) throw new Error(`ENOENT ${p}`)
    return typeof v === 'string' ? new TextEncoder().encode(v) : v
  },
  async writeFile(p: string, b: Uint8Array) {
    files.set(norm(p), b)
  },
  async rename() {},
  async stat(p: string) {
    return {
      isDirectory: dirs.has(norm(p)),
      isFile: files.has(norm(p)),
      mtime: new Date(0),
      birthtime: new Date(0),
    }
  },
  async readDir(p: string) {
    const dir = norm(p)
    if (!dirs.has(dir)) throw new Error(`ENOTDIR ${dir}`)
    const prefix = `${dir}/`
    const out = new Map<string, { name: string; isFile: boolean; isDirectory: boolean }>()
    for (const k of files.keys()) {
      if (!k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length)
      const name = rest.split('/')[0]
      const isFile = !rest.includes('/')
      if (!out.has(name)) out.set(name, { name, isFile, isDirectory: !isFile })
    }
    for (const k of dirs) {
      if (!k.startsWith(prefix)) continue
      const name = k.slice(prefix.length).split('/')[0]
      if (!out.has(name)) out.set(name, { name, isFile: false, isDirectory: true })
    }
    return [...out.values()]
  },
}))

import { CHARACTER_SCHEMA_VERSION, characterSchema, newId } from '@dth/rom'
import * as storage from './storage'
import { deleteCharacter } from './api/characters'

const LIB = '/games/Nova'
const CHAR = `${LIB}/Kira`

beforeEach(() => {
  files.clear()
  dirs.clear()
})

/**
 * `<lib>/Kira` in the standard layout: Daz scenes, a Houdini folder holding the
 * user's own `.hip` AND the export root, and the final `export/` folder.
 * `exportPath` is whatever the caller says it is — that is the field under test.
 */
async function seed(exportPath: string): Promise<string> {
  await storage.createProjectManifest(LIB, 'Nova')
  const c = characterSchema.parse({
    id: newId(),
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: `${CHAR}/daz3d/Kira.duf`,
    houdiniProjects: [`${CHAR}/houdini/Kira.hiplc`],
    exportPath,
  })
  files.set(`${CHAR}/Kira.json`, JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }))
  addFile(`${CHAR}/daz3d/Kira.duf`)
  addFile(`${CHAR}/houdini/Kira.hiplc`)
  addFile(`${CHAR}/export/Kira_ready.fbx`)
  // Both export roots exist on disk, so every test proves WHICH one was aimed at.
  addFile(`${CHAR}/houdini/daz-export/primary/Kira.dth`)
  addFile(`${CHAR}/daz3d/dth-exports/primary/Kira.dth`)
  return c.id
}

describe('deleteCharacter — the keep-flag export purge', () => {
  it('keep Houdini: the .hip survives, the daz-export root inside it does not', async () => {
    const id = await seed(`${CHAR}/houdini/daz-export`)

    await deleteCharacter({ data: { projectId: LIB, id, keepHoudini: true } })

    expect(files.has(`${CHAR}/houdini/Kira.hiplc`)).toBe(true)
    expect(dirs.has(`${CHAR}/houdini/daz-export`)).toBe(false)
    expect(files.has(`${CHAR}/houdini/daz-export/primary/Kira.dth`)).toBe(false)
    // Nothing else was kept.
    expect(files.has(`${CHAR}/daz3d/Kira.duf`)).toBe(false)
  })

  it('keep Daz on an UN-MIGRATED character: the legacy root goes, the scenes stay', async () => {
    // Never saved since the move, so its definition still points at
    // `<daz>/dth-exports` and its files are still there. Keeping the scenes must
    // not keep those with them.
    const id = await seed(`${CHAR}/daz3d/dth-exports`)

    await deleteCharacter({ data: { projectId: LIB, id, keepDaz: true } })

    expect(files.has(`${CHAR}/daz3d/Kira.duf`)).toBe(true)
    expect(dirs.has(`${CHAR}/daz3d/dth-exports`)).toBe(false)
    expect(files.has(`${CHAR}/daz3d/dth-exports/primary/Kira.dth`)).toBe(false)
  })

  it('BOTH kept: both roots go, both parents stay', async () => {
    const id = await seed(`${CHAR}/daz3d/dth-exports`)

    await deleteCharacter({ data: { projectId: LIB, id, keepDaz: true, keepHoudini: true } })

    expect(files.has(`${CHAR}/daz3d/Kira.duf`)).toBe(true)
    expect(files.has(`${CHAR}/houdini/Kira.hiplc`)).toBe(true)
    // The derived root and the stored legacy one — a delete reaches BOTH, since
    // an un-migrated character has files at the old one and the studio would
    // otherwise leave gigabytes behind with nobody coming back for them.
    expect(dirs.has(`${CHAR}/houdini/daz-export`)).toBe(false)
    expect(dirs.has(`${CHAR}/daz3d/dth-exports`)).toBe(false)
  })

  it('a pre-v29 exportPath naming a KEPT FOLDER ITSELF is refused, not followed', async () => {
    // Before v29 the export directory was a free directory picker, and its most
    // natural answer was "somewhere in the Houdini folder" — including that
    // folder. Containment alone would accept it, and the keep-Houdini delete
    // would then recursively remove the exact folder the flag exists to spare.
    const id = await seed(`${CHAR}/houdini`)

    await deleteCharacter({ data: { projectId: LIB, id, keepHoudini: true } })

    expect(files.has(`${CHAR}/houdini/Kira.hiplc`)).toBe(true)
    expect(dirs.has(`${CHAR}/houdini`)).toBe(true)
    // The DERIVED root is still purged — the guard drops one candidate, not the
    // feature.
    expect(dirs.has(`${CHAR}/houdini/daz-export`)).toBe(false)
  })

  it('a pre-v29 exportPath OUTSIDE the character folder is never touched', async () => {
    addFile('/renders/kira/Kira.dth')
    const id = await seed('/renders/kira')

    await deleteCharacter({ data: { projectId: LIB, id, keepHoudini: true } })

    // The user's own tree is theirs — a keep-flag delete may not reach into it.
    expect(files.has('/renders/kira/Kira.dth')).toBe(true)
  })

  it('no keep flags: the whole character folder goes, exports included', async () => {
    const id = await seed(`${CHAR}/houdini/daz-export`)

    await deleteCharacter({ data: { projectId: LIB, id } })

    expect(under(CHAR)).toEqual([])
  })
})
