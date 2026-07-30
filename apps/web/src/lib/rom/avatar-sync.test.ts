import { beforeEach, describe, expect, it, vi } from 'vitest'

// The avatar↔scene sync had two SILENT dead ends (a user hit both at once by
// re-saving their primary scene in Daz — the card's tip updated, the header
// avatar never did):
//  1. `imageScene` was matched against the linked scenes by EXACT string — a
//     separator/case difference (folder moves, manual edits) killed the sync
//     forever.
//  2. A character without provenance whose scene tip was ALREADY overwritten
//     could never byte-match-adopt a source. An 'sc'-kind avatar provably came
//     from a scene once, so it now adopts the primary and re-syncs.

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

import { CHARACTER_SCHEMA_VERSION, characterSchema, defaultSections } from '@dth/rom'
import * as storage from './storage'
import { avatarFileName, parseAvatarName } from './avatar-names'
import { setActiveProjectDir } from './api/core'
import { syncAvatarWithScene } from './api/characters'

const PROJECT = '/games/P'

beforeEach(async () => {
  files.clear()
  dirs.clear()
  await storage.createProjectManifest(PROJECT, 'P')
  setActiveProjectDir(PROJECT)
})

/** Seed a character (folder + JSON) plus its scene's tip and stored avatar. */
function seed(opts: {
  id: string
  name: string
  imageScene: string
  image: string
  tipBytes: string
  avatarBytes: string
}): void {
  const scenePath = `${PROJECT}/${opts.name}/daz3d/${opts.name}.duf`
  const c = characterSchema.parse({
    id: opts.id,
    name: opts.name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections: defaultSections(),
    scenePath,
    image: opts.image,
    imageScene: opts.imageScene,
  })
  addDir(`${PROJECT}/${opts.name}`)
  files.set(
    `${PROJECT}/${opts.name}/${opts.name}.json`,
    JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  files.set(`${scenePath}.tip.png`, opts.tipBytes)
  addDir(`${PROJECT}/.dcsmeta/images`)
  if (opts.image) files.set(`${PROJECT}/.dcsmeta/images/${opts.image}`, opts.avatarBytes)
}

describe('syncAvatarWithScene', () => {
  it('a separator-mismatched imageScene still syncs (normalized membership)', async () => {
    const image = avatarFileName('c1', 'sc', 100, 'png')
    seed({
      id: 'c1',
      name: 'Ita',
      // BACKSLASH provenance vs the forward-slash scenePath — the exact-string
      // compare used to bail here forever.
      imageScene: `${PROJECT}/Ita/daz3d/Ita.duf`.replace(/\//g, '\\'),
      image,
      tipBytes: 'NEW-TIP',
      avatarBytes: 'OLD-TIP',
    })

    const changed = await syncAvatarWithScene({ data: { projectId: PROJECT, id: 'c1' } })
    expect(changed).not.toBeNull()
    expect(parseAvatarName(changed!.image!)?.kind).toBe('sc')
    // The rewritten avatar carries the DRIFTED tip's bytes.
    const dir = `${PROJECT}/.dcsmeta/images`
    expect(new TextDecoder().decode(files.get(`${dir}/${changed!.image!}`) as Uint8Array)).toBe(
      'NEW-TIP',
    )
  })

  it("an 'sc' avatar without provenance adopts the PRIMARY when no tip byte-matches", async () => {
    const image = avatarFileName('c2', 'sc', 100, 'png')
    // The tip was overwritten BEFORE provenance existed: no byte-match possible.
    seed({
      id: 'c2',
      name: 'Vera',
      imageScene: '',
      image,
      tipBytes: 'OVERWRITTEN-TIP',
      avatarBytes: 'ORIGINAL-TIP',
    })
    const changed = await syncAvatarWithScene({ data: { projectId: PROJECT, id: 'c2' } })
    expect(changed).not.toBeNull()
    expect(changed!.imageScene).toBe(`${PROJECT}/Vera/daz3d/Vera.duf`)
    const dir = `${PROJECT}/.dcsmeta/images`
    expect(new TextDecoder().decode(files.get(`${dir}/${changed!.image!}`) as Uint8Array)).toBe(
      'OVERWRITTEN-TIP',
    )
  })

  it('a byte-MATCHING tip still adopts provenance only (no avatar rewrite)', async () => {
    const image = avatarFileName('c3', 'sc', 100, 'png')
    seed({
      id: 'c3',
      name: 'Mara',
      imageScene: '',
      image,
      tipBytes: 'SAME-TIP',
      avatarBytes: 'SAME-TIP',
    })
    const changed = await syncAvatarWithScene({ data: { projectId: PROJECT, id: 'c3' } })
    expect(changed).toEqual({ imageScene: `${PROJECT}/Mara/daz3d/Mara.duf` })
  })

  it("an 'sc' avatar whose source LEFT the linked list adopts the primary", async () => {
    // The replaced-primary case: imageScene still points at the departed scene
    // (a relink whose tip copy failed left it stale) — the sync used to bail
    // here forever while the header kept the old look.
    const image = avatarFileName('c5', 'sc', 100, 'png')
    seed({
      id: 'c5',
      name: 'Ilse',
      imageScene: 'X:/old-library/Step06_Ilse.duf',
      image,
      tipBytes: 'REPLACED-PRIMARY-TIP',
      avatarBytes: 'OLD-PRIMARY-TIP',
    })
    const changed = await syncAvatarWithScene({ data: { projectId: PROJECT, id: 'c5' } })
    expect(changed).not.toBeNull()
    expect(changed!.imageScene).toBe(`${PROJECT}/Ilse/daz3d/Ilse.duf`)
    const dir = `${PROJECT}/.dcsmeta/images`
    expect(new TextDecoder().decode(files.get(`${dir}/${changed!.image!}`) as Uint8Array)).toBe(
      'REPLACED-PRIMARY-TIP',
    )
  })

  it("an upload ('up' kind) whose source left the linked list stays untouched", async () => {
    const image = avatarFileName('c6', 'up', 100, 'png')
    seed({
      id: 'c6',
      name: 'Oda',
      imageScene: 'X:/old-library/Step06_Oda.duf',
      image,
      tipBytes: 'SCENE-TIP',
      avatarBytes: 'USERS-UPLOAD',
    })
    expect(await syncAvatarWithScene({ data: { projectId: PROJECT, id: 'c6' } })).toBeNull()
  })

  it("an upload ('up' kind) without provenance is never touched", async () => {
    const image = avatarFileName('c4', 'up', 100, 'png')
    seed({
      id: 'c4',
      name: 'Nadja',
      imageScene: '',
      image,
      tipBytes: 'SCENE-TIP',
      avatarBytes: 'USERS-UPLOAD',
    })
    expect(await syncAvatarWithScene({ data: { projectId: PROJECT, id: 'c4' } })).toBeNull()
  })
})
