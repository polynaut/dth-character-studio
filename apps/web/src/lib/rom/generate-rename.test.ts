import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression: a CASE-ONLY rename (kira → Kira) used to delete the PoseAsset CSV
// that generate had JUST written. The previousName-derived sweep candidates
// ('kira_pose_asset.csv') survived a case-SENSITIVE filter against the written
// names ('Kira_pose_asset.csv' — characterSlug preserves case), and
// removeFilesFromFolder's exists/remove then resolved case-INsensitively on
// Windows, hitting the same physical file. The fs mock here mirrors exactly the
// NTFS semantics that matter: `exists` AND `remove` match names
// case-insensitively; everything else stays exact-case (tests seed consistently).

const files = new Map<string, string | Uint8Array>()
const dirs = new Set<string>()
/** Per-file mtimes for the stat mock (unset = epoch) — the both-exist branch of
 *  the internals relocation keeps whichever copy is NEWER. */
const mtimes = new Map<string, Date>()
/** Paths whose rename fails (a locked file, Daz mid-write) — the relocation's
 *  per-file catch must skip exactly these and still move the rest. */
const lockedPaths = new Set<string>()

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
  // Case-INSENSITIVE like Windows/NTFS — the semantics this regression is about.
  async exists(p: string) {
    const t = norm(p).toLowerCase()
    for (const k of files.keys()) if (k.toLowerCase() === t) return true
    for (const k of dirs) if (k.toLowerCase() === t) return true
    return false
  },
  // Case-INSENSITIVE like Windows/NTFS: removing 'kira_pose_asset.csv' deletes
  // an on-disk 'Kira_pose_asset.csv' — the exact mechanism of the regression.
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
    if (lockedPaths.has(a)) throw new Error(`EBUSY ${a}`)
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
    return {
      isDirectory: dirs.has(p),
      isFile: files.has(p),
      mtime: mtimes.get(p) ?? new Date(0),
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

import { CHARACTER_SCHEMA_VERSION, characterSchema, defaultSections, newId } from '@dth/rom'
import type { Character } from '@dth/rom'
import * as storage from './storage'
import { generateCharacterFiles, removalSweepNames } from './api/generate'

beforeEach(() => {
  files.clear()
  dirs.clear()
  mtimes.clear()
  lockedPaths.clear()
})

/** Seed a generatable character (same shape as staleness.test.ts: JCM off so no
 *  preset `.duf` needs measuring; one custom FBM pose so generation has content). */
function seedCharacter(lib: string, folder: string, name: string): Character {
  const sections = defaultSections()
  sections.JCM.enabled = false
  sections.FBM.enabled = true
  sections.FBM.groups = [
    {
      id: 'g',
      label: '',
      suffix: 'centre',
      method: 'individual',
      calculateFrom: 'default',
      poses: [{ id: 'p', name: 'BodyTone', morphs: [], boneScaleRef: false }],
    },
  ]
  const c = characterSchema.parse({
    id: newId(),
    name,
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections,
    // A primary scene must be linked — a scene-less character generates nothing
    // (generateCharacterFiles short-circuits), so the sweep would never run.
    scenePath: `${lib}/${folder}/${name}.duf`,
  })
  addDir(`${lib}/${folder}`)
  files.set(
    `${lib}/${folder}/${name}.json`,
    JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  return c
}

describe('removalSweepNames', () => {
  it('filters candidates against the written names case-INSENSITIVELY', () => {
    // The case-only rename shape: previousName-derived candidates (old casing,
    // default + per-scene override) versus the just-written new-cased files.
    expect(
      removalSweepNames(
        ['kira_pose_asset.csv', 'kira_outfit_pose_asset.csv', 'Electra_pose_asset.csv'],
        ['Kira_pose_asset.csv', 'Kira_outfit_pose_asset.csv'],
      ),
    ).toEqual(['Electra_pose_asset.csv'])
  })

  it('keeps exact-name behaviour: written names never sweep, unwritten ones do', () => {
    expect(
      removalSweepNames(['ROM_Kira_G9.dsa', 'Export_Kira_G9.dsa', 'Kira_G9.dsa'], ['Kira_G9.dsa']),
    ).toEqual(['ROM_Kira_G9.dsa', 'Export_Kira_G9.dsa'])
  })
})

/** A character's app-internal folder — the CSVs and the sweep both live here now. */
const meta = (project: string, folder: string) => `${project}/.dcsmeta/characters/${folder}`

describe('generateCharacterFiles previousName sweep', () => {
  it('a case-only rename (kira → Kira) does NOT delete the just-written CSV', async () => {
    await storage.createProjectManifest('/games/P', 'P')
    const c = seedCharacter('/games/P', 'Kira', 'Kira')

    const res = await generateCharacterFiles({
      data: { projectId: '/games/P', id: c.id, previousName: 'kira' },
    })

    expect(res.outDir).toBe('/games/P/Kira')
    // Pre-fix, the 'kira_pose_asset.csv' candidate survived the case-sensitive
    // filter and the case-insensitive remove deleted this very file.
    expect(files.has(`${meta('/games/P', 'Kira')}/Kira_pose_asset.csv`)).toBe(true)
  })

  it('a REAL rename still sweeps the old-named CSV left behind in the meta folder', async () => {
    await storage.createProjectManifest('/games/Q', 'Q')
    const c = seedCharacter('/games/Q', 'Kira', 'Kira')
    // Leftover from before the Electra → Kira rename travelled with the folder.
    addDir(meta('/games/Q', 'Kira'))
    files.set(`${meta('/games/Q', 'Kira')}/Electra_pose_asset.csv`, 'old')

    await generateCharacterFiles({
      data: { projectId: '/games/Q', id: c.id, previousName: 'Electra' },
    })

    expect(files.has(`${meta('/games/Q', 'Kira')}/Electra_pose_asset.csv`)).toBe(false)
    expect(files.has(`${meta('/games/Q', 'Kira')}/Kira_pose_asset.csv`)).toBe(true)
  })
})

describe('generateCharacterFiles relocates the app files into .dcsmeta', () => {
  it("moves what the studio wrote and nothing else out of the character folder", async () => {
    await storage.createProjectManifest('/games/R', 'R')
    const c = seedCharacter('/games/R', 'Kira', 'Kira')
    files.set('/games/R/Kira/.dth_execute_stamps.json', '{"version":1,"scenes":{}}')
    files.set('/games/R/Kira/.dth_export_folders.json', '{"version":1,"exportDir":"","folders":[]}')
    files.set('/games/R/Kira/.last_rom_run.json', '{}')
    files.set('/games/R/Kira/dth_rom_run_log.json', '{}')
    files.set('/games/R/Kira/Kira_pose_asset.csv', 'stale')
    // NOT the studio's: a note the user dropped in, and a CSV they copied back
    // out of an export folder (whose name a `*_pose_asset.csv` pattern WOULD have
    // matched — the reason the rule is an intersection with the owned names).
    files.set('/games/R/Kira/my-notes.txt', 'mine')
    files.set('/games/R/Kira/Kira_Summertide_v2_pose_asset.csv', 'mine')

    const res = await generateCharacterFiles({ data: { projectId: '/games/R', id: c.id } })

    const dir = meta('/games/R', 'Kira')
    for (const name of [
      '.dth_execute_stamps.json',
      '.last_rom_run.json',
      'dth_rom_run_log.json',
    ]) {
      expect(files.has(`${dir}/${name}`)).toBe(true)
      expect(files.has(`/games/R/Kira/${name}`)).toBe(false)
    }
    expect(res.movedInternals).toContain('dth_rom_run_log.json')
    // The freshly generated CSV replaced the stale one it relocated.
    expect(files.get(`${dir}/Kira_pose_asset.csv`)).not.toBe('stale')
    expect(files.has('/games/R/Kira/Kira_pose_asset.csv')).toBe(false)
    // The user's files stayed exactly where they were.
    expect(files.get('/games/R/Kira/my-notes.txt')).toBe('mine')
    expect(files.get('/games/R/Kira/Kira_Summertide_v2_pose_asset.csv')).toBe('mine')
  })

  it('is idempotent — a second generation has nothing left to move', async () => {
    await storage.createProjectManifest('/games/S', 'S')
    const c = seedCharacter('/games/S', 'Kira', 'Kira')
    files.set('/games/S/Kira/.last_rom_run.json', '{"ok":true}')

    const first = await generateCharacterFiles({ data: { projectId: '/games/S', id: c.id } })
    const second = await generateCharacterFiles({ data: { projectId: '/games/S', id: c.id } })

    expect(first.movedInternals).toEqual(['.last_rom_run.json'])
    expect(second.movedInternals).toEqual([])
    expect(files.get(`${meta('/games/S', 'Kira')}/.last_rom_run.json`)).toBe('{"ok":true}')
  })

  it('drops a character-folder copy that is not newer than the migrated one', async () => {
    await storage.createProjectManifest('/games/T', 'T')
    const c = seedCharacter('/games/T', 'Kira', 'Kira')
    const dir = meta('/games/T', 'Kira')
    addDir(dir)
    files.set(`${dir}/.last_rom_run.json`, 'current')
    mtimes.set(`${dir}/.last_rom_run.json`, new Date('2026-08-02T00:00:00Z'))
    // What an older build, sharing the project, wrote to the old path — before
    // the meta copy was last touched. (Uncomparable mtimes keep the meta copy
    // too, the safe direction.)
    files.set('/games/T/Kira/.last_rom_run.json', 'stale')
    mtimes.set('/games/T/Kira/.last_rom_run.json', new Date('2026-08-01T00:00:00Z'))

    await generateCharacterFiles({ data: { projectId: '/games/T', id: c.id } })

    expect(files.get(`${dir}/.last_rom_run.json`)).toBe('current')
    expect(files.has('/games/T/Kira/.last_rom_run.json')).toBe(false)
  })

  it('a locked file stays put without costing the others their move', async () => {
    await storage.createProjectManifest('/games/V', 'V')
    const c = seedCharacter('/games/V', 'Kira', 'Kira')
    files.set('/games/V/Kira/.last_rom_run.json', 'log')
    files.set('/games/V/Kira/.dth_execute_stamps.json', 'stamps')
    lockedPaths.add('/games/V/Kira/.dth_execute_stamps.json')

    await generateCharacterFiles({ data: { projectId: '/games/V', id: c.id } })

    const dir = meta('/games/V', 'Kira')
    // The unlocked file moved; the locked one waits for a later generation.
    expect(files.get(`${dir}/.last_rom_run.json`)).toBe('log')
    expect(files.get('/games/V/Kira/.dth_execute_stamps.json')).toBe('stamps')
    expect(files.has(`${dir}/.dth_execute_stamps.json`)).toBe(false)

    // …and that later generation completes the move once the lock is gone.
    lockedPaths.clear()
    await generateCharacterFiles({ data: { projectId: '/games/V', id: c.id } })
    expect(files.get(`${dir}/.dth_execute_stamps.json`)).toBe('stamps')
    expect(files.has('/games/V/Kira/.dth_execute_stamps.json')).toBe(false)
  })

  it('a NEWER character-folder copy replaces the stale migrated one', async () => {
    await storage.createProjectManifest('/games/U', 'U')
    const c = seedCharacter('/games/U', 'Kira', 'Kira')
    const dir = meta('/games/U', 'Kira')
    addDir(dir)
    files.set(`${dir}/.last_rom_run.json`, 'stale-meta')
    mtimes.set(`${dir}/.last_rom_run.json`, new Date('2026-08-01T00:00:00Z'))
    // An older build ran a ROM AFTER this character migrated: its freshly
    // written old-path log is the current state, and dropping it would keep
    // stale data authoritative with no error.
    files.set('/games/U/Kira/.last_rom_run.json', 'fresh')
    mtimes.set('/games/U/Kira/.last_rom_run.json', new Date('2026-08-05T00:00:00Z'))

    await generateCharacterFiles({ data: { projectId: '/games/U', id: c.id } })

    expect(files.get(`${dir}/.last_rom_run.json`)).toBe('fresh')
    expect(files.has('/games/U/Kira/.last_rom_run.json')).toBe(false)
  })
})
