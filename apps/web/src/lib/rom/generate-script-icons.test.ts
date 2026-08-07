import { beforeEach, describe, expect, it, vi } from 'vitest'

// The generated per-character scripts get Content Library artwork written beside
// them (`<script base>.png` + `.tip.png`). The trap this file guards: the stale-
// artifact sweep lists those very names as candidates, so unless the icons just
// written are folded into the written set, generate deletes the tiles it created
// one line earlier. Same in-memory fs shape as generate-rename.test.ts, with the
// NTFS case-insensitivity that sweep depends on.

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
    return {
      isDirectory: dirs.has(p),
      isFile: files.has(p),
      mtime: new Date(0),
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
import { generateCharacterFiles } from './api/generate'

const LIB = '/games/P'
const DAZ = '/daz'
/** Where the per-character scripts (and their artwork) land. */
const SCRIPTS = `${DAZ}/Scripts/DTH-Character-Studio/P/Kira`
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

beforeEach(() => {
  files.clear()
  dirs.clear()
})

/** A generatable character: JCM off (no preset `.duf` to measure), one custom
 *  pose for content, a linked primary scene (a scene-less character generates
 *  nothing at all). */
function seedCharacter(over: Partial<Character> = {}): Character {
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
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections,
    scenePath: `${LIB}/Kira/Kira.duf`,
    ...over,
  })
  addDir(`${LIB}/Kira`)
  files.set(
    `${LIB}/Kira/Kira.json`,
    JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  return c
}

/** Rewrite the on-disk definition — generate reads the character from disk, so
 *  this is how a settings flip reaches it. */
function patchOnDisk(c: Character, patch: Partial<Character>): void {
  files.set(
    `${LIB}/Kira/Kira.json`,
    JSON.stringify({ ...c, ...patch, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
}

async function setup(): Promise<void> {
  await storage.createProjectManifest(LIB, 'P')
  await storage.saveSettings({ ...(await storage.getSettings()), dazLibraryFolder: DAZ })
}

function png(name: string): Uint8Array | undefined {
  const v = files.get(`${SCRIPTS}/${name}`)
  return v instanceof Uint8Array ? v : undefined
}

describe('generated script artwork', () => {
  it('writes the tile + tip beside the ROM script, and the sweep leaves them alone', async () => {
    await setup()
    const c = seedCharacter({ exportPath: 'D:/exports' })

    const res = await generateCharacterFiles({ data: { projectId: LIB, id: c.id } })

    expect(res.scriptsError).toBeNull()
    expect(files.has(`${SCRIPTS}/ROM_Kira_G9.dsa`)).toBe(true)
    // Real PNG bytes (the bundled data URL decoded), under the name Daz matches.
    for (const name of ['ROM_Kira_G9.png', 'ROM_Kira_G9.tip.png']) {
      expect([...(png(name) ?? [])].slice(0, 8), name).toEqual(PNG_SIGNATURE)
    }
  })

  it('gives the ROM script different artwork depending on whether the export rides along', async () => {
    await setup()
    const c = seedCharacter({ exportPath: 'D:/exports' })

    await generateCharacterFiles({ data: { projectId: LIB, id: c.id } })
    const withExport = png('ROM_Kira_G9.png')

    // Split the export off: same file NAME, different script, different tile.
    patchOnDisk(c, { exportWithRomScript: false })
    await generateCharacterFiles({ data: { projectId: LIB, id: c.id } })
    const romOnly = png('ROM_Kira_G9.png')

    expect(withExport).toBeDefined()
    expect(romOnly).toBeDefined()
    expect(romOnly).not.toEqual(withExport)
  })

  it("retires a split export's artwork when the export moves back into the ROM script", async () => {
    await setup()
    const c = seedCharacter({ exportPath: 'D:/exports', exportWithRomScript: false })

    await generateCharacterFiles({ data: { projectId: LIB, id: c.id } })
    // The standalone script and its artwork exist…
    expect(files.has(`${SCRIPTS}/Export_Kira_G9.dsa`)).toBe(true)
    expect(png('Export_Kira_G9.png')).toBeDefined()
    expect(png('Export_Kira_G9.tip.png')).toBeDefined()

    // …and go away with the script when the export rides the ROM script again.
    patchOnDisk(c, { exportWithRomScript: true })
    await generateCharacterFiles({ data: { projectId: LIB, id: c.id } })

    expect(files.has(`${SCRIPTS}/Export_Kira_G9.dsa`)).toBe(false)
    expect(png('Export_Kira_G9.png')).toBeUndefined()
    expect(png('Export_Kira_G9.tip.png')).toBeUndefined()
    // The ROM script's own artwork survived that same sweep.
    expect(png('ROM_Kira_G9.png')).toBeDefined()
  })

  it('writes no artwork for a script that has none — the product scan', async () => {
    await setup()
    const c = seedCharacter({ exportPath: 'D:/exports' })
    // A DIM manifests folder is what arms the product scan (since v0.70 — the
    // per-project toggle only decides whether the tab is shown), so setting it
    // is what makes the per-character scan script get emitted.
    await storage.saveSettings({
      ...(await storage.getSettings()),
      dimManifestsFolder: 'D:/DAZ 3D/Install Manager/ManifestFiles',
    })

    await generateCharacterFiles({ data: { projectId: LIB, id: c.id } })

    const scan = [...files.keys()].find((k) => k.includes('Scan_Products_'))
    expect(scan).toBeDefined()
    expect(files.has(`${SCRIPTS}/Scan_Products_Kira.png`)).toBe(false)
  })
})
