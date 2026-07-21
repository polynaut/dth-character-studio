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

import { CHARACTER_SCHEMA_VERSION, characterSchema, defaultSections, newId } from '@dth/rom'
import type { Character } from '@dth/rom'
import * as storage from './storage'
import { generateCharacterFiles, removalSweepNames } from './api/generate'

beforeEach(() => {
  files.clear()
  dirs.clear()
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
    expect(files.has('/games/P/Kira/Kira_pose_asset.csv')).toBe(true)
  })

  it('a REAL rename still sweeps the old-named CSV left behind in the folder', async () => {
    await storage.createProjectManifest('/games/Q', 'Q')
    const c = seedCharacter('/games/Q', 'Kira', 'Kira')
    // Leftover from before the Electra → Kira rename travelled with the folder.
    files.set('/games/Q/Kira/Electra_pose_asset.csv', 'old')

    await generateCharacterFiles({
      data: { projectId: '/games/Q', id: c.id, previousName: 'Electra' },
    })

    expect(files.has('/games/Q/Kira/Electra_pose_asset.csv')).toBe(false)
    expect(files.has('/games/Q/Kira/Kira_pose_asset.csv')).toBe(true)
  })
})
