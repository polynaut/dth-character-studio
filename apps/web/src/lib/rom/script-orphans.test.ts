import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pins the housekeeping sweep's orphaned-SCRIPT-dir pass: a character deleted or
// renamed outside the app strands `Scripts/DTH-Character-Studio/<project>/<char>/`
// in the Daz library forever. The gates matter more than the delete — the tree
// also holds the shared runtime (files at the root) and possibly OTHER machines'
// project folders, so the sweep may only touch character dirs inside a KNOWN
// project's folder, and only off a complete, problem-free character scan.
// Same in-memory fs seam as project-files.test.ts.

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

vi.mock('@tauri-apps/api/path', () => ({ appLocalDataDir: async () => '/appdata' }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.0.0' }))
vi.mock('@tauri-apps/api/core', () => ({
  // The sweep is desktop-only; the native age-out halves are stubbed to zero so
  // the script-dir pass is the only thing producing numbers. The recents CAS
  // write is implemented against the in-memory fs (single test "window", so
  // it always matches → 'written').
  isTauri: () => true,
  invoke: async (cmd: string, payload?: unknown) => {
    if (cmd === 'housekeeping_sweep') return { filesDeleted: 0, bytesFreed: 0 }
    if (cmd === 'write_text_file_if_unchanged') {
      const { path, expected, next } = (
        payload as { request: { path: string; expected: string; next: string } }
      ).request
      const key = norm(path)
      const stored = files.get(key)
      const current =
        stored == null ? '' : typeof stored === 'string' ? stored : new TextDecoder().decode(stored)
      if (current !== expected) return 'conflict'
      addDir(key.slice(0, key.lastIndexOf('/')))
      files.set(key, next)
      return 'written'
    }
    return null
  },
  convertFileSrc: (p: string) => p,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./api/notes', () => ({
  gcNoteMedia: vi.fn(async () => ({ filesDeleted: 0, bytesFreed: 0 })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    p = norm(p)
    return files.has(p) || dirs.has(p)
  },
  async mkdir(p: string) {
    addDir(p)
  },
  async readTextFile(p: string) {
    p = norm(p)
    const v = files.get(p)
    if (v == null) throw new Error(`ENOENT ${p}`)
    return typeof v === 'string' ? v : new TextDecoder().decode(v)
  },
  async writeTextFile(p: string, c: string) {
    files.set(norm(p), c)
  },
  async readFile(p: string) {
    p = norm(p)
    const v = files.get(p)
    if (v == null) throw new Error(`ENOENT ${p}`)
    return typeof v === 'string' ? new TextEncoder().encode(v) : v
  },
  async writeFile(p: string, b: Uint8Array) {
    files.set(norm(p), b)
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
  async rename() {
    throw new Error('unused')
  },
  async stat(p: string) {
    p = norm(p)
    const v = files.get(p)
    return {
      isDirectory: dirs.has(p),
      isFile: files.has(p),
      size: typeof v === 'string' ? v.length : (v?.length ?? 0),
      mtime: new Date(0),
      birthtime: new Date(0),
    }
  },
  async readDir(p: string) {
    p = norm(p)
    if (!dirs.has(p)) throw new Error(`ENOTDIR ${p}`)
    const prefix = `${p}/`
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
import { housekeepingSweep } from './api/maintenance'

beforeEach(() => {
  files.clear()
  dirs.clear()
})

/** A minimal valid character at `<projectDir>/<name>/<name>.json`. */
function seedCharacter(projectDir: string, name: string): void {
  const now = '2026-01-01T00:00:00.000Z'
  const c = characterSchema.parse({
    id: newId(),
    name,
    genesis: 'G9',
    gender: 'female',
    createdAt: now,
    updatedAt: now,
  })
  addDir(`${projectDir}/${name}`)
  files.set(
    `${projectDir}/${name}/${name}.json`,
    JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
}

/** A project known to the registry (recents IS the registry for sweeps). */
async function seedProject(dir: string, name: string): Promise<void> {
  await storage.createProjectManifest(dir, name)
  await storage.rememberRecent(`${dir}/${name}.dcsp`, name)
}

const ROOT = '/dazlib/Scripts/DTH-Character-Studio'

function seedScriptDir(projectFolder: string, charFolder: string): void {
  addDir(`${ROOT}/${projectFolder}/${charFolder}`)
  files.set(`${ROOT}/${projectFolder}/${charFolder}/ROM_X_G9.dsa`, 'script')
}

describe('housekeepingSweep — orphaned Daz-library script dirs', () => {
  it('deletes an orphan char dir; keeps live chars, the runtime, and unknown project dirs', async () => {
    files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: '/dazlib' }))
    await seedProject('/games/P', 'P')
    seedCharacter('/games/P', 'Kira')
    // The shared runtime at the root: FILES, never candidates.
    files.set(`${ROOT}/.DthWorkflow.dsa`, 'runtime')
    seedScriptDir('P', 'Kira') // live character → kept
    seedScriptDir('P', 'Ghost') // deleted-in-Explorer character → orphan, swept
    seedScriptDir('OtherMachine', 'X') // unknown project folder → never touched

    const result = await housekeepingSweep()

    expect(files.has(`${ROOT}/P/Ghost/ROM_X_G9.dsa`)).toBe(false)
    expect(dirs.has(`${ROOT}/P/Ghost`)).toBe(false)
    expect(files.has(`${ROOT}/P/Kira/ROM_X_G9.dsa`)).toBe(true)
    expect(files.has(`${ROOT}/.DthWorkflow.dsa`)).toBe(true)
    expect(files.has(`${ROOT}/OtherMachine/X/ROM_X_G9.dsa`)).toBe(true)
    expect(result.filesDeleted).toBe(1)
  })

  it('an unreadable character definition gates the WHOLE project folder (exists ≠ orphaned)', async () => {
    files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: '/dazlib' }))
    await seedProject('/games/Q', 'Q')
    seedCharacter('/games/Q', 'Kira')
    // A torn/corrupt definition: the scan reports a problem instead of an
    // entry — its character EXISTS, its scripts must not read as orphaned.
    addDir('/games/Q/Broken')
    files.set('/games/Q/Broken/Broken.json', '{not json')
    seedScriptDir('Q', 'Broken')
    seedScriptDir('Q', 'TrulyGone')

    const result = await housekeepingSweep()

    expect(files.has(`${ROOT}/Q/Broken/ROM_X_G9.dsa`)).toBe(true)
    expect(files.has(`${ROOT}/Q/TrulyGone/ROM_X_G9.dsa`)).toBe(true)
    expect(result.filesDeleted).toBe(0)
  })

  it('two projects sanitizing to ONE folder union their live sets', async () => {
    files.set('/appdata/settings.json', JSON.stringify({ dazLibraryFolder: '/dazlib' }))
    // "Nova" and "nova" share a script folder on a case-insensitive fs; the
    // sweep must union their characters, not judge by one project alone.
    await seedProject('/games/N1', 'Nova')
    seedCharacter('/games/N1', 'Kira')
    await seedProject('/games/N2', 'nova')
    seedCharacter('/games/N2', 'Rex')
    seedScriptDir('Nova', 'Kira')
    seedScriptDir('Nova', 'Rex')
    seedScriptDir('Nova', 'Ghost')

    const result = await housekeepingSweep()

    expect(files.has(`${ROOT}/Nova/Kira/ROM_X_G9.dsa`)).toBe(true)
    expect(files.has(`${ROOT}/Nova/Rex/ROM_X_G9.dsa`)).toBe(true)
    expect(files.has(`${ROOT}/Nova/Ghost/ROM_X_G9.dsa`)).toBe(false)
    expect(result.filesDeleted).toBe(1)
  })
})
