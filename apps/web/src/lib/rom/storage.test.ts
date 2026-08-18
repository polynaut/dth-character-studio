import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- In-memory fs mock ----------------------------------------------------
// Same shape as project-files.test.ts: enough of @tauri-apps/plugin-fs for the
// storage code — files + dirs keyed by '/'-normalised absolute paths.

const files = new Map<string, string | Uint8Array>()
const dirs = new Set<string>()

function norm(p: string): string {
  let s = p.replace(/\\/g, '/')
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
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
    dthExporterFolders: [],
    dthExporterFolder: '',
    currentDthExporterVersion: '',
    dazInstallFolder: '',
    // No Daz installation activated yet, so the three Daz paths above/below are
    // the user's own to edit (see `dazInstallKey`).
    dazInstallKey: '',
    dazExportInstallKey: '',
    dazExportInstallFolder: '',
    // Fresh install writes Houdini paths $HIP-relative — the setting only ever
    // turns that OFF.
    houdiniPathStyle: 'hip',
    houdiniDocsFolder: '',
    extraHoudiniDocsFolders: [],
    houdiniInstallFolder: '',
    // No Houdini activated either — both Houdini paths are the user's to edit.
    houdiniInstallKey: '',
    unrealPluginFolders: [],
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
      dthExporterFolders: ['X:/dth/exporter/Daz Studio 4', 'X:/dth/exporter/Daz Studio 6'],
      dthExporterFolder: 'X:/dth/exporter',
      currentDthExporterVersion: '1.0.0.1',
      dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio4',
      dazInstallKey: 'dzstudio4installdir-64',
      dazExportInstallKey: '',
      dazExportInstallFolder: '',
      houdiniPathStyle: 'absolute',
      houdiniDocsFolder: 'D:/Documents/houdini20.5',
      extraHoudiniDocsFolders: ['D:/Documents/houdini19.5'],
      houdiniInstallFolder: 'C:/Program Files/Side Effects Software/Houdini 22.0.368',
      houdiniInstallKey: '22.0.0.368',
      unrealPluginFolders: ['X:/unreal/DazToUnrealBridge', 'X:/unreal/MyPlugin_5.7'],
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

describe('createCharacterAt seeds the export root + the Houdini folder', () => {
  const PROJECT = '/games/Nova'

  /** A project folder with a `.dcsp` carrying the given behaviour settings. */
  function seedProject(manifest: Record<string, unknown> = {}): storage.Project {
    addDir(PROJECT)
    files.set(
      `${PROJECT}/Nova.dcsp`,
      JSON.stringify({
        schemaVersion: 2,
        id: 'proj-1',
        name: 'Nova',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...manifest,
      }),
    )
    return { id: 'proj-1', name: 'Nova', path: PROJECT }
  }

  function fresh(name: string, over: Partial<Character> = {}): Character {
    return characterSchema.parse({
      id: newId(),
      name,
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    })
  }

  it('creates the fixed export root inside the Houdini folder and points at it', async () => {
    const project = seedProject({ houdiniSubdir: 'houdini', createHoudiniSubdir: true })

    const { character, location } = await storage.createCharacterAt(
      project,
      fresh('Kira'),
      'Kira',
    )

    expect(location.folderAbs).toBe('/games/Nova/Kira')
    expect(dirs.has('/games/Nova/Kira/houdini')).toBe(true)
    // Fixed at <char>/<houdiniSubdir>/daz-export — derived, never picked (v29;
    // the export-root move put it here, because nothing in Daz reopens these
    // files — they exist to be imported by the .hip sitting one folder up).
    expect(dirs.has('/games/Nova/Kira/houdini/daz-export')).toBe(true)
    expect(character.exportPath).toBe('/games/Nova/Kira/houdini/daz-export')
    // …and it's in the definition on disk, not just the returned record.
    expect(JSON.parse(files.get('/games/Nova/Kira/Kira.json') as string)).toMatchObject({
      exportPath: '/games/Nova/Kira/houdini/daz-export',
    })
  })

  it('follows a renamed Houdini subfolder, and the folder auto-suffix', async () => {
    const project = seedProject({ houdiniSubdir: 'hou/projects', createHoudiniSubdir: false })
    addDir('/games/Nova/Kira') // taken → the create auto-suffixes

    const { character, location } = await storage.createCharacterAt(
      project,
      fresh('Kira'),
      'Kira',
    )

    expect(location.folderAbs).toBe('/games/Nova/Kira (2)')
    // The path follows the folder the create actually landed in — which the
    // caller could not have predicted.
    expect(character.exportPath).toBe('/games/Nova/Kira (2)/hou/projects/daz-export')
    expect(dirs.has('/games/Nova/Kira (2)/hou/projects/daz-export')).toBe(true)
  })

  it('creates the FINAL export folder beside the Daz and Houdini ones', async () => {
    const project = seedProject({ houdiniSubdir: 'houdini', createHoudiniSubdir: true })

    await storage.createCharacterAt(project, fresh('Kira'), 'Kira')

    // The two ends of the pipeline are peers in the character folder, and must
    // never be confused: `houdini/daz-export` is what Houdini READS, `export/`
    // is what it WRITES for Unreal.
    expect(dirs.has('/games/Nova/Kira/houdini/daz-export')).toBe(true)
    expect(dirs.has('/games/Nova/Kira/houdini')).toBe(true)
    expect(dirs.has('/games/Nova/Kira/export')).toBe(true)
  })

  it('follows a renamed final-export subfolder', async () => {
    const project = seedProject({ exportSubdir: 'unreal/incoming' })

    await storage.createCharacterAt(project, fresh('Kira'), 'Kira')

    expect(dirs.has('/games/Nova/Kira/unreal/incoming')).toBe(true)
    expect(dirs.has('/games/Nova/Kira/export')).toBe(false)
  })

  it('creates the export root even when the Houdini seed is switched off', async () => {
    const project = seedProject({ houdiniSubdir: 'houdini', createHoudiniSubdir: false })

    const { character } = await storage.createCharacterAt(project, fresh('Kira'), 'Kira')

    // `createHoudiniSubdir` governs seeding an EMPTY folder, nothing more — the
    // export root has contents by definition, so it is created either way and
    // brings the folder with it.
    expect(character.exportPath).toBe('/games/Nova/Kira/houdini/daz-export')
    expect(dirs.has('/games/Nova/Kira/houdini/daz-export')).toBe(true)
  })

  it('never seeds (or points at) anything for a definition dropped in the project root', async () => {
    const project = seedProject({ houdiniSubdir: 'houdini', createHoudiniSubdir: true })

    const { character, location } = await storage.createCharacterAt(project, fresh('Kira'), '')

    expect(location.relFolder).toBe('')
    // A root-level definition owns no folder; a seed here would litter the project.
    expect(dirs.has('/games/Nova/houdini')).toBe(false)
    expect(character.exportPath).toBe('')
  })

  it('OVERRIDES an export path the incoming character carries (it is derived now)', async () => {
    const project = seedProject({ houdiniSubdir: 'houdini', createHoudiniSubdir: true })

    const { character } = await storage.createCharacterAt(
      project,
      fresh('Kira', { exportPath: '/elsewhere/exports' }),
      'Kira',
    )

    // A prefilled/imported path is no longer honoured: the export root is a
    // fixed derivation, so an imported definition adopts its new home's.
    expect(character.exportPath).toBe('/games/Nova/Kira/houdini/daz-export')
    expect(dirs.has('/games/Nova/Kira/houdini')).toBe(true)
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

  it('the DERIVED export root travels with the folder too', () => {
    // Regression: exportPath was the one in-folder path the repoint site
    // omitted. saveCharacter re-derives it on the next save, but a move that
    // does NOT immediately re-save this character — moveCharactersRoot — left
    // the stored path naming the OLD location, so a same-batch regenerate (a
    // dazProductsEnabled toggle) and the junction refresh both aimed at a
    // resurrected old folder until some later save fixed it.
    const c = characterSchema.parse({
      id: newId(),
      name: 'Kira',
      genesis: 'G9',
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      scenePath: '/games/Nova/kira/daz3d/primary/kira.duf',
      exportPath: '/games/Nova/kira/houdini/daz-export',
    })

    const moved = storage.repointCharacterPaths(c, '/games/Nova/kira', '/games/Alt/chars/Kira')

    expect(moved.exportPath).toBe('/games/Alt/chars/Kira/houdini/daz-export')
    // A pre-v29 hand-picked root OUTSIDE the folder is not the folder's to move.
    const foreign = storage.repointCharacterPaths(
      { ...c, exportPath: 'X:/renders/kira' },
      '/games/Nova/kira',
      '/games/Alt/chars/Kira',
    )
    expect(foreign.exportPath).toBe('X:/renders/kira')
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

  it("carries the character's .dcsmeta folder through the rename", async () => {
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
    // The app's own files for this character, keyed on its folder name.
    addDir('/games/Nova/.dcsmeta/characters/Kira')
    files.set('/games/Nova/.dcsmeta/characters/Kira/.last_rom_run.json', '{"ok":true}')
    files.set('/games/Nova/.dcsmeta/characters/Kira/Kira_pose_asset.csv', 'csv')

    await storage.saveCharacter(project, { ...c, name: 'Nova Kira' })

    // Left behind, the run log and the CSV the export script copies would both
    // be orphaned under a folder name no character answers to any more.
    expect(files.get('/games/Nova/.dcsmeta/characters/Nova Kira/.last_rom_run.json')).toBe(
      '{"ok":true}',
    )
    expect(files.has('/games/Nova/.dcsmeta/characters/Nova Kira/Kira_pose_asset.csv')).toBe(true)
    expect(files.has('/games/Nova/.dcsmeta/characters/Kira/.last_rom_run.json')).toBe(false)
  })

  it('a rename onto a DEAD character\'s leftover meta folder replaces it, never adopts it', async () => {
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
    addDir('/games/Nova/.dcsmeta/characters/Kira')
    files.set('/games/Nova/.dcsmeta/characters/Kira/.last_rom_run.json', '{"mine":true}')
    // A character called Nova was deleted while its meta folder was locked (that
    // removal is best-effort) — its state must not become the renamed Kira's:
    // the wrong run report would show, and housekeeping would work off another
    // character's export-folder record.
    addDir('/games/Nova/.dcsmeta/characters/Nova')
    files.set('/games/Nova/.dcsmeta/characters/Nova/.last_rom_run.json', '{"dead":true}')
    files.set('/games/Nova/.dcsmeta/characters/Nova/.dth_export_folders.json', '["dead"]')

    await storage.saveCharacter(project, { ...c, name: 'Nova' })

    expect(files.get('/games/Nova/.dcsmeta/characters/Nova/.last_rom_run.json')).toBe(
      '{"mine":true}',
    )
    expect(files.has('/games/Nova/.dcsmeta/characters/Nova/.dth_export_folders.json')).toBe(false)
    expect(files.has('/games/Nova/.dcsmeta/characters/Kira/.last_rom_run.json')).toBe(false)
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

  // Runtime v84. Every include is anchored to the ABSOLUTE install root instead
  // of climbing `../../` from getScriptFileName(), which on the first row of a
  // Runner batch in a cold-started Daz answers with a Daz-internal path. The
  // rewrite is the entire install half of that fix and had no test at all.
  it('anchors every runtime include to the ABSOLUTE root, in both script families', async () => {
    await storage.copyRuntimeFiles(root)

    // A RUNTIME file's bare sibling reference ("DthUtils.dsa" — the shape the
    // sources use, since inside an include() dir_self is the INVOKING script's
    // folder, not this file's).
    const workflow = files.get(`${root}/.DthWorkflow.dsa`) as string
    expect(workflow).toContain(`"${root}/.DthUtils.dsa"`)
    expect(workflow).not.toContain('"../../.DthUtils.dsa"')
    expect(workflow).not.toContain('filePath ("DthUtils.dsa")')

    // A ROOT-LEVEL script's already-dot-prefixed reference (".DthUtils.dsa").
    // Same anchoring, different search string — a rewrite that handled only the
    // first family would leave these resolving through the lying API.
    const bulk = files.get(`${root}/.Scan_Scene_Bulk.dsa`) as string
    expect(bulk).toContain(`"${root}/.DthUtils.dsa"`)
    expect(bulk).toContain(`"${root}/.DthProducts.dsa"`)
    expect(bulk).not.toContain('filePath(".DthUtils.dsa")')

    // No file may still be walking up out of the root.
    for (const [path, content] of files) {
      if (typeof content === 'string' && path.endsWith('.dsa')) {
        expect(content, path).not.toContain('../../.Dth')
      }
    }
  })

  it('bakes the install root into the bulk carriers’ scriptDir', async () => {
    await storage.copyRuntimeFiles(root)

    // scriptDir is how .Scan_Scene_Bulk finds dth_scan_config.json and how the
    // index build derives its content root. Both run as Runner batch rows — the
    // one place getScriptFileName() is known to lie — so it is baked, not
    // derived. A leftover token would make the path literally "__DTH_RUNTIME_DIR__".
    for (const name of ['.Scan_Scene_Bulk.dsa', '.Build_Genesis_Index_Bulk.dsa']) {
      const content = files.get(`${root}/${name}`) as string
      expect(content, name).toContain(`scriptDir: "${root}"`)
      expect(content, name).not.toContain('__DTH_RUNTIME_DIR__')
      expect(content, name).not.toContain('scriptDir: String(sSelfDir)')
    }
    // The visible twin gets it too — one source of truth for the content root.
    expect(files.get(`${root}/Build_Genesis_Index.dsa`)).toContain(`scriptDir: "${root}"`)
  })

  it('reinstalls when the install MOVED, even though the marker travelled with it', async () => {
    // The v84 bake is absolute, so a marker blind to the destination is now a
    // silent breakage: renaming or moving the Daz library carries
    // `.dth-runtime-installed` along inside the folder, the stamp still matches,
    // the existence probe still passes — and every baked path names the OLD
    // root. The `../../` form this replaced survived the move; absolute cannot.
    await storage.copyRuntimeFiles(root)
    const moved = '/daz-moved/Scripts/DTH-Character-Studio'
    for (const [path, content] of [...files]) {
      if (path.startsWith(`${root}/`)) files.set(path.replace(root, moved), content)
    }
    expect(files.get(`${moved}/.DthWorkflow.dsa`)).toContain(`"${root}/.DthUtils.dsa"`)

    await storage.copyRuntimeFiles(moved)

    expect(files.get(`${moved}/.DthWorkflow.dsa`)).toContain(`"${moved}/.DthUtils.dsa"`)
    expect(files.get(`${moved}/.DthWorkflow.dsa`)).not.toContain(`"${root}/.DthUtils.dsa"`)
    expect(files.get(`${moved}/.Scan_Scene_Bulk.dsa`)).toContain(`scriptDir: "${moved}"`)
  })

  it('installs Build_Genesis_Index with app-data baked in, and sweeps the retired Scan_Morphs wrappers', async () => {
    // An install from before the merge: the four per-generation wrappers sit
    // visible at the root. They'd still run against the new runtime, so the
    // install has to remove them.
    for (const stale of [
      'Scan_Morphs_G9.dsa',
      'Scan_Morphs_G8.1.dsa',
      'Scan_Morphs_G8.dsa',
      'Scan_Morphs_G3.dsa',
    ]) {
      files.set(`${root}/${stale}`, 'old wrapper')
    }

    await storage.copyRuntimeFiles(root)

    const script = files.get(`${root}/Build_Genesis_Index.dsa`)
    expect(typeof script).toBe('string')
    // The output folder is baked in at install time — no token survives.
    expect(script).toContain('outDir: "/appdata"')
    expect(script).not.toContain('__DTH_APPDATA_DIR__')

    // Each visible script gets its Content Library artwork beside it, by name —
    // Daz matches `<script base name>.png` / `.tip.png`, so a rename here
    // silently reverts the tiles to a broken-image placeholder. Written as real
    // PNG BYTES (the bundled data URL decoded), not text.
    for (const icon of [
      'Build_Genesis_Index.png',
      'Build_Genesis_Index.tip.png',
      'Scan_Frames.png',
      'Scan_Frames.tip.png',
    ]) {
      const bytes = files.get(`${root}/${icon}`)
      expect(bytes, icon).toBeInstanceOf(Uint8Array)
      // The 8-byte PNG signature — proof the base64 decode produced a real image.
      expect([...(bytes as Uint8Array).slice(0, 8)], icon).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])
    }
    for (const stale of [
      'Scan_Morphs_G9.dsa',
      'Scan_Morphs_G8.1.dsa',
      'Scan_Morphs_G8.dsa',
      'Scan_Morphs_G3.dsa',
    ]) {
      expect(files.has(`${root}/${stale}`)).toBe(false)
    }
  })
})

describe('exportInstallFolder — which Daz runs the export batch', () => {
  const base = (over: Partial<StudioSettings> = {}): StudioSettings =>
    storage.studioSettingsSchema.parse({
      dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio6',
      ...over,
    })

  it('is the ACTIVE install when no card is flagged', () => {
    expect(storage.exportInstallFolder(base())).toBe('C:/Program Files/DAZ 3D/DAZStudio6')
  })

  it('is the flagged install when one carries Export only', () => {
    // The whole point: everything else stays on DS6, the batch runs in DS4
    // because that is where a Runner plugin build exists.
    expect(
      storage.exportInstallFolder(
        base({
          dazExportInstallKey: 'dzstudio4installdir-64',
          dazExportInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio4',
        }),
      ),
    ).toBe('C:/Program Files/DAZ 3D/DAZStudio4')
  })

  it('the KEY arms it — a leftover folder alone never takes the exports', () => {
    // Turning the switch off clears the key; a stale folder must not keep
    // silently redirecting the batch.
    expect(
      storage.exportInstallFolder(base({ dazExportInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio4' })),
    ).toBe('C:/Program Files/DAZ 3D/DAZStudio6')
  })

  it('falls back to the active install when the flag names no folder', () => {
    expect(storage.exportInstallFolder(base({ dazExportInstallKey: 'dzstudio4installdir-64' }))).toBe(
      'C:/Program Files/DAZ 3D/DAZStudio6',
    )
  })
})

describe('exporterSourceFolders — where the exporter builds come from', () => {
  const base = (over: Partial<StudioSettings> = {}): StudioSettings =>
    storage.studioSettingsSchema.parse(over)

  it('is the configured list, in the order the user typed it', () => {
    expect(
      storage.exporterSourceFolders(base({ dthExporterFolders: ['D:/a', 'D:/b'] })),
    ).toEqual(['D:/a', 'D:/b'])
  })

  it('merges the legacy single folder for a settings.json never seen by the UI', () => {
    // The whole point of the merge: an install run before the user ever opens
    // Settings still finds the folder they configured under the old field.
    expect(storage.exporterSourceFolders(base({ dthExporterFolder: 'D:/legacy' }))).toEqual([
      'D:/legacy',
    ])
  })

  it('de-duplicates case-insensitively rather than scanning a folder twice', () => {
    expect(
      storage.exporterSourceFolders(
        base({ dthExporterFolders: ['D:/Plugins'], dthExporterFolder: 'd:/plugins' }),
      ),
    ).toEqual(['D:/Plugins'])
  })

  it('drops blanks and trims — an empty row is not a folder', () => {
    expect(
      storage.exporterSourceFolders(base({ dthExporterFolders: ['  D:/a  ', '', '   '] })),
    ).toEqual(['D:/a'])
  })

  it('a CLEARED legacy field adds nothing back — which is what makes a removal stick', () => {
    // Settings migrates the legacy value into the list and clears it. Were it
    // left in place, removing the migrated row would leave the list empty while
    // this merge silently re-added the same folder: the panel (which scans the
    // fields) would show it gone while the install kept installing from it.
    expect(
      storage.exporterSourceFolders(base({ dthExporterFolders: [], dthExporterFolder: '' })),
    ).toEqual([])
  })
})
