import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- In-memory fs mock ----------------------------------------------------
// Enough of @tauri-apps/plugin-fs for the storage/manifest/recents/migration code:
// files + dirs keyed by '/'-normalised absolute paths.

const files = new Map<string, string | Uint8Array>()
const dirs = new Set<string>()

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/g, '')
}
function addDir(p: string): void {
  // Add the path and every ancestor, preserving a leading slash for absolute paths.
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
    p = norm(p)
    files.delete(p)
    dirs.delete(p)
    if (opts?.recursive) {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k)
      for (const k of [...dirs]) if (k.startsWith(`${p}/`)) dirs.delete(k)
    }
  },
  async rename(a: string, b: string) {
    a = norm(a)
    b = norm(b)
    const remap = (k: string) => b + k.slice(a.length)
    // Move the entry itself or any descendant — handles both a file and a whole
    // directory subtree (what moveCharactersRoot relies on).
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

import { characterSchema, newId } from '@dth/rom'
import * as storage from './storage'
import * as api from './api'
import { migrateProjects } from './migrate-projects'

beforeEach(() => {
  files.clear()
  dirs.clear()
})

describe('project manifest (.dcsp)', () => {
  it('creates a manifest + .dcsmeta and reads it back', async () => {
    const dcsp = await storage.createProjectManifest('/games/Nova', 'Nova')
    expect(dcsp).toBe('/games/Nova/Nova.dcsp')
    expect(await storage.findManifestPath('/games/Nova')).toBe(dcsp)
    expect(dirs.has('/games/Nova/.dcsmeta/images')).toBe(true)

    const m = await storage.readManifest('/games/Nova')
    expect(m.name).toBe('Nova')
    expect(m.id).toBeTruthy()
    expect(m.dazSubdir).toBe('daz3d')
    expect(m.houdiniSubdir).toBe('houdini')
    expect(m.createHoudiniSubdir).toBe(true)
    // New per-project fields default to "characters only, at the project root".
    expect(m.assetsEnabled).toBe(false)
    expect(m.dazProductsEnabled).toBe(false)
    expect(m.charactersSubdir).toBe('')
  })

  it('round-trips the assets flag + characters subfolder', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const m = await storage.readManifest('/games/Nova')
    await storage.writeManifest('/games/Nova', {
      ...m,
      assetsEnabled: true,
      charactersSubdir: 'assets/characters',
    })
    const after = await storage.readManifest('/games/Nova')
    expect(after.assetsEnabled).toBe(true)
    expect(after.charactersSubdir).toBe('assets/characters')
  })

  it('writeManifest reuses the existing .dcsp file name on rename', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const m = await storage.readManifest('/games/Nova')
    await storage.writeManifest('/games/Nova', { ...m, name: 'Renamed', dazSubdir: 'scenes' })
    // Same file (named at creation), new contents.
    expect(await storage.findManifestPath('/games/Nova')).toBe('/games/Nova/Nova.dcsp')
    const after = await storage.readManifest('/games/Nova')
    expect(after.name).toBe('Renamed')
    expect(after.dazSubdir).toBe('scenes')
  })

  it('defaults a missing manifest to the folder name', async () => {
    addDir('/games/Empty')
    const m = await storage.readManifest('/games/Empty')
    expect(m.name).toBe('Empty')
    expect(m.dazSubdir).toBe('daz3d')
  })
})

describe('recent projects', () => {
  it('is newest-first, de-duplicates, and caps at 12', async () => {
    for (let i = 0; i < 15; i++) await storage.rememberRecent(`/p/${i}/P${i}.dcsp`, `P${i}`)
    const r = await storage.listRecents()
    expect(r.length).toBe(12)
    expect(r[0].path).toBe('/p/14/P14.dcsp')

    await storage.rememberRecent('/p/14/P14.dcsp', 'P14')
    const r2 = await storage.listRecents()
    expect(r2.filter((x) => x.path === '/p/14/P14.dcsp').length).toBe(1)
    expect(r2[0].path).toBe('/p/14/P14.dcsp')
  })

  it('forgetRecent removes only the named entry', async () => {
    await storage.rememberRecent('/p/a/A.dcsp', 'A')
    await storage.rememberRecent('/p/b/B.dcsp', 'B')
    await storage.forgetRecent('/p/a/A.dcsp')
    const r = await storage.listRecents()
    expect(r.map((x) => x.path)).toEqual(['/p/b/B.dcsp'])
  })
})

describe('moveCharactersRoot', () => {
  function seedChar(dir: string, name: string, scenePath?: string): void {
    const c = characterSchema.parse({
      id: newId(),
      name,
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(scenePath ? { scenePath } : {}),
    })
    addDir(`${dir}/${name}`)
    files.set(`${dir}/${name}/${name}.json`, JSON.stringify(c))
  }

  it('moves character folders into a new subfolder and back', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    seedChar('/games/Nova', 'Hero')

    const moved = await storage.moveCharactersRoot('/games/Nova', '/games/Nova/assets/characters')
    expect(moved).toBe(1)
    expect(files.has('/games/Nova/assets/characters/Hero/Hero.json')).toBe(true)
    expect(files.has('/games/Nova/Hero/Hero.json')).toBe(false)

    const back = await storage.moveCharactersRoot('/games/Nova/assets/characters', '/games/Nova')
    expect(back).toBe(1)
    expect(files.has('/games/Nova/Hero/Hero.json')).toBe(true)
    expect(files.has('/games/Nova/assets/characters/Hero/Hero.json')).toBe(false)
  })

  it('repoints a scene path that lived inside the moved folder', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    seedChar('/games/Nova', 'Kira', '/games/Nova/Kira/daz3d/Kira.duf')
    addDir('/games/Nova/Kira/daz3d')
    files.set('/games/Nova/Kira/daz3d/Kira.duf', 'duf')

    await storage.moveCharactersRoot('/games/Nova', '/games/Nova/chars')

    expect(files.has('/games/Nova/chars/Kira/daz3d/Kira.duf')).toBe(true)
    const moved = JSON.parse(files.get('/games/Nova/chars/Kira/Kira.json') as string)
    expect(moved.scenePath).toBe('/games/Nova/chars/Kira/daz3d/Kira.duf')
  })
})

describe('migrateProjects', () => {
  function seedCharacter(dir: string, name: string, image: string): void {
    const c = characterSchema.parse({
      id: newId(),
      name,
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      image,
    })
    addDir(`${dir}/${name}`)
    files.set(`${dir}/${name}/${name}.json`, JSON.stringify(c))
  }

  it('writes manifests, moves avatars to .dcsmeta, builds recents, removes old state', async () => {
    // Legacy app-data: a registry, behaviour settings, and an avatar in images/.
    files.set('/appdata/projects.json', JSON.stringify([{ id: 'p1', name: 'Old', path: '/games/Old' }]))
    files.set(
      '/appdata/settings.json',
      JSON.stringify({ dazLibraryFolder: '', dazSubdir: 'scenes', houdiniSubdir: 'hou', createHoudiniSubdir: false }),
    )
    addDir('/games/Old')
    seedCharacter('/games/Old', 'Hero', 'cid-1.png')
    addDir('/appdata/images')
    files.set('/appdata/images/cid-1.png', new Uint8Array([1, 2, 3]))

    await migrateProjects()

    // A manifest seeded from the old settings.
    const m = await storage.readManifest('/games/Old')
    expect(m.name).toBe('Old')
    expect(m.dazSubdir).toBe('scenes')
    expect(m.houdiniSubdir).toBe('hou')
    expect(m.createHoudiniSubdir).toBe(false)

    // Avatar moved into the project's .dcsmeta/images; old copy gone.
    expect(files.has('/games/Old/.dcsmeta/images/cid-1.png')).toBe(true)
    expect(files.has('/appdata/images/cid-1.png')).toBe(false)

    // Recents records it; legacy state removed; settings stripped.
    const recents = await storage.listRecents()
    expect(recents.map((r) => r.name)).toContain('Old')
    expect(files.has('/appdata/projects.json')).toBe(false)
    expect(dirs.has('/appdata/images')).toBe(false)
    const settings = JSON.parse(files.get('/appdata/settings.json') as string)
    expect('dazSubdir' in settings).toBe(false)

    // Idempotent: a second run is a no-op (projects.json is gone).
    await migrateProjects()
    expect(files.has('/appdata/projects.json')).toBe(false)
  })

  it('does nothing without a legacy projects.json', async () => {
    await migrateProjects()
    expect(await storage.listRecents()).toEqual([])
  })
})

describe('refresh / detection scope (per window)', () => {
  // Two known projects, each with one character. Characters parsed by
  // characterSchema carry the current schema, so they're never "stale"; we assert
  // on which projects the sweep covers, not on staleness. detectAssetVersions and
  // refreshAllAssets share the same projectsForSweep() enumeration, so detection
  // stands in for both.
  async function seedProject(dir: string, name: string): Promise<void> {
    await storage.createProjectManifest(dir, name)
    await storage.rememberRecent(`${dir}/${name}.dcsp`, name)
    const c = characterSchema.parse({
      id: newId(),
      name: `${name}Char`,
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    addDir(`${dir}/${name}Char`)
    files.set(`${dir}/${name}Char/${name}Char.json`, JSON.stringify(c))
  }

  beforeEach(() => {
    api.setActiveProjectDir('') // reset the module-level active project between cases
  })

  it('Home window (no active project) spans every known project', async () => {
    await seedProject('/games/Alpha', 'Alpha')
    await seedProject('/games/Beta', 'Beta')

    const report = await api.detectAssetVersions()
    expect(report.total).toBe(2)
    expect(report.characters.map((c) => c.project).sort()).toEqual(['Alpha', 'Beta'])
  })

  it('project window scopes to the active project only', async () => {
    await seedProject('/games/Alpha', 'Alpha')
    await seedProject('/games/Beta', 'Beta')
    api.setActiveProjectDir('/games/Alpha')

    const report = await api.detectAssetVersions()
    expect(report.total).toBe(1)
    expect(report.characters.map((c) => c.project)).toEqual(['Alpha'])
  })
})
