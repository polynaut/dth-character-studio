import { beforeEach, describe, expect, it, vi } from 'vitest'

// api-level pins for moveCharacterScenesFolder — the persist step behind the
// Daz scene field's "Scenes subfolder" inline editor (it runs as persistPatch's
// custom persist, so its RETURN VALUE becomes the editor baseline):
//  - the returned character carries the repointed paths (through THE single
//    repoint site, storage's repointCharacterPaths),
//  - the on-disk definition matches that return exactly,
//  - a same-subfolder no-op still SAVES the passed draft (the baseline-settle
//    contract: a persist step must return what is actually on disk),
//  - a scenes folder outside the character folder refuses up front.
// Same in-memory fs seam as generate-rename.test.ts.

const files = new Map<string, string | Uint8Array>()
const dirs = new Set<string>()

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/g, '')
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
  async rename(a: string, b: string) {
    a = norm(a)
    b = norm(b)
    const remap = (k: string) => b + k.slice(a.length)
    for (const k of [...files.keys()]) {
      if (k === a || k.startsWith(`${a}/`)) {
        files.set(remap(k), files.get(k)!)
        files.delete(k)
      }
    }
    for (const k of [...dirs]) {
      if (k === a || k.startsWith(`${a}/`)) {
        dirs.delete(k)
        dirs.add(remap(k))
      }
    }
  },
  async stat(p: string) {
    p = norm(p)
    return { isDirectory: dirs.has(p), isFile: files.has(p), mtime: new Date(0), birthtime: new Date(0) }
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
import type { Character } from '@dth/rom'
import * as storage from './storage'
import { moveCharacterScenesFolder } from './api/characters'

beforeEach(() => {
  files.clear()
  dirs.clear()
})

/** Seed `<lib>/Kira` with a definition whose in-scenes-folder paths cover every
 *  repointable kind — including a per-section custom `.duf` (the field the
 *  route-side merge used to drop) — plus a Houdini project OUTSIDE the scenes
 *  folder that must stay untouched. */
function seedCharacter(lib: string, opts: { sceneDir?: string } = {}): Character {
  const sceneDir = opts.sceneDir ?? `${lib}/Kira/daz3d`
  const c = characterSchema.parse({
    id: newId(),
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: `${sceneDir}/Kira.duf`,
    extraScenes: [`${sceneDir}/Outfit.duf`],
    houdiniProjects: [`${lib}/Kira/houdini`],
  })
  c.sections.JCM.mode = 'custom'
  c.sections.JCM.customAssetPath = `${sceneDir}/Custom Base.duf`
  addDir(sceneDir)
  addDir(`${lib}/Kira/houdini`)
  files.set(
    `${lib}/Kira/Kira.json`,
    JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  files.set(`${sceneDir}/Kira.duf`, 'duf')
  files.set(`${sceneDir}/Outfit.duf`, 'duf')
  files.set(`${sceneDir}/Custom Base.duf`, 'duf')
  return c
}

describe('moveCharacterScenesFolder', () => {
  it('moves the folder, repoints every in-folder path, and persists exactly what it returns', async () => {
    await storage.createProjectManifest('/games/P', 'P')
    const c = seedCharacter('/games/P')

    const moved = await moveCharacterScenesFolder({
      data: { projectId: '/games/P', character: c, newSubdir: 'scenes' },
    })

    // Every path that lived under daz3d travelled — scenes, the extra scene AND
    // the custom-section .duf (via the single repoint site).
    expect(moved.scenePath).toBe('/games/P/Kira/scenes/Kira.duf')
    expect(moved.extraScenes).toEqual(['/games/P/Kira/scenes/Outfit.duf'])
    expect(moved.sections.JCM.customAssetPath).toBe('/games/P/Kira/scenes/Custom Base.duf')
    // A Houdini project outside the scenes folder is untouched.
    expect(moved.houdiniProjects).toEqual(['/games/P/Kira/houdini'])
    // The folder physically moved.
    expect(files.has('/games/P/Kira/scenes/Kira.duf')).toBe(true)
    expect(files.has('/games/P/Kira/scenes/Custom Base.duf')).toBe(true)
    expect(files.has('/games/P/Kira/daz3d/Kira.duf')).toBe(false)
    // The on-disk definition matches the RETURNED character (the persist
    // contract — persistPatch settles the editor baseline to this return).
    const onDisk = JSON.parse(files.get('/games/P/Kira/Kira.json') as string)
    expect(onDisk.scenePath).toBe(moved.scenePath)
    expect(onDisk.extraScenes).toEqual(moved.extraScenes)
    expect(onDisk.sections.JCM.customAssetPath).toBe(moved.sections.JCM.customAssetPath)
    expect(onDisk.updatedAt).toBe(moved.updatedAt)
  })

  it('a same-subfolder no-op still SAVES the passed draft (baseline-settle contract)', async () => {
    await storage.createProjectManifest('/games/Q', 'Q')
    const c = seedCharacter('/games/Q')
    // The draft carries an unrelated pending edit — the no-op "move" must still
    // persist it, because the caller settles the baseline to the return value.
    const draft = { ...c, gender: 'male' as const }

    const saved = await moveCharacterScenesFolder({
      data: { projectId: '/games/Q', character: draft, newSubdir: 'daz3d' },
    })

    // Nothing moved on disk, paths unchanged…
    expect(files.has('/games/Q/Kira/daz3d/Kira.duf')).toBe(true)
    expect(saved.scenePath).toBe('/games/Q/Kira/daz3d/Kira.duf')
    // …but the draft WAS saved: return and definition both carry the edit.
    expect(saved.gender).toBe('male')
    const onDisk = JSON.parse(files.get('/games/Q/Kira/Kira.json') as string)
    expect(onDisk.gender).toBe('male')
    expect(onDisk.updatedAt).toBe(saved.updatedAt)
  })

  it('refuses a scenes folder OUTSIDE the character folder, changing nothing', async () => {
    await storage.createProjectManifest('/games/R', 'R')
    // The primary scene is linked in place from a shared folder outside
    // <lib>/Kira — there is no in-folder subfolder to rename.
    const c = seedCharacter('/games/R', { sceneDir: '/games/R/shared' })
    const before = files.get('/games/R/Kira/Kira.json')

    await expect(
      moveCharacterScenesFolder({
        data: { projectId: '/games/R', character: c, newSubdir: 'scenes' },
      }),
    ).rejects.toThrow('The scenes folder lives outside the character folder.')

    // Nothing moved, nothing saved.
    expect(files.has('/games/R/shared/Kira.duf')).toBe(true)
    expect(files.get('/games/R/Kira/Kira.json')).toBe(before)
  })
})
