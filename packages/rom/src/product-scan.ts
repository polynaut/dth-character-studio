import type { ProductRecord, UnmatchedAsset } from './types'

/**
 * The result of a single product scan (one Daz scene): the installed products
 * matched in the open scene, the scene assets that matched nothing, and which
 * scene it was — `sceneName` is the scene file's basename (e.g. "KiraDefault_G9_GP"),
 * `scenePath` its full `.duf` path. Both are '' for a scan of an unsaved scene.
 */
export interface ProductScan {
  sceneName: string
  scenePath: string
  products: Array<ProductRecord>
  unmatched: Array<UnmatchedAsset>
}

/**
 * Several per-scene scans merged into one view for display: every distinct scanned
 * scene, and the union of products / unmatched assets each carrying the `scenes`
 * (basenames) it was found in. This is what the character page renders.
 */
export interface MergedProductScan {
  scenes: Array<string>
  products: Array<ProductRecord>
  unmatched: Array<UnmatchedAsset>
}

/**
 * Split RFC-4180 CSV text into records (each a list of fields). Handles quoted
 * fields containing commas, embedded newlines and doubled quotes (`""` → `"`) —
 * product names and asset labels routinely carry `,` `&` and quotes, so the
 * `Scan_Products_<Name>.dsa` writer quotes them and this must read them back.
 */
function parseCsvRecords(text: string): Array<Array<string>> {
  const records: Array<Array<string>> = []
  let field = ''
  let record: Array<string> = []
  let inQuotes = false
  // Strip a leading BOM if present; normalise nothing else (quotes can hold \r\n).
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++ // consume the escaped quote
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      record.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      // End the record on a newline; swallow the \n of a \r\n pair.
      if (c === '\r' && s[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else {
      field += c
    }
  }
  // Flush a final record that wasn't terminated by a trailing newline.
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}

/**
 * Parse the CSV written by `DthScanProducts` (DthProducts.dsa). Columns are fixed:
 * `row_type,name,sku,artist,version,product_type,match_method,technical_name,asset_type,source_file,usage,used_by`.
 * Column 0 dispatches the row kind: `product` → a matched {@link ProductRecord},
 * `asset` → an {@link UnmatchedAsset}. The header row and blank lines are skipped;
 * unknown row types are ignored (forward-compatible — missing trailing columns
 * just default to '').
 */
export function parseProductScanCsv(text: string): ProductScan {
  const products: Array<ProductRecord> = []
  const unmatched: Array<UnmatchedAsset> = []
  let sceneName = ''
  let scenePath = ''
  for (const cols of parseCsvRecords(text)) {
    const kind = (cols[0] ?? '').trim()
    if (kind === '' || kind === 'row_type') continue // blank line / header
    if (kind === 'scene') {
      sceneName = (cols[1] ?? '').trim()
      scenePath = (cols[2] ?? '').trim()
    } else if (kind === 'product') {
      const name = (cols[1] ?? '').trim()
      if (!name) continue
      products.push({
        name,
        sku: (cols[2] ?? '').trim(),
        artist: (cols[3] ?? '').trim(),
        version: (cols[4] ?? '').trim(),
        productType: (cols[5] ?? '').trim(),
        matchMethod: (cols[6] ?? '').trim(),
        usage: (cols[10] ?? '').trim(),
        usedBy: (cols[11] ?? '').trim(),
        scenes: [],
      })
    } else if (kind === 'asset') {
      const name = (cols[1] ?? '').trim()
      if (!name && !(cols[7] ?? '').trim()) continue
      unmatched.push({
        name,
        technicalName: (cols[7] ?? '').trim(),
        assetType: (cols[8] ?? '').trim(),
        sourceFile: (cols[9] ?? '').trim(),
        artist: (cols[3] ?? '').trim(),
        version: (cols[4] ?? '').trim(),
        scenes: [],
      })
    }
  }
  return { sceneName, scenePath, products, unmatched }
}

/** Union two "; "-joined lists, de-duplicated, order-preserving. '' inputs ignored. */
function unionJoined(a: string, b: string): string {
  const out: Array<string> = []
  for (const part of [...a.split('; '), ...b.split('; ')]) {
    const v = part.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out.join('; ')
}

/**
 * Merge several per-scene scans into one view. Products are de-duplicated by SKU
 * (or name when no SKU), unmatched assets by name + technical name; each merged
 * record's `scenes` lists every scanned scene it appeared in. First occurrence wins
 * for the descriptive fields. A scan of an unsaved scene is labelled "(unsaved
 * scene)" so it still appears. Scene order follows the order scans are given.
 */
export function mergeProductScans(scans: Array<ProductScan>): MergedProductScan {
  const scenes: Array<string> = []
  const productByKey = new Map<string, ProductRecord>()
  const unmatchedByKey = new Map<string, UnmatchedAsset>()
  for (const scan of scans) {
    const scene = scan.sceneName || '(unsaved scene)'
    if (!scenes.includes(scene)) scenes.push(scene)
    for (const p of scan.products) {
      const key = (p.sku || p.name).toLowerCase()
      const existing = productByKey.get(key)
      if (existing) {
        if (!existing.scenes.includes(scene)) existing.scenes.push(scene)
        // Union what the product was used by/as across scenes, so the expanded
        // view shows every morph/node that found it in any scanned scene.
        existing.usedBy = unionJoined(existing.usedBy, p.usedBy)
        existing.usage = unionJoined(existing.usage, p.usage)
      } else {
        productByKey.set(key, { ...p, scenes: [scene] })
      }
    }
    for (const a of scan.unmatched) {
      const key = JSON.stringify([a.name.toLowerCase(), a.technicalName.toLowerCase()])
      const existing = unmatchedByKey.get(key)
      if (existing) {
        if (!existing.scenes.includes(scene)) existing.scenes.push(scene)
      } else {
        unmatchedByKey.set(key, { ...a, scenes: [scene] })
      }
    }
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  return {
    scenes,
    products: [...productByKey.values()].sort(byName),
    unmatched: [...unmatchedByKey.values()].sort(byName),
  }
}
