import { invoke, isTauri } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import * as storage from '../storage'
import { mergedProducts } from '../character-products.ts'
import {
  buildProductSharePayload,
  payloadHash,
  PRODUCT_SHARE_ENDPOINT,
  PRODUCT_SHARE_TOKEN,
} from '../product-share.ts'

import type { CharacterProductsFile } from '../character-products.ts'

// The community product-DB submission, phase 1: the I/O half. The payload
// rules (and the privacy contract) live in lib/rom/product-share.ts; this
// module decides WHEN to send — after a product-scan ingest, opt-in only —
// and remembers what was already sent so a rescan of an unchanged library
// costs the server nothing.

/** Whether this build can share at all — '' endpoint = dormant feature; the
 *  Settings toggle renders disabled with a note instead of lying. */
export function productShareConfigured(): boolean {
  return PRODUCT_SHARE_ENDPOINT !== ''
}

/** App-data record of recently submitted payload hashes. A LIST with a cap,
 *  not one hash: several characters share the machine and each submits its own
 *  payload, so "the last hash" alone would resubmit A and B alternately
 *  forever. Bounded per the housekeeping rule — app-written data never grows
 *  without limit. */
const SENT_FILE = 'product-share.json'
const SENT_CAP = 100

const sentFileSchema = z.object({
  hashes: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((h) => typeof h === 'string') : []),
    z.array(z.string()),
  ),
})

async function readSentHashes(): Promise<Array<string>> {
  try {
    const raw = await readTextFile(await storage.dataPath(SENT_FILE))
    return sentFileSchema.parse(JSON.parse(raw)).hashes
  } catch {
    return [] // missing/corrupt = nothing known to be sent — resend and re-learn
  }
}

async function rememberSentHash(hash: string): Promise<void> {
  const hashes = [...(await readSentHashes()).filter((h) => h !== hash), hash].slice(-SENT_CAP)
  await storage.writeTextFileAtomic(
    await storage.dataPath(SENT_FILE),
    `${JSON.stringify({ hashes }, null, 2)}\n`,
  )
}

/**
 * Submit one character's product-scan results to the community DB — the call
 * `ingestProductScans` fires after a store write lands. Fire-and-forget BY
 * CONTRACT: every guard misses and every failure returns silently, because
 * this rides inside the scan-ingest flow and must never cost it anything. The
 * guards, in order: a build with an endpoint, the user's opt-in
 * (`shareProductScans`), a non-empty payload, and not-already-sent.
 */
export async function maybeSubmitProductShare(store: CharacterProductsFile): Promise<void> {
  try {
    if (!isTauri() || !productShareConfigured()) return
    const settings = await storage.getSettings()
    if (!settings.shareProductScans) return
    const payload = buildProductSharePayload(await storage.studioVersion(), mergedProducts(store))
    if (!payload) return
    const hash = payloadHash(payload)
    if ((await readSentHashes()).includes(hash)) return
    const status = z.number().parse(
      await invoke('submit_product_share', {
        request: {
          url: PRODUCT_SHARE_ENDPOINT,
          token: PRODUCT_SHARE_TOKEN,
          body: JSON.stringify(payload),
        },
      }),
    )
    // 2xx = the server has it (200-duplicate included). A 4xx/5xx leaves the
    // hash unrecorded so the next ingest retries.
    if (status >= 200 && status < 300) await rememberSentHash(hash)
  } catch {
    // fire-and-forget: a failed share never surfaces into the scan flow
  }
}
