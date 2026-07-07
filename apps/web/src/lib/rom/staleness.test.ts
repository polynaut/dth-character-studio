import { beforeEach, describe, expect, it, vi } from 'vitest'

// Staleness is the mechanism that keeps every character's generated artifacts in
// step with the app: characterStaleTargets/isCharacterStale decide WHAT is out of
// date (shared by detection, the Refresh table and the selective refresh), and
// refreshAllAssets converges it (migrate + regenerate exactly the affected
// artifacts). With the fail-loud v16 runtime, a bug here strands users on old
// scripts that error — so the judgment and the convergence both get tests.
//
// Same in-memory fs + Tauri mocks as project-files.test.ts.

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
  async rename() {
    throw new Error('rename not expected in these tests')
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

import { CHARACTER_SCHEMA_VERSION, RUNTIME_VERSION, characterSchema, defaultSections, newId } from '@dth/rom'
import * as storage from './storage'
import * as api from './api'

beforeEach(() => {
  files.clear()
  dirs.clear()
  api.setActiveProjectDir('')
})

// --- The pure judgment ------------------------------------------------------

// dthRelease/generatedDthVersion are dotted version strings (poseAssetCsvEra
// compares them numerically; '2.4.3' is the first breaking era).
const APP = { schema: CHARACTER_SCHEMA_VERSION, runtime: RUNTIME_VERSION, dthRelease: '2.4.3' }
const BOTH = { hasDazLibrary: true, hasDthRelease: true }

function status(patch: Partial<api.CharacterAssetStatus> = {}): api.CharacterAssetStatus {
  return {
    projectId: '/games/P',
    project: 'P',
    character: 'C',
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    generatedDthVersion: APP.dthRelease,
    ...patch,
  }
}

describe('characterStaleTargets / isCharacterStale', () => {
  it('a fully current character is not stale in any artifact', () => {
    expect(api.characterStaleTargets(status(), APP, BOTH)).toEqual({
      schema: false,
      runtime: false,
      csv: false,
    })
    expect(api.isCharacterStale(status(), APP, BOTH)).toBe(false)
  })

  it('an older definition schema flags schema', () => {
    const t = api.characterStaleTargets(status({ schemaVersion: CHARACTER_SCHEMA_VERSION - 1 }), APP, BOTH)
    expect(t).toEqual({ schema: true, runtime: false, csv: false })
  })

  it('a missing or older script runtime flags runtime — only with a DAZ library', () => {
    expect(api.characterStaleTargets(status({ runtimeVersion: null }), APP, BOTH).runtime).toBe(true)
    expect(
      api.characterStaleTargets(status({ runtimeVersion: RUNTIME_VERSION - 1 }), APP, BOTH).runtime,
    ).toBe(true)
    // No DAZ library → there are no scripts to judge; runtime must NOT flag.
    expect(
      api.characterStaleTargets(status({ runtimeVersion: null }), APP, {
        ...BOTH,
        hasDazLibrary: false,
      }).runtime,
    ).toBe(false)
  })

  it('a different CSV era flags csv — only with a DTH release configured', () => {
    // '' era (never generated) vs the 2.4.3 era → stale.
    expect(api.characterStaleTargets(status({ generatedDthVersion: '' }), APP, BOTH).csv).toBe(true)
    // A newer release in the SAME era (2.4.10 ≥ 2.4.3, no breaking version
    // between) is NOT stale — eras, not exact versions, drive regeneration.
    expect(
      api.characterStaleTargets(status({ generatedDthVersion: '2.4.10' }), APP, BOTH).csv,
    ).toBe(false)
    // Without a configured release the era can't be compared → not flagged.
    expect(
      api.characterStaleTargets(status({ generatedDthVersion: '' }), APP, {
        ...BOTH,
        hasDthRelease: false,
      }).csv,
    ).toBe(false)
  })

  it('isCharacterStale is the OR of the three targets', () => {
    expect(api.isCharacterStale(status({ schemaVersion: 1 }), APP, BOTH)).toBe(true)
    expect(api.isCharacterStale(status({ runtimeVersion: null }), APP, BOTH)).toBe(true)
    expect(api.isCharacterStale(status({ generatedDthVersion: '' }), APP, BOTH)).toBe(true)
  })
})

// --- The convergence (refreshAllAssets orchestration) ------------------------

/** Seed a project with one character. `stale` writes it at the previous schema
 *  version (parseCharacter migrates it in-memory; refresh re-saves it current).
 *  JCM/GEN/PHY stay disabled so generation needs no preset measurement — only
 *  the CSV is producible in this mock environment (no DAZ library configured). */
async function seedProject(dir: string, name: string, opts: { stale: boolean }): Promise<string> {
  await storage.createProjectManifest(dir, name)
  await storage.rememberRecent(`${dir}/${name}.dcsp`, name)
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
      poses: [{ id: 'p', name: 'BodyTone', morphs: [], referenceFbx: '' }],
    },
  ]
  const c = characterSchema.parse({
    id: newId(),
    name: `${name}Char`,
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections,
  })
  // Persist the schema version EXPLICITLY: characterSchema defaults it to 1 (a
  // schemaVersion-less legacy file reads as v1), so a plain parse-and-stringify
  // would seed every character as maximally stale.
  const persisted = {
    ...c,
    schemaVersion: opts.stale ? CHARACTER_SCHEMA_VERSION - 1 : CHARACTER_SCHEMA_VERSION,
  }
  addDir(`${dir}/${name}Char`)
  files.set(`${dir}/${name}Char/${name}Char.json`, JSON.stringify(persisted))
  return `${dir}/${name}Char/${name}Char.json`
}

describe('refreshAllAssets', () => {
  it('targeted refresh: regenerates only the stale character, skips the fresh one, and converges', async () => {
    const staleJson = await seedProject('/games/Old', 'Old', { stale: true })
    await seedProject('/games/New', 'New', { stale: false })

    const summary = await api.refreshAllAssets()

    // Only the stale character was touched; the fresh one was skipped.
    expect(summary.skipped).toBe(1)
    expect(summary.total).toBe(1)
    expect(summary.counts.migrated).toBe(1)
    const touched = summary.results.map((r) => r.character)
    expect(touched).toEqual(['OldChar'])

    // Convergence: the re-saved definition now carries the current schema —
    // a second detection run sees nothing stale.
    const saved = JSON.parse(files.get(norm(staleJson)) as string)
    expect(saved.schemaVersion).toBe(CHARACTER_SCHEMA_VERSION)
    const report = await api.detectAssetVersions()
    expect(report.staleCount).toBe(0)
    expect(report.refreshNeeded).toBe(false)
  })

  it('forced full refresh: nothing stale → every character regenerates, none skipped', async () => {
    await seedProject('/games/A', 'A', { stale: false })
    await seedProject('/games/B', 'B', { stale: false })

    const summary = await api.refreshAllAssets()

    expect(summary.skipped).toBe(0)
    expect(summary.total).toBe(2)
    expect(summary.counts.migrated).toBe(0) // schemas were already current
    expect(summary.results.map((r) => r.character).sort()).toEqual(['AChar', 'BChar'])
  })

  it('a vanished project folder is tolerated (empty), not fatal to the sweep', async () => {
    await seedProject('/games/Good', 'Good', { stale: false })
    // A recents entry whose folder doesn't exist: scanLibrary guards it to [],
    // so the sweep continues (the deeper unreachable branch is defensive-only).
    await storage.rememberRecent('/gone/Ghost/Ghost.dcsp', 'Ghost')

    const summary = await api.refreshAllAssets()

    // The reachable project still got processed (forced full refresh — nothing stale).
    expect(summary.results.some((r) => r.character === 'GoodChar')).toBe(true)
    expect(summary.failed).toBe(0)
  })
})
