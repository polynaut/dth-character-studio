import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- In-memory fs mock ----------------------------------------------------
// Enough of @tauri-apps/plugin-fs for the storage/manifest/recents/migration code:
// files + dirs keyed by '/'-normalised absolute paths.

const files = new Map<string, string | Uint8Array>()
const dirs = new Set<string>()
// Paths whose rename (as SOURCE) fails — simulates a locked folder on a share.
const failRenameSrcs = new Set<string>()

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
    if (failRenameSrcs.has(a)) throw new Error(`EBUSY: locked ${a}`)
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
  async copyFile(a: string, b: string) {
    a = norm(a)
    b = norm(b)
    const v = files.get(a)
    if (v == null) throw new Error(`ENOENT ${a}`)
    files.set(b, v)
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
  failRenameSrcs.clear()
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

  it('neutralizes a traversal charactersSubdir in a hostile manifest', async () => {
    // Projects are shared between users — a manifest carrying a `..` path must
    // read back as '' (the project root), never escape it. A normal relative
    // folder survives untouched.
    await storage.createProjectManifest('/games/Evil', 'Evil')
    const m = await storage.readManifest('/games/Evil')
    await storage.writeManifest('/games/Evil', { ...m, charactersSubdir: '../../etc' })
    expect((await storage.readManifest('/games/Evil')).charactersSubdir).toBe('')

    await storage.writeManifest('/games/Evil', { ...m, charactersSubdir: 'C:\\Windows' })
    expect((await storage.readManifest('/games/Evil')).charactersSubdir).toBe('')

    await storage.writeManifest('/games/Evil', { ...m, charactersSubdir: 'assets/characters' })
    expect((await storage.readManifest('/games/Evil')).charactersSubdir).toBe('assets/characters')
  })

  it('throws on a corrupt (unparseable) .dcsp instead of silently returning defaults', async () => {
    // A corrupt manifest must NOT read back as a fresh default project — that
    // would let the next save overwrite the real charactersSubdir/flags, and make
    // fetchProject render a fake empty project instead of surfacing the problem.
    const dcsp = await storage.createProjectManifest('/games/Corrupt', 'Corrupt')
    files.set(norm(dcsp), '{ this is not valid json ')
    await expect(storage.readManifest('/games/Corrupt')).rejects.toThrow(/unreadable or corrupt/i)
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

  it('throws a typed error for an unreachable/nonexistent project folder (no phantom project)', async () => {
    // A stale recents path or offline share must NOT read back as a fresh
    // default project (id '') — fetchProject would render a fake empty project
    // and the sweeps would count it as "0 characters" instead of surfacing it.
    await expect(storage.readManifest('/nowhere')).rejects.toBeInstanceOf(
      storage.ProjectUnreachableError,
    )
    await expect(storage.readManifest('')).rejects.toThrow(/unreachable|does not exist/i)
  })

  it('sanitizes hostile dazSubdir / houdiniSubdir like charactersSubdir (nested stays legit)', async () => {
    await storage.createProjectManifest('/games/Evil', 'Evil')
    const m = await storage.readManifest('/games/Evil')
    await storage.writeManifest('/games/Evil', {
      ...m,
      dazSubdir: '../../outside',
      houdiniSubdir: 'C:\\Windows',
    })
    const hostile = await storage.readManifest('/games/Evil')
    expect(hostile.dazSubdir).toBe('daz3d') // fell back to the default
    expect(hostile.houdiniSubdir).toBe('houdini')

    await storage.writeManifest('/games/Evil', { ...m, dazSubdir: 'scenes/daz' })
    expect((await storage.readManifest('/games/Evil')).dazSubdir).toBe('scenes/daz')
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
    expect(moved.moved).toBe(1)
    expect(moved.repointFailures).toEqual([])
    expect(files.has('/games/Nova/assets/characters/Hero/Hero.json')).toBe(true)
    expect(files.has('/games/Nova/Hero/Hero.json')).toBe(false)

    const back = await storage.moveCharactersRoot('/games/Nova/assets/characters', '/games/Nova')
    expect(back.moved).toBe(1)
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

  it('a mid-move failure rolls the already-moved characters BACK (nothing stranded)', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    seedChar('/games/Nova', 'Hero')
    seedChar('/games/Nova', 'Kira')
    // Kira's folder is locked — its rename fails while Hero's succeeds.
    failRenameSrcs.add('/games/Nova/Kira')

    const result = await storage.moveCharactersRoot('/games/Nova', '/games/Nova/chars')

    expect(result.moveFailures).toHaveLength(1)
    expect(result.moveFailures[0].src).toBe('/games/Nova/Kira')
    expect(result.rolledBack).toBe(true)
    expect(result.moved).toBe(0)
    expect(result.atNewRoot).toBe(0)
    expect(result.atOldRoot).toBe(2)
    // Both characters are whole at the OLD root; the new root holds neither.
    expect(files.has('/games/Nova/Hero/Hero.json')).toBe(true)
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(true)
    expect(files.has('/games/Nova/chars/Hero/Hero.json')).toBe(false)
    expect(files.has('/games/Nova/chars/Kira/Kira.json')).toBe(false)
  })

  it('a failed rollback reports exactly who is stranded where (and repoints them)', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    seedChar('/games/Nova', 'Hero', '/games/Nova/Hero/daz3d/Hero.duf')
    addDir('/games/Nova/Hero/daz3d')
    files.set('/games/Nova/Hero/daz3d/Hero.duf', 'duf')
    seedChar('/games/Nova', 'Kira')
    // Kira's move fails; then Hero's ROLLBACK fails too (locked at the new root).
    failRenameSrcs.add('/games/Nova/Kira')
    failRenameSrcs.add('/games/Nova/chars/Hero')

    const result = await storage.moveCharactersRoot('/games/Nova', '/games/Nova/chars')

    expect(result.moveFailures).toHaveLength(1)
    expect(result.rolledBack).toBe(false)
    expect(result.atNewRoot).toBe(1) // Hero stuck at the new root
    expect(result.atOldRoot).toBe(1) // Kira never left the old one
    expect(files.has('/games/Nova/chars/Hero/Hero.json')).toBe(true)
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(true)
    // The stranded character's in-file paths follow it — it LIVES there now.
    const hero = JSON.parse(files.get('/games/Nova/chars/Hero/Hero.json') as string)
    expect(hero.scenePath).toBe('/games/Nova/chars/Hero/daz3d/Hero.duf')
  })
})

describe('saveProjectSettings on a partially-failed characters-root move', () => {
  it('keeps the OLD charactersSubdir when the move was rolled back, and surfaces the blocker', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const seed = (name: string) => {
      const c = characterSchema.parse({
        id: newId(),
        name,
        genesis: 'G9',
        gender: 'female',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      addDir(`/games/Nova/${name}`)
      files.set(`/games/Nova/${name}/${name}.json`, JSON.stringify(c))
    }
    seed('Hero')
    seed('Kira')
    failRenameSrcs.add('/games/Nova/Kira')

    await expect(
      api.saveProjectSettings({
        data: { projectId: '/games/Nova', charactersSubdir: 'chars' },
      }),
    ).rejects.toThrow(/rolled back/i)

    // The manifest still points at where the characters actually are (the root).
    const manifest = await storage.readManifest('/games/Nova')
    expect(manifest.charactersSubdir).toBe('')
    expect(files.has('/games/Nova/Hero/Hero.json')).toBe(true)
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(true)
  })
})

describe('notes follow the definition', () => {
  // `<Name>.notes.md` derives from the definition filename — every rename/move/
  // delete of a definition must take it along or the notes are orphaned.
  const project = { id: 'p1', name: 'Nova', path: '/games/Nova' }

  function seedKira() {
    const c = characterSchema.parse({
      id: newId(),
      name: 'Kira',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    addDir('/games/Nova/Kira')
    files.set('/games/Nova/Kira/Kira.json', JSON.stringify(c))
    files.set('/games/Nova/Kira/Kira.notes.md', '# backstory')
    return c
  }

  it('saveCharacter renames the notes with the folder + definition', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const c = seedKira()

    await storage.saveCharacter(project, { ...c, name: 'Kira2' })

    expect(files.get('/games/Nova/Kira2/Kira2.notes.md')).toBe('# backstory')
    expect(files.has('/games/Nova/Kira/Kira.notes.md')).toBe(false)
    expect(files.has('/games/Nova/Kira2/Kira.notes.md')).toBe(false)
  })

  it('moveCharacter keeps the notes beside a renamed definition (same folder)', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const c = seedKira()

    await storage.moveCharacter('/games/Nova', c.id, 'Kira/Renamed.json')

    expect(files.get('/games/Nova/Kira/Renamed.notes.md')).toBe('# backstory')
    expect(files.has('/games/Nova/Kira/Kira.notes.md')).toBe(false)
  })

  it('moveCharacter keeps the notes through a folder move + rename', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const c = seedKira()

    await storage.moveCharacter('/games/Nova', c.id, 'Chars/Kira2/Kira2.json')

    expect(files.get('/games/Nova/Chars/Kira2/Kira2.notes.md')).toBe('# backstory')
    expect(files.has('/games/Nova/Kira/Kira.notes.md')).toBe(false)
  })

  it('moveCharactersRoot moves a loose definition WITH its notes', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const c = characterSchema.parse({
      id: newId(),
      name: 'Solo',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    files.set('/games/Nova/Solo.json', JSON.stringify(c))
    files.set('/games/Nova/Solo.notes.md', 'solo notes')

    await storage.moveCharactersRoot('/games/Nova', '/games/Nova/chars')

    expect(files.get('/games/Nova/chars/Solo.notes.md')).toBe('solo notes')
    expect(files.has('/games/Nova/Solo.notes.md')).toBe(false)
  })

  it('deleteCharacter removes a loose definition together with its notes', async () => {
    await storage.createProjectManifest('/games/Nova', 'Nova')
    const c = characterSchema.parse({
      id: newId(),
      name: 'Solo',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    files.set('/games/Nova/Solo.json', JSON.stringify(c))
    files.set('/games/Nova/Solo.notes.md', 'solo notes')

    await storage.deleteCharacter('/games/Nova', c.id)

    expect(files.has('/games/Nova/Solo.json')).toBe(false)
    expect(files.has('/games/Nova/Solo.notes.md')).toBe(false)
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

describe('refresh / detection scope (uniform across windows)', () => {
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

  it('a project window ALSO spans every known project (same button, same meaning)', async () => {
    await seedProject('/games/Alpha', 'Alpha')
    await seedProject('/games/Beta', 'Beta')
    api.setActiveProjectDir('/games/Alpha')

    const report = await api.detectAssetVersions()
    expect(report.total).toBe(2)
    expect(report.characters.map((c) => c.project).sort()).toEqual(['Alpha', 'Beta'])
  })

  it('the active project is swept even when it is missing from recents', async () => {
    await seedProject('/games/Alpha', 'Alpha')
    // Gamma exists on disk but was never remembered (e.g. recents pruned).
    await storage.createProjectManifest('/games/Gamma', 'Gamma')
    const c = characterSchema.parse({
      id: newId(),
      name: 'GammaChar',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    addDir('/games/Gamma/GammaChar')
    files.set('/games/Gamma/GammaChar/GammaChar.json', JSON.stringify(c))
    api.setActiveProjectDir('/games/Gamma')

    const report = await api.detectAssetVersions()
    expect(report.characters.map((r) => r.project).sort()).toEqual(['Alpha', 'Gamma'])
  })
})
