// The community product-DB ingest Worker — phase 1: collect raw, append-only.
//
// One job: accept opt-in submissions from DTH Character Studio
// (lib/rom/product-share.ts builds them) and store each as an IMMUTABLE row —
// no product tables, no aggregation here. The aggregation/enrichment/export
// pipeline (phase 2+) reads the raw rows and can be re-run from scratch as its
// logic improves; this Worker should stay boring forever.
//
// Privacy posture, enforced server-side as well as client-side: the body is
// shape-checked to the known payload (unknown keys rejected, absolute-looking
// paths rejected), and NOTHING about the sender is stored — no IP, no
// user-agent, no headers. The `x-dth-token` check keeps drive-by junk out; it
// ships inside a public app, so it is spam control, not a security boundary,
// and every stored body stays untrusted input for the aggregator.

export interface Env {
  DB: D1Database
  /** `wrangler secret put INGEST_TOKEN` — must match the app's PRODUCT_SHARE_TOKEN. */
  INGEST_TOKEN: string
}

const MAX_BODY_BYTES = 1_000_000
const MAX_ITEMS = 5_000
const MAX_FIELD = 300

/** Every field of one submission item, checked by hand — the Worker is
 *  dependency-free on purpose (nothing to install, nothing to drift). */
function isShortString(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_FIELD
}

function validProduct(p: unknown): boolean {
  if (typeof p !== 'object' || p === null) return false
  const r = p as Record<string, unknown>
  const keys = ['name', 'sku', 'artist', 'version', 'productType', 'matchMethod']
  if (Object.keys(r).some((k) => !keys.includes(k))) return false
  return keys.every((k) => isShortString(r[k])) && (r.name as string).length > 0
}

function validUnmatched(a: unknown): boolean {
  if (typeof a !== 'object' || a === null) return false
  const r = a as Record<string, unknown>
  const keys = ['name', 'technicalName', 'assetType', 'sourceFile', 'artist', 'version']
  if (Object.keys(r).some((k) => !keys.includes(k))) return false
  if (!keys.every((k) => isShortString(r[k]))) return false
  // The client relativizes source paths; a drive letter, UNC root or absolute
  // slash reaching this far is a bug or a hand-crafted body — reject, never
  // store a user path.
  const source = r.sourceFile as string
  if (/^([a-z]:|\/|\\)/i.test(source)) return false
  return (r.name as string).length > 0 || (r.technicalName as string).length > 0
}

/** The whole payload; returns its version number or null when malformed.
 *  Reject-don't-repair: a body this validator can't vouch for is not raw data
 *  worth keeping, it is junk that would poison every later aggregation. */
function validate(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const r = body as Record<string, unknown>
  if (Object.keys(r).some((k) => !['v', 'app', 'products', 'unmatched'].includes(k))) return null
  if (r.v !== 1) return null
  if (!isShortString(r.app)) return null
  if (!Array.isArray(r.products) || !Array.isArray(r.unmatched)) return null
  if (r.products.length + r.unmatched.length === 0) return null
  if (r.products.length > MAX_ITEMS || r.unmatched.length > MAX_ITEMS) return null
  if (!r.products.every(validProduct) || !r.unmatched.every(validUnmatched)) return null
  return 1
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/v1/submissions') {
      return new Response('not found', { status: 404 })
    }
    if (request.headers.get('x-dth-token') !== env.INGEST_TOKEN) {
      return new Response('forbidden', { status: 403 })
    }
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) {
      return new Response('too large', { status: 413 })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return new Response('not json', { status: 400 })
    }
    const version = validate(parsed)
    if (version === null) {
      return new Response('malformed payload', { status: 422 })
    }
    // Canonical re-serialization, so hash identity ignores whitespace quirks.
    const body = JSON.stringify(parsed)
    const hash = await sha256Hex(body)
    // INSERT OR IGNORE + the UNIQUE hash column = exact-duplicate submissions
    // (the same library rescanned) cost one no-op row attempt, nothing more.
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO submissions (received_at, payload_version, body_hash, body) VALUES (?, ?, ?, ?)',
    )
      .bind(new Date().toISOString(), version, hash, body)
      .run()
    const inserted = (result.meta.changes ?? 0) > 0
    return Response.json({ ok: true, duplicate: !inserted }, { status: inserted ? 201 : 200 })
  },
}
