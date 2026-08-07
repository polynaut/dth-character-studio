import { beforeEach, describe, expect, it, vi } from 'vitest'

// The unattended pickup, end to end against a fake filesystem: Daz drops a CSV
// per scanned scene, the studio parses it into the character's own meta folder
// and deletes what it consumed. The ordering is the safety story — a CSV may only
// disappear once its contents are somewhere else — so these tests pin it.

const files = new Map<string, string | Uint8Array>()
const dirs = new Set<string>()
/** Per-file mtimes for the stat mock. Unset = epoch, i.e. long settled — the
 *  terminator-less legacy pickup path trusts only files past its settle window. */
const mtimes = new Map<string, Date>()

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
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  async exists(p: string) {
    p = norm(p)
    return files.has(p) || dirs.has(p)
  },
  async remove(p: string, opts?: { recursive?: boolean }) {
    p = norm(p)
    if (!files.has(p) && !dirs.has(p)) throw new Error(`ENOENT ${p}`)
    files.delete(p)
    dirs.delete(p)
    if (opts?.recursive) {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k)
      for (const k of [...dirs]) if (k.startsWith(`${p}/`)) dirs.delete(k)
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
    for (const k of [...files.keys()]) {
      if (k === a || k.startsWith(`${a}/`)) {
        files.set(b + k.slice(a.length), files.get(k)!)
        files.delete(k)
      }
    }
    for (const k of [...dirs]) {
      if (k === a || k.startsWith(`${a}/`)) {
        dirs.delete(k)
        dirs.add(b + k.slice(a.length))
      }
    }
  },
  async stat(p: string) {
    p = norm(p)
    return {
      isDirectory: dirs.has(p),
      isFile: files.has(p),
      mtime: mtimes.get(p) ?? new Date(0),
      size: 0,
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

import { CHARACTER_SCHEMA_VERSION, characterSchema, newId } from '@dth/rom'
import * as storage from './storage'
import { clearProductScan, fetchProductScan } from './api/products'
import { saveCharacter } from './api/characters'
import { parseCharacterProductsText } from './character-products.ts'

const PROJECT = '/games/Nova'
const META = `${PROJECT}/.dcsmeta/characters/Kira`

beforeEach(() => {
  files.clear()
  dirs.clear()
  mtimes.clear()
})

/** A character with its definition on disk; returns its id. The scenes the CSV
 *  fixtures scan are LINKED — real scans can only come from linked scenes (the
 *  script's scene guard refuses foreign ones), and the save-time prune drops
 *  stored results for scenes a character doesn't link. */
function seedCharacter(): string {
  const c = characterSchema.parse({
    id: newId(),
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenePath: `${PROJECT}/Kira/daz3d/Kira.duf`,
    extraScenes: [
      `${PROJECT}/Kira/daz3d/KiraDefault.duf`,
      `${PROJECT}/Kira/daz3d/KiraSummer.duf`,
    ],
  })
  addDir(`${PROJECT}/Kira`)
  files.set(
    `${PROJECT}/Kira/Kira.json`,
    JSON.stringify({ ...c, schemaVersion: CHARACTER_SCHEMA_VERSION }),
  )
  return c.id
}

/** One scanned scene, in the CSV shape the v61+ Daz script writes — closed by
 *  the `end` row the pickup requires before it may consume (and delete) a file.
 *  The SKU column is left empty on purpose so `mergeProductScans` keys each row
 *  on its NAME — giving two different products the same SKU would (correctly)
 *  merge them. */
function scanCsv(scene: string, products: Array<string>): string {
  return [...scanCsvLines(scene, products), 'end'].join('\n')
}

/** The same scan WITHOUT the closing `end` row — what a pre-v61 script wrote,
 *  and what a v61 file looks like while Daz is still writing it. */
function legacyScanCsv(scene: string, products: Array<string>): string {
  return scanCsvLines(scene, products).join('\n')
}

function scanCsvLines(scene: string, products: Array<string>): Array<string> {
  return [
    'row_type,name,sku,artist,version,product_type,match_method,technical_name,asset_type,source_file,usage,used_by',
    `scene,${scene},${PROJECT}/Kira/daz3d/${scene}.duf`,
    ...products.map((p) => `product,${p},,Meipe,1.0,Anatomy,File Match,,,,Figure,Node`),
  ]
}

/** Where Daz drops its output for this character. */
async function dropDir(id: string): Promise<string> {
  const project = await storage.readManifest(PROJECT)
  return storage.productScanDir(project.id, id)
}

describe('product pickup', () => {
  it('parses the dropped CSVs into the meta folder and deletes them', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/Kira.csv`, scanCsv('KiraDefault', ['Golden Palace']))
    files.set(`${drop}/KiraSummer.csv`, scanCsv('KiraSummer', ['Beachwear']))

    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })

    expect(result.exists).toBe(true)
    expect(result.scan?.products.map((p) => p.name)).toEqual(['Beachwear', 'Golden Palace'])
    expect(result.path).toBe(`${META}/products.json`)
    // The transport is gone — only once its contents were safely stored.
    expect(files.has(`${drop}/Kira.csv`)).toBe(false)
    expect(files.has(`${drop}/KiraSummer.csv`)).toBe(false)
    const stored = parseCharacterProductsText(files.get(`${META}/products.json`) as string)
    expect(stored.scans.map((s) => s.sceneName)).toEqual(['KiraDefault', 'KiraSummer'])
  })

  it('a re-scan of ONE scene keeps the other scenes it never covered', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Golden Palace']))
    files.set(`${drop}/b.csv`, scanCsv('KiraSummer', ['Beachwear']))
    await fetchProductScan({ data: { projectId: PROJECT, id } })

    // Daz runs again, this time only for the default scene.
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Dicktator']))
    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })

    expect(result.scan?.products.map((p) => p.name)).toEqual(['Beachwear', 'Dicktator'])
    expect(result.scenes.map((s) => s.scene)).toEqual(['KiraDefault', 'KiraSummer'])
  })

  it('leaves an empty/truncated-before-scene CSV on disk, and still takes in the good ones', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/good.csv`, scanCsv('KiraDefault', ['Golden Palace']))
    // The parser is TOTAL: an empty file "parses" to a scan with no scene and no
    // products. Consuming it would store junk under the '' key (replacing a real
    // unsaved-scene entry) and DELETE the file — the only copy of the results if
    // it was a scan Daz had not finished writing. It must stay on disk.
    files.set(`${drop}/empty.csv`, '')

    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })

    expect(result.scan?.products.map((p) => p.name)).toEqual(['Golden Palace'])
    expect(result.scenes.map((s) => s.scene)).toEqual(['KiraDefault'])
    expect(files.has(`${drop}/good.csv`)).toBe(false)
    expect(files.has(`${drop}/empty.csv`)).toBe(true)
  })

  it('a terminator-less CSV still fresh on disk waits; a settled one is consumed', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    // No `end` row on either: a pre-v61 script's output — or a v61 write still
    // in flight. Age is the only signal separating the two.
    files.set(`${drop}/fresh.csv`, legacyScanCsv('KiraSummer', ['Beachwear']))
    mtimes.set(`${drop}/fresh.csv`, new Date()) // just modified — may be mid-write
    files.set(`${drop}/settled.csv`, legacyScanCsv('KiraDefault', ['Golden Palace']))

    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })

    expect(result.scenes.map((s) => s.scene)).toEqual(['KiraDefault'])
    expect(files.has(`${drop}/settled.csv`)).toBe(false)
    expect(files.has(`${drop}/fresh.csv`)).toBe(true)
    // Once settled, the next pickup takes it.
    mtimes.delete(`${drop}/fresh.csv`)
    const later = await fetchProductScan({ data: { projectId: PROJECT, id } })
    expect(later.scenes.map((s) => s.scene).sort()).toEqual(['KiraDefault', 'KiraSummer'])
    expect(files.has(`${drop}/fresh.csv`)).toBe(false)
  })

  it('a CSV with the end row is consumed immediately, however fresh', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Golden Palace']))
    mtimes.set(`${drop}/a.csv`, new Date()) // the end row proves the write finished

    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })

    expect(result.scenes.map((s) => s.scene)).toEqual(['KiraDefault'])
    expect(files.has(`${drop}/a.csv`)).toBe(false)
  })

  it('ingest: false (the hover preload) reads without consuming anything', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Golden Palace']))

    const result = await fetchProductScan({ data: { projectId: PROJECT, id, ingest: false } })

    // Nothing stored, nothing deleted — the CSV waits for a real visit. Hovering
    // a card must never race the Daz script mid-write.
    expect(result.exists).toBe(false)
    expect(files.has(`${drop}/a.csv`)).toBe(true)
  })

  it('reports nothing for a character that has never been scanned', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })
    expect(result.exists).toBe(false)
    expect(result.scan).toBeNull()
  })

  it('carries a pre-v30 definition’s stored products across before the save strips them', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    // What a v29 definition looked like: the merged product list inline.
    const raw = JSON.parse(files.get(`${PROJECT}/Kira/Kira.json`) as string)
    files.set(
      `${PROJECT}/Kira/Kira.json`,
      JSON.stringify({
        ...raw,
        schemaVersion: 29,
        productsScannedAt: '2026-07-01T00:00:00.000Z',
        products: [
          { name: 'Golden Palace', artist: 'Meipe', scenes: ['KiraDefault', 'KiraSummer'] },
          { name: 'Beachwear', artist: 'Someone', scenes: ['KiraSummer'] },
        ],
        productsUnmatched: [
          { name: 'Some Prop', technicalName: 'prop_1', assetType: 'Node', scenes: ['KiraSummer'] },
        ],
      }),
    )

    // Any save at the current schema drops those fields — this must run first.
    await saveCharacter({ data: { projectId: PROJECT, character: { ...raw, id } } })

    expect(files.has(`${META}/products.json`)).toBe(true)
    const stored = parseCharacterProductsText(files.get(`${META}/products.json`) as string)
    expect(stored.scannedAt).toBe('2026-07-01T00:00:00.000Z')
    expect(stored.scans.map((s) => s.sceneName)).toEqual(['KiraDefault', 'KiraSummer'])
    // Each product landed in every scene it was attributed to.
    expect(stored.scans[0].products.map((p) => p.name)).toEqual(['Golden Palace'])
    expect(stored.scans[1].products.map((p) => p.name)).toEqual(['Golden Palace', 'Beachwear'])
    expect(stored.scans[1].unmatched.map((a) => a.name)).toEqual(['Some Prop'])
    // And the definition no longer carries any of it.
    const saved = JSON.parse(files.get(`${PROJECT}/Kira/Kira.json`) as string)
    expect(saved.products).toBeUndefined()
    expect(saved.productsScannedAt).toBeUndefined()
  })

  it('never overwrites a store that already has scanned results', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Dicktator']))
    await fetchProductScan({ data: { projectId: PROJECT, id } })

    const raw = JSON.parse(files.get(`${PROJECT}/Kira/Kira.json`) as string)
    files.set(
      `${PROJECT}/Kira/Kira.json`,
      JSON.stringify({ ...raw, schemaVersion: 29, products: [{ name: 'Stale', scenes: ['Old'] }] }),
    )
    await saveCharacter({ data: { projectId: PROJECT, character: { ...raw, id } } })

    // The scan is better data than a v29 snapshot — the carry must not clobber it.
    const stored = parseCharacterProductsText(files.get(`${META}/products.json`) as string)
    expect(stored.scans.map((s) => s.sceneName)).toEqual(['KiraDefault'])
  })

  it('the carry runs BEFORE route-load ingest — leftover CSVs cannot strand the definition products', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    // A pre-v30 definition holding products for a scene whose CSV is long gone…
    const raw = JSON.parse(files.get(`${PROJECT}/Kira/Kira.json`) as string)
    files.set(
      `${PROJECT}/Kira/Kira.json`,
      JSON.stringify({
        ...raw,
        schemaVersion: 29,
        products: [{ name: 'Golden Palace', scenes: ['KiraDefault'] }],
      }),
    )
    // …plus a leftover CSV for a DIFFERENT scene still sitting in the drop
    // folder (the old model kept consumed CSVs around for up to 30 days).
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/b.csv`, scanCsv('KiraSummer', ['Beachwear']))

    // First page open after the update: ingest-first would create the store from
    // the leftover alone, and the carry (which bails once a store exists) would
    // then silently discard KiraDefault's products forever.
    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })

    expect(result.scenes.map((s) => s.scene).sort()).toEqual(['KiraDefault', 'KiraSummer'])
    expect(result.scan?.products.map((p) => p.name)).toEqual(['Beachwear', 'Golden Palace'])
  })

  it('a fresh scan replaces the carried (path-less) entry for the same scene, not duplicates it', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const raw = JSON.parse(files.get(`${PROJECT}/Kira/Kira.json`) as string)
    files.set(
      `${PROJECT}/Kira/Kira.json`,
      JSON.stringify({
        ...raw,
        schemaVersion: 29,
        products: [{ name: 'Old Thing', scenes: ['KiraDefault'] }],
      }),
    )
    await saveCharacter({ data: { projectId: PROJECT, character: { ...raw, id } } })

    // The carried entry has no scene path (unrecoverable from a merged v29
    // snapshot); the fresh Daz scan of the same scene carries the full path.
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['New Thing']))
    const result = await fetchProductScan({ data: { projectId: PROJECT, id } })

    expect(result.scenes.map((s) => s.scene)).toEqual(['KiraDefault'])
    expect(result.scan?.products.map((p) => p.name)).toEqual(['New Thing'])
    const stored = parseCharacterProductsText(files.get(`${META}/products.json`) as string)
    expect(stored.scans).toHaveLength(1)
    expect(stored.scans[0].scenePath).toBe(`${PROJECT}/Kira/daz3d/KiraDefault.duf`)
  })

  it('concurrent pickups coalesce — both scenes land, nothing is lost to the race', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Golden Palace']))
    files.set(`${drop}/b.csv`, scanCsv('KiraSummer', ['Beachwear']))

    // Route load and window focus firing together: two interleaved
    // read-modify-write passes (each ending in a delete) could clobber one
    // scene's write while its CSV is already gone. Coalescing pins them to one.
    const [first, second] = await Promise.all([
      fetchProductScan({ data: { projectId: PROJECT, id } }),
      fetchProductScan({ data: { projectId: PROJECT, id } }),
    ])

    for (const result of [first, second]) {
      expect(result.scenes.map((s) => s.scene).sort()).toEqual(['KiraDefault', 'KiraSummer'])
    }
    expect(files.has(`${drop}/a.csv`)).toBe(false)
    expect(files.has(`${drop}/b.csv`)).toBe(false)
  })

  it('a save prunes stored results for scenes the character no longer links', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Golden Palace']))
    files.set(`${drop}/b.csv`, scanCsv('KiraSummer', ['Beachwear']))
    await fetchProductScan({ data: { projectId: PROJECT, id } })

    // The user unlinks the summer scene, then saves.
    const raw = JSON.parse(files.get(`${PROJECT}/Kira/Kira.json`) as string)
    raw.extraScenes = [`${PROJECT}/Kira/daz3d/KiraDefault.duf`]
    await saveCharacter({ data: { projectId: PROJECT, character: { ...raw, id } } })

    const stored = parseCharacterProductsText(files.get(`${META}/products.json`) as string)
    expect(stored.scans.map((s) => s.sceneName)).toEqual(['KiraDefault'])
  })

  it('Clear removes the store', async () => {
    await storage.createProjectManifest(PROJECT, 'Nova')
    const id = seedCharacter()
    const drop = await dropDir(id)
    addDir(drop)
    files.set(`${drop}/a.csv`, scanCsv('KiraDefault', ['Golden Palace']))
    await fetchProductScan({ data: { projectId: PROJECT, id } })
    expect(files.has(`${META}/products.json`)).toBe(true)

    await clearProductScan({ data: { projectId: PROJECT, id } })

    expect(files.has(`${META}/products.json`)).toBe(false)
    expect((await fetchProductScan({ data: { projectId: PROJECT, id } })).exists).toBe(false)
  })
})
