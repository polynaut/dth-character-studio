import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- In-memory fs mock ----------------------------------------------------
// Same shape as project-files.test.ts: enough of @tauri-apps/plugin-fs for the
// storage code — files + dirs keyed by '/'-normalised absolute paths.

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
  // A vi.fn so individual tests can stub a native command's return (e.g. the
  // pose scan's `scan_duf_files`) with a one-shot mockResolvedValueOnce.
  invoke: vi.fn(async () => null),
  isTauri: () => false,
  convertFileSrc: (p: string) => p,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    // Case-INSENSITIVE like Windows/NTFS (what the storage code targets): a
    // case-only rename's destination "exists" — it IS the source. The other
    // ops stay exact-case; tests seed consistent casing.
    const t = norm(p).toLowerCase()
    for (const k of files.keys()) if (k.toLowerCase() === t) return true
    for (const k of dirs) if (k.toLowerCase() === t) return true
    return false
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
import type { Character } from '@dth/rom'
import * as storage from './storage'
import type { StudioSettings } from './storage'

beforeEach(() => {
  files.clear()
  dirs.clear()
})

describe('settings (settings.json)', () => {
  const defaults: StudioSettings = {
    dazLibraryFolder: '',
    dthPosesFolder: '',
    currentDthVersion: '',
    dthExporterFolder: '',
    currentDthExporterVersion: '',
    dazInstallFolder: '',
    houdiniDocsFolder: '',
    extraHoudiniDocsFolders: [],
    dimManifestsFolder: '',
    dazAssetsFolders: [],
    dazMorphsSource: '',
    dazMorphsDest: '',
    dazPresetsSource: '',
    dazPresetsDest: '',
    houdiniPresetsSource: '',
    acceptedConflicts: [],
    dedupQuarantineFolder: '',
    dazUninstallFolders: [],
  }

  it('returns defaults when settings.json is missing', async () => {
    expect(await storage.getSettings()).toEqual(defaults)
  })

  it('returns defaults when settings.json is corrupt', async () => {
    addDir('/appdata')
    files.set('/appdata/settings.json', 'not json {')
    expect(await storage.getSettings()).toEqual(defaults)
  })

  it('falls back per-field when a stored field has the wrong type', async () => {
    addDir('/appdata')
    files.set(
      '/appdata/settings.json',
      JSON.stringify({ dazLibraryFolder: 'X:/daz', dazAssetsFolders: 'nope', acceptedConflicts: 42 }),
    )
    const s = await storage.getSettings()
    expect(s.dazLibraryFolder).toBe('X:/daz')
    expect(s.dazAssetsFolders).toEqual([])
    expect(s.acceptedConflicts).toEqual([])
  })

  it('round-trips a save → read', async () => {
    const custom: StudioSettings = {
      dazLibraryFolder: 'X:/My DAZ 3D Library',
      dthPosesFolder: 'X:/dth/releases',
      currentDthVersion: '2.4.3',
      dthExporterFolder: 'X:/dth/exporter',
      currentDthExporterVersion: '1.0.0.1',
      dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio4',
      houdiniDocsFolder: 'D:/Documents/houdini20.5',
      extraHoudiniDocsFolders: ['D:/Documents/houdini19.5'],
      dimManifestsFolder: 'C:/Users/Public/Documents/DAZ 3D/InstallManager/ManifestFiles',
      dazAssetsFolders: ['X:/assets/a', 'X:/assets/b'],
      dazMorphsSource: 'X:/morphs',
      dazMorphsDest: 'X:/My Library/data/Daz 3D',
      dazPresetsSource: 'X:/presets',
      dazPresetsDest: 'X:/My Library/Presets',
      houdiniPresetsSource: 'X:/my_presets',
      acceptedConflicts: ['Runtime/Textures/shared.png'],
      dedupQuarantineFolder: 'X:/quarantine',
      dazUninstallFolders: ['X:/daz/uninstall-me'],
    }
    await storage.saveSettings(custom)
    expect(await storage.getSettings()).toEqual(custom)
  })

  it('merges by baseline: only the caller-changed fields win over the disk state', async () => {
    // Two windows loaded the same baseline (one project per window shares the file).
    const baseline = await storage.getSettings()
    // Window B saves its edit first…
    await storage.saveSettings({ ...baseline, dazMorphsSource: 'X:/morphs' })
    // …then window A saves a DIFFERENT edit against the stale baseline. The old
    // whole-object write silently reverted B's field; the merge keeps both.
    await storage.saveSettings({ ...baseline, dazLibraryFolder: 'X:/lib' }, baseline)
    const merged = await storage.getSettings()
    expect(merged.dazLibraryFolder).toBe('X:/lib')
    expect(merged.dazMorphsSource).toBe('X:/morphs')
  })

  it('flags an existing-but-corrupt settings.json for the one-time startup notice', async () => {
    addDir('/appdata')
    files.set('/appdata/settings.json', 'not json {')
    await storage.getSettings()
    expect(storage.consumeSettingsFileCorrupt()).toBe(true)
    // One-shot: consuming clears it.
    expect(storage.consumeSettingsFileCorrupt()).toBe(false)
    // A merely MISSING file is a fresh install, never flagged.
    files.delete('/appdata/settings.json')
    await storage.getSettings()
    expect(storage.consumeSettingsFileCorrupt()).toBe(false)
  })
})

describe('character library scan', () => {
  function seedChar(defPath: string, name: string): Character {
    const c = characterSchema.parse({
      id: newId(),
      name,
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const dir = defPath.slice(0, defPath.lastIndexOf('/'))
    addDir(dir)
    files.set(defPath, JSON.stringify(c))
    return c
  }

  it('finds folder-backed, nested and loose definitions; skips non-character JSON', async () => {
    const hero = seedChar('/games/Nova/Hero/Hero.json', 'Hero')
    const deep = seedChar('/games/Nova/Group/Deep/Deep.json', 'Deep')
    const solo = seedChar('/games/Nova/Solo.json', 'Solo')
    // Generated sidecar JSON that is not a character definition — must be skipped.
    files.set('/games/Nova/Hero/Hero_FBMs.json', JSON.stringify({ frames: [1, 2, 3] }))

    const listed = await storage.listCharacters('/games/Nova')
    expect(listed.map((c) => c.name)).toEqual(['Deep', 'Hero', 'Solo'])

    const heroLoc = await storage.getCharacterPath('/games/Nova', hero.id)
    expect(heroLoc?.relFolder).toBe('Hero')
    expect(heroLoc?.folderAbs).toBe('/games/Nova/Hero')
    expect(heroLoc?.definitionAbs).toBe('/games/Nova/Hero/Hero.json')

    const deepLoc = await storage.getCharacterPath('/games/Nova', deep.id)
    expect(deepLoc?.relFolder).toBe('Group/Deep')

    // A loose definition's "folder" is the library root itself.
    const soloLoc = await storage.getCharacterPath('/games/Nova', solo.id)
    expect(soloLoc?.relFolder).toBe('')
    expect(soloLoc?.folderAbs).toBe('/games/Nova')
  })

  it('returns an empty list for a missing or empty library', async () => {
    expect(await storage.listCharacters('/nowhere')).toEqual([])
    addDir('/games/Empty')
    expect(await storage.listCharacters('/games/Empty')).toEqual([])
  })

  it('surfaces a torn definition as a scan problem instead of silently skipping it', async () => {
    seedChar('/games/Nova/Hero/Hero.json', 'Hero')
    addDir('/games/Nova/Kira')
    files.set('/games/Nova/Kira/Kira.json', '{ "id": "torn-mid-wri') // torn write

    const scan = await storage.scanCharacterLibrary('/games/Nova')
    expect(scan.entries.map((e) => e.character.name)).toEqual(['Hero'])
    expect(scan.problems).toHaveLength(1)
    expect(scan.problems[0].path).toBe('/games/Nova/Kira/Kira.json')
    expect(scan.problems[0].reason).toMatch(/JSON/i)
    // The plain list keeps its shape — problems surface via the parallel channel.
    expect((await storage.listCharacters('/games/Nova')).map((c) => c.name)).toEqual(['Hero'])
  })

  it('surfaces a definition-shaped JSON that fails the schema, but not foreign JSON', async () => {
    seedChar('/games/Nova/Hero/Hero.json', 'Hero')
    // Definition-shaped (id + name + genesis) but invalid → a problem.
    files.set(
      '/games/Nova/Bad/Bad.json',
      JSON.stringify({ id: 'x', name: 'Bad', genesis: 'G99', gender: 'female' }),
    )
    addDir('/games/Nova/Bad')
    // Foreign JSON (generated sidecar) → silently skipped, never a problem.
    files.set('/games/Nova/Hero/Hero_FBMs.json', JSON.stringify({ frames: [1, 2] }))

    const scan = await storage.scanCharacterLibrary('/games/Nova')
    expect(scan.problems).toHaveLength(1)
    expect(scan.problems[0].path).toBe('/games/Nova/Bad/Bad.json')
    expect(scan.problems[0].reason).toMatch(/schema/i)
  })

  it('never reports app-internal / transport JSONs as problems (they may be mid-write)', async () => {
    seedChar('/games/Nova/Hero/Hero.json', 'Hero')
    files.set('/games/Nova/Hero/dth_rom_run_log.json', '{ torn') // Daz writing it right now
    files.set('/games/Nova/Hero/.last_rom_run.json', '{ torn') // app-internal store

    const scan = await storage.scanCharacterLibrary('/games/Nova')
    expect(scan.problems).toEqual([])
  })
})

describe('saveCharacter with a corrupt existing definition', () => {
  const project = { id: 'p1', name: 'Nova', path: '/games/Nova' }

  it('refuses to fork a "Name (2)" duplicate beside a torn definition', async () => {
    // The character's own definition is torn — the scan can't see it, so the
    // save would have treated the folder as free and forked "Kira (2)".
    addDir('/games/Nova/Kira')
    files.set('/games/Nova/Kira/Kira.json', '{ torn')
    const kira = characterSchema.parse({
      id: newId(),
      name: 'Kira',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    await expect(storage.saveCharacter(project, kira)).rejects.toThrow(/unreadable/i)
    // No fork, no new definition anywhere; the corrupt file is untouched.
    expect(dirs.has('/games/Nova/Kira (2)')).toBe(false)
    expect(files.get('/games/Nova/Kira/Kira.json')).toBe('{ torn')
    expect([...files.keys()].filter((k) => k.toLowerCase().endsWith('kira.json'))).toEqual([
      '/games/Nova/Kira/Kira.json',
    ])
  })

  it('a corrupt LOOSE definition at the library root also blocks the save', async () => {
    addDir('/games/Nova')
    files.set('/games/Nova/Solo.json', 'not json')
    const solo = characterSchema.parse({
      id: newId(),
      name: 'Solo',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await expect(storage.saveCharacter(project, solo)).rejects.toThrow(/unreadable/i)
    expect(dirs.has('/games/Nova/Solo')).toBe(false)
  })

  it('an unrelated corrupt file elsewhere does NOT block saving a new character', async () => {
    addDir('/games/Nova/Other')
    files.set('/games/Nova/Other/Other.json', '{ torn')
    const hero = characterSchema.parse({
      id: newId(),
      name: 'Hero',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await storage.saveCharacter(project, hero)
    expect(files.has('/games/Nova/Hero/Hero.json')).toBe(true)
  })
})

describe('moveCharacter', () => {
  function seedMovable(name: string, folder: string): Character {
    const c = characterSchema.parse({
      id: newId(),
      name,
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      scenePath: `/games/Nova/${folder}/daz3d/${name}.duf`,
    })
    addDir(`/games/Nova/${folder}/daz3d`)
    files.set(`/games/Nova/${folder}/${name}.json`, JSON.stringify(c))
    files.set(`/games/Nova/${folder}/daz3d/${name}.duf`, 'duf')
    return c
  }

  it('a case-only rename (kira → Kira) renames in place instead of throwing "already exists"', async () => {
    const c = seedMovable('kira', 'kira')

    const moved = await storage.moveCharacter('/games/Nova', c.id, 'Kira/Kira.json')

    // The folder + definition carry the new casing; nothing forked to "Kira (2)".
    expect(moved.location.definitionAbs).toBe('/games/Nova/Kira/Kira.json')
    expect(moved.location.folderAbs).toBe('/games/Nova/Kira')
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(true)
    expect(files.has('/games/Nova/kira/kira.json')).toBe(false)
    expect([...dirs].some((d) => d.includes('(2)'))).toBe(false)
    // In-folder paths travelled with the re-cased folder.
    expect(moved.character.scenePath).toBe('/games/Nova/Kira/daz3d/kira.duf')
  })

  it('a genuine collision with an existing folder still throws', async () => {
    const c = seedMovable('kira', 'kira')
    addDir('/games/Nova/Hero')
    await expect(
      storage.moveCharacter('/games/Nova', c.id, 'Hero/kira.json'),
    ).rejects.toThrow(/already exists/i)
    // Nothing moved.
    expect(files.has('/games/Nova/kira/kira.json')).toBe(true)
  })

  it('a plain folder move still repoints the in-folder paths', async () => {
    const c = seedMovable('kira', 'kira')

    const moved = await storage.moveCharacter('/games/Nova', c.id, 'Outfits/kira/kira.json')

    expect(moved.location.folderAbs).toBe('/games/Nova/Outfits/kira')
    expect(files.has('/games/Nova/Outfits/kira/kira.json')).toBe(true)
    expect(moved.character.scenePath).toBe('/games/Nova/Outfits/kira/daz3d/kira.duf')
  })
})

describe('deleteCharacter', () => {
  function seedKira(): Character {
    const c = characterSchema.parse({
      id: newId(),
      name: 'Kira',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    addDir('/games/Nova/Kira/daz3d')
    addDir('/games/Nova/Kira/houdini')
    files.set('/games/Nova/Kira/Kira.json', JSON.stringify(c))
    files.set('/games/Nova/Kira/Kira_G9.dsa', 'script')
    files.set('/games/Nova/Kira/daz3d/Kira.duf', 'duf')
    return c
  }

  it('removes the whole character folder by default', async () => {
    const c = seedKira()

    await storage.deleteCharacter('/games/Nova', c.id)

    expect(dirs.has('/games/Nova/Kira')).toBe(false)
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(false)
    expect(files.has('/games/Nova/Kira/daz3d/Kira.duf')).toBe(false)
    // The library itself is untouched.
    expect(dirs.has('/games/Nova')).toBe(true)
  })

  it('keepFolders preserves the named subfolders and removes everything else', async () => {
    const c = seedKira()

    await storage.deleteCharacter('/games/Nova', c.id, { keepFolders: ['daz3d'] })

    // Kept subfolder survives with its contents; the character folder stays.
    expect(dirs.has('/games/Nova/Kira/daz3d')).toBe(true)
    expect(files.get('/games/Nova/Kira/daz3d/Kira.duf')).toBe('duf')
    // Everything else at the top level is gone.
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(false)
    expect(files.has('/games/Nova/Kira/Kira_G9.dsa')).toBe(false)
    expect(dirs.has('/games/Nova/Kira/houdini')).toBe(false)
  })

  it('is a no-op for an unknown id', async () => {
    seedKira()
    await storage.deleteCharacter('/games/Nova', 'no-such-id')
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(true)
  })

  it('keepFolders handles a NESTED subdir: keeps exactly that subtree', async () => {
    const c = seedKira()
    // A project configured with dazSubdir 'scenes/daz': the scenes live nested.
    addDir('/games/Nova/Kira/scenes/daz')
    files.set('/games/Nova/Kira/scenes/daz/Kira.duf', 'duf')
    files.set('/games/Nova/Kira/scenes/other.duf', 'other')

    await storage.deleteCharacter('/games/Nova', c.id, { keepFolders: ['scenes/daz'] })

    // The kept nested subtree survives WITH its contents…
    expect(dirs.has('/games/Nova/Kira/scenes/daz')).toBe(true)
    expect(files.get('/games/Nova/Kira/scenes/daz/Kira.duf')).toBe('duf')
    // …its siblings inside `scenes` are removed (the old basename-only matching
    // deleted all of `scenes`, taking the supposedly-kept Daz files with it)…
    expect(files.has('/games/Nova/Kira/scenes/other.duf')).toBe(false)
    // …and everything else in the character folder is gone.
    expect(files.has('/games/Nova/Kira/Kira.json')).toBe(false)
    expect(dirs.has('/games/Nova/Kira/houdini')).toBe(false)
  })
})

describe('repointCharacterPaths', () => {
  it('repoints every in-folder path — including per-section customAssetPath', () => {
    const c = characterSchema.parse({
      id: newId(),
      name: 'Kira',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      scenePath: '/games/Nova/kira/daz3d/kira.duf',
    })
    // A custom base ROM copied INTO the character folder must travel with it —
    // it was the one path field the single repoint site omitted.
    c.sections.JCM.mode = 'custom'
    c.sections.JCM.customAssetPath = '/games/Nova/kira/daz3d/Custom Base.duf'
    // A custom asset linked in place OUTSIDE the folder stays untouched.
    c.sections.PHY.customAssetPath = 'X:/shared/roms/Physics.duf'

    const moved = storage.repointCharacterPaths(c, '/games/Nova/kira', '/games/Nova/Kira2')

    expect(moved.scenePath).toBe('/games/Nova/Kira2/daz3d/kira.duf')
    expect(moved.sections.JCM.customAssetPath).toBe('/games/Nova/Kira2/daz3d/Custom Base.duf')
    expect(moved.sections.PHY.customAssetPath).toBe('X:/shared/roms/Physics.duf')
  })
})

describe('saveCharacter returns the post-save location', () => {
  const project = { id: 'p1', name: 'Nova', path: '/games/Nova' }

  it('a rename reports the NEW folder/definition (so callers can cache it)', async () => {
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

    const saved = await storage.saveCharacter(project, { ...c, name: 'Nova Kira' })

    expect(saved.character.name).toBe('Nova Kira')
    expect(saved.location).toEqual({
      definitionAbs: '/games/Nova/Nova Kira/Nova Kira.json',
      folderAbs: '/games/Nova/Nova Kira',
      relFolder: 'Nova Kira',
      libraryFolder: '/games/Nova',
    })
    // The location is live: the definition actually sits there.
    expect(files.has('/games/Nova/Nova Kira/Nova Kira.json')).toBe(true)
  })
})

describe('known network drives (network-drives.json)', () => {
  it('overlapping mutations merge instead of clobbering (serialized queue)', async () => {
    // Two un-awaited mutations in flight at once: the unlocked read-modify-write
    // this replaces had both read the empty file and the second write dropped
    // the first entry.
    await Promise.all([
      storage.rememberDrive('x:', '\\\\host\\a'),
      storage.rememberDrive('Y:', '\\\\host\\b'),
    ])
    expect(await storage.listKnownDrives()).toEqual([
      { drive: 'X:', unc: '\\\\host\\a' },
      { drive: 'Y:', unc: '\\\\host\\b' },
    ])

    // A forget racing a remember: both land.
    await Promise.all([storage.forgetDrive('X:'), storage.rememberDrive('Z:', '\\\\host\\c')])
    expect(await storage.listKnownDrives()).toEqual([
      { drive: 'Y:', unc: '\\\\host\\b' },
      { drive: 'Z:', unc: '\\\\host\\c' },
    ])
  })
})

describe('DTH release resolution (pinned version)', () => {
  it('surfaces a vanished pinned version instead of silently swapping to the newest', async () => {
    addDir('/dth/Release 2.4.0')
    files.set('/dth/Release 2.4.0/copyright.txt', 'c')
    addDir('/dth/Release 2.4.3')
    files.set('/dth/Release 2.4.3/copyright.txt', 'c')

    // The pinned release is gone from disk → newest still resolves, but the
    // swap is DISCOVERABLE via pinnedMissing (the old cascade was silent).
    const swapped = await storage.resolveActiveReleaseRoot('/dth', '2.3.0')
    expect(swapped.releaseRoot).toBe('/dth/Release 2.4.3')
    expect(swapped.version).toBe('2.4.3')
    expect(swapped.error).toBeNull()
    expect(swapped.pinnedMissing).toBe('2.3.0')

    // A pin that resolves — and no pin at all — carry no signal.
    const pinned = await storage.resolveActiveReleaseRoot('/dth', '2.4.0')
    expect(pinned.releaseRoot).toBe('/dth/Release 2.4.0')
    expect(pinned.pinnedMissing).toBeUndefined()
    expect((await storage.resolveActiveReleaseRoot('/dth', '')).pinnedMissing).toBeUndefined()
  })

  it('scanPoseAssets carries pinnedMissing into the catalog (what the Settings release pane reads)', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    // One extracted release with a Poses folder; the pinned version is gone.
    addDir('/dth/Release 2.4.3/Daz Studio Content/DazToHue/Poses')
    files.set('/dth/Release 2.4.3/copyright.txt', 'c')
    await storage.saveSettings({
      ...(await storage.getSettings()),
      dthPosesFolder: '/dth',
      currentDthVersion: '2.3.0',
    })

    vi.mocked(invoke).mockResolvedValueOnce(['Genesis 9/DQS/JCM - Base.duf']) // scan_duf_files
    const catalog = await storage.scanPoseAssets()

    // The scan succeeded against the fallback release…
    expect(catalog.version).toBe('2.4.3')
    expect(catalog.error).toBeNull()
    expect(catalog.assets).toHaveLength(1)
    // …and the broken pin is DISCOVERABLE on the catalog the UI consumes.
    expect(catalog.pinnedMissing).toBe('2.3.0')

    // A pin that resolves carries no signal.
    await storage.saveSettings({ ...(await storage.getSettings()), currentDthVersion: '2.4.3' })
    vi.mocked(invoke).mockResolvedValueOnce([])
    expect((await storage.scanPoseAssets()).pinnedMissing).toBeUndefined()
  })
})

describe('copyRuntimeFiles', () => {
  const root = '/daz/Scripts/DTH-Character-Studio'

  it('skips the rewrite when the installed marker is current; reinstalls when stale', async () => {
    await storage.copyRuntimeFiles(root)
    expect(files.has(`${root}/.DthWorkflow.dsa`)).toBe(true)
    expect(files.has(`${root}/Scan_Frames.dsa`)).toBe(true)
    const marker = files.get(`${root}/.dth-runtime-installed`)
    expect(typeof marker).toBe('string')

    // Same runtime already installed → the whole write is skipped (a tampered
    // file stays tampered — proof nothing was rewritten).
    files.set(`${root}/.DthWorkflow.dsa`, 'tampered')
    await storage.copyRuntimeFiles(root)
    expect(files.get(`${root}/.DthWorkflow.dsa`)).toBe('tampered')

    // An older marker (previous runtime version) → full reinstall + restamp.
    files.set(`${root}/.dth-runtime-installed`, 'v1|/appdata')
    await storage.copyRuntimeFiles(root)
    expect(files.get(`${root}/.DthWorkflow.dsa`)).not.toBe('tampered')
    expect(files.get(`${root}/.dth-runtime-installed`)).toBe(marker)
  })

  it('force re-copies despite a FRESH marker (Tools → Refresh repairs a broken install)', async () => {
    await storage.copyRuntimeFiles(root)
    const marker = files.get(`${root}/.dth-runtime-installed`)

    // A runtime file corrupted/deleted AFTER a completed install — the marker
    // still reads current, so the routine path would skip forever.
    files.set(`${root}/.DthWorkflow.dsa`, 'corrupted')
    files.delete(`${root}/.DthUtils.dsa`)

    await storage.copyRuntimeFiles(root, { force: true })

    expect(files.get(`${root}/.DthWorkflow.dsa`)).not.toBe('corrupted')
    expect(files.has(`${root}/.DthUtils.dsa`)).toBe(true)
    // The marker is re-stamped (still written last, same content).
    expect(files.get(`${root}/.dth-runtime-installed`)).toBe(marker)
  })
})
