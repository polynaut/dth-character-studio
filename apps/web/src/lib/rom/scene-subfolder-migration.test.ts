import { beforeEach, describe, expect, it, vi } from 'vitest'

// Focused pins for ensureSceneSubfolders — the Refresh sweep's v26 layout
// migration (api/generate.ts): root-dwelling scene files move into their own
// subfolders (primary → "primary", extras → sanitized names), every stored
// path repoints, and the definition on disk matches after EVERY move (a
// failure mid-list must leave a consistent character). Same in-memory fs seam
// as move-scenes-folder.test.ts.

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
  async copyFile(a: string, b: string) {
    const v = files.get(norm(a))
    if (v == null) throw new Error(`ENOENT ${a}`)
    files.set(norm(b), v)
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
import { ensureSceneSubfolders } from './api/generate'
import { resolveProject } from './api/core'

beforeEach(() => {
  files.clear()
  dirs.clear()
})

/** Seed `<lib>/Kira` with a LEGACY layout: primary + extras directly in the
 *  scenes root (`daz3d`), with sidecar thumbnails, an avatar sourced from the
 *  primary and a per-scene record on an extra — everything that must travel. */
function seedLegacy(lib: string, opts: { extras?: Array<string> } = {}): Character {
  const sceneDir = `${lib}/Kira/daz3d`
  const extras = opts.extras ?? [`${sceneDir}/Kira_G9_Outfit.duf`]
  const c = characterSchema.parse({
    id: newId(),
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: `${sceneDir}/Kira.duf`,
    extraScenes: extras,
    imageScene: `${sceneDir}/Kira.duf`,
    sceneOverrides: extras.slice(0, 1).map((scenePath) => ({
      scenePath,
      hair: [{ nodeLabel: 'Long Hair' }],
    })),
  })
  addDir(sceneDir)
  files.set(
    `${lib}/Kira/Kira.json`,
    JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  for (const scene of [c.scenePath, ...extras]) {
    files.set(scene, 'duf')
    files.set(`${scene}.tip.png`, 'tip')
  }
  return c
}

async function setup(lib: string) {
  await storage.createProjectManifest(lib, 'P')
  const project = await resolveProject(lib)
  const character = seedLegacy(lib)
  const location = await storage.getCharacterPath(lib, character.id)
  if (!location) throw new Error('seed did not scan')
  return { project, character, location }
}

describe('ensureSceneSubfolders (the Refresh sweep v26 migration)', () => {
  it('moves root-dwelling scenes into their subfolders and repoints everything', async () => {
    const lib = '/games/P'
    const { project, character, location } = await setup(lib)

    const res = await ensureSceneSubfolders(project, lib, character, location)

    expect(res.moved).toBe(2)
    // Primary → "primary"; the extra → its sanitized-filename folder.
    expect(res.character.scenePath).toBe(`${lib}/Kira/daz3d/primary/Kira.duf`)
    expect(res.character.extraScenes).toEqual([`${lib}/Kira/daz3d/Outfit/Kira_G9_Outfit.duf`])
    // The avatar source and the per-scene record follow their scenes.
    expect(res.character.imageScene).toBe(`${lib}/Kira/daz3d/primary/Kira.duf`)
    expect(res.character.sceneOverrides[0].scenePath).toBe(
      `${lib}/Kira/daz3d/Outfit/Kira_G9_Outfit.duf`,
    )
    // Files (with sidecars) physically moved; the originals are gone.
    expect(files.has(`${lib}/Kira/daz3d/primary/Kira.duf`)).toBe(true)
    expect(files.has(`${lib}/Kira/daz3d/primary/Kira.duf.tip.png`)).toBe(true)
    expect(files.has(`${lib}/Kira/daz3d/Kira.duf`)).toBe(false)
    expect(files.has(`${lib}/Kira/daz3d/Kira.duf.tip.png`)).toBe(false)
    // The definition on disk matches the returned character.
    const onDisk = JSON.parse(files.get(`${lib}/Kira/Kira.json`) as string) as Character
    expect(onDisk.scenePath).toBe(res.character.scenePath)
    expect(onDisk.extraScenes).toEqual(res.character.extraScenes)
  })

  it('is idempotent — a second run moves nothing', async () => {
    const lib = '/games/Q'
    const { project, character, location } = await setup(lib)
    const first = await ensureSceneSubfolders(project, lib, character, location)
    const second = await ensureSceneSubfolders(project, lib, first.character, location)
    expect(second.moved).toBe(0)
    expect(second.character.scenePath).toBe(first.character.scenePath)
  })

  it('an extra whose sanitized name collides with "primary" gets a numbered folder', async () => {
    const lib = '/games/R'
    await storage.createProjectManifest(lib, 'R')
    const project = await resolveProject(lib)
    const character = seedLegacy(lib, {
      extras: [`${lib}/Kira/daz3d/Kira_primary.duf`],
    })
    const location = await storage.getCharacterPath(lib, character.id)
    if (!location) throw new Error('seed did not scan')

    const res = await ensureSceneSubfolders(project, lib, character, location)

    expect(res.character.scenePath).toBe(`${lib}/Kira/daz3d/primary/Kira.duf`)
    expect(res.character.extraScenes).toEqual([
      `${lib}/Kira/daz3d/primary (2)/Kira_primary.duf`,
    ])
  })

  it('leaves a linked-in-place scene (outside the character folder) alone', async () => {
    const lib = '/games/S'
    await storage.createProjectManifest(lib, 'S')
    const project = await resolveProject(lib)
    const external = '/elsewhere/Shared_Beach.duf'
    const character = seedLegacy(lib, { extras: [external] })
    files.set(external, 'duf')
    const location = await storage.getCharacterPath(lib, character.id)
    if (!location) throw new Error('seed did not scan')

    const res = await ensureSceneSubfolders(project, lib, character, location)

    // Only the in-root primary moved; the external extra is untouched.
    expect(res.moved).toBe(1)
    expect(res.character.scenePath).toBe(`${lib}/Kira/daz3d/primary/Kira.duf`)
    expect(res.character.extraScenes).toEqual([external])
    expect(files.has(external)).toBe(true)
  })
})
