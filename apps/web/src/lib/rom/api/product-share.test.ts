import { beforeEach, describe, expect, it, vi } from 'vitest'

// maybeSubmitProductShare is the gatekeeper between the scan-ingest flow and
// the network: these tests pin the guard ORDER promises (no opt-in → no
// invoke at all), the sent-hash dedupe, and that a failed delivery is retried
// while a delivered payload never re-sends. The endpoint constant is
// overridden here — the shipped build has '' and must stay inert, which the
// first case pins with the real semantics (configured=false path).

const files = new Map<string, string>()
const invokes: Array<{ cmd: string; args: any }> = []
let invokeStatus = 201
let settings: Record<string, unknown> = { shareProductScans: true }

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (cmd: string, args: unknown) => {
    invokes.push({ cmd, args })
    return invokeStatus
  },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: async (p: string) => {
    const hit = files.get(p)
    if (hit === undefined) throw new Error(`no such file: ${p}`)
    return hit
  },
}))

vi.mock('../storage', () => ({
  getSettings: async () => settings,
  dataPath: async (name?: string) => (name ? `/appdata/${name}` : '/appdata'),
  studioVersion: async () => '0.93.0',
  writeTextFileAtomic: async (p: string, text: string) => {
    files.set(p, text)
  },
}))

// Keep the real builder/hash, flip only the endpoint on: the shipped '' would
// (correctly) short-circuit every case below.
vi.mock('../product-share.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../product-share.ts')>()),
  PRODUCT_SHARE_ENDPOINT: 'https://ingest.example.com/v1/submissions',
}))

import { maybeSubmitProductShare } from './product-share.ts'

import type { CharacterProductsFile } from '../character-products.ts'

const store = (name = 'Adventure Clothes'): CharacterProductsFile => ({
  version: 1,
  scannedAt: '2026-09-01T00:00:00.000Z',
  scans: [
    {
      sceneName: 'KiraDefault',
      scenePath: 'D:/DTH Projects/Demo/Kira/daz3d/KiraDefault.duf',
      scannedAt: '2026-09-01T00:00:00.000Z',
      products: [
        {
          name,
          sku: '',
          artist: 'Luthbellina',
          version: '1.2',
          productType: 'Clothing',
          matchMethod: 'Third-Party Match',
          usage: '',
          usedBy: '',
          scenes: ['KiraDefault'],
        },
      ],
      unmatched: [],
    },
  ],
})

beforeEach(() => {
  files.clear()
  invokes.length = 0
  invokeStatus = 201
  settings = { shareProductScans: true }
})

describe('maybeSubmitProductShare', () => {
  it('submits a stripped payload and remembers its hash', async () => {
    await maybeSubmitProductShare(store())
    expect(invokes).toHaveLength(1)
    expect(invokes[0].cmd).toBe('submit_product_share')
    const body = JSON.parse(invokes[0].args.request.body)
    expect(body.v).toBe(1)
    expect(body.products[0].name).toBe('Adventure Clothes')
    // The privacy strip holds at the wire, not just in the builder's tests.
    expect(invokes[0].args.request.body).not.toContain('KiraDefault')
    expect(files.get('/appdata/product-share.json')).toContain('"hashes"')
  })

  it('never invokes without the opt-in', async () => {
    settings = { shareProductScans: false }
    await maybeSubmitProductShare(store())
    expect(invokes).toHaveLength(0)
  })

  it('an already-sent payload is not sent again; changed content is', async () => {
    await maybeSubmitProductShare(store())
    await maybeSubmitProductShare(store())
    expect(invokes).toHaveLength(1)
    await maybeSubmitProductShare(store('New Outfit'))
    expect(invokes).toHaveLength(2)
  })

  it('a non-2xx answer leaves the hash unrecorded, so the next ingest retries', async () => {
    invokeStatus = 503
    await maybeSubmitProductShare(store())
    expect(files.has('/appdata/product-share.json')).toBe(false)
    invokeStatus = 200 // the server's "exact duplicate" answer counts as delivered
    await maybeSubmitProductShare(store())
    expect(invokes).toHaveLength(2)
    await maybeSubmitProductShare(store())
    expect(invokes).toHaveLength(2)
  })

  it('an empty scan store submits nothing', async () => {
    await maybeSubmitProductShare({ version: 1, scannedAt: '', scans: [] })
    expect(invokes).toHaveLength(0)
  })
})
