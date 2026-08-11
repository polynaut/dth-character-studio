import { parseCsvRecords } from './product-scan'
import { sanitizePoseName } from './csv'
import { newMorph } from './types'

import type { Morph } from './types'

/** A pose parsed from a DAZ morph CSV: a display name + its morph applications. */
export interface ImportedPose {
  /** Source frame number (CSV first column) — lets the import filter by range. */
  frame: number
  /** Cleaned, human-readable label (the full property stays on the morph). */
  name: string
  morphs: Array<Morph>
}

/**
 * A short, readable label from a Daz morph property. The full property is always
 * kept on the morph itself — this only shapes the pose's display name.
 *
 * Strips the noise Daz props carry: the HD-level suffix (`_HD2`, `_B_HD4`), the
 * figure/product prefix up to the `head_bs_`/`body_bs_` marker (`Lycan9_head_bs_`,
 * `xMusc_body_bs_`), and leading `Teeth_` / all-caps product codes (`M3DLFC_`):
 *
 *   xMusc_body_bs_AnconeusL_B_HD2          → AnconeusL
 *   Lycan9_head_bs_Head_HD4                → Head
 *   body_bs_M3DLFC_Claws                   → Claws
 *   head_bs_Teeth_M3DLFC_LowerCanines01    → LowerCanines01
 */
export function cleanMorphName(prop: string): string {
  let s = prop.trim()
  s = s.replace(/(_B)?_HD\d*$/i, '')
  s = s.replace(/^.*?(?:head|body)_bs_/i, '')
  s = s.replace(/^Teeth_/i, '')
  s = s.replace(/^[A-Z][A-Z0-9]{2,}_/, '')
  return s.trim() || prop.trim()
}

/**
 * The pose NAME an imported row lands with: {@link cleanMorphName}, then made
 * legal for Houdini.
 *
 * Daz property labels are prose — `Torso Muscular`, `5 Belly Shape Muscular`,
 * `!Breast Large`, `Shape NAVEL FOR PEAR` — and Houdini takes `[A-Za-z0-9_]`
 * only. Imported verbatim, a Scan_Frames CSV therefore arrives as a grid of
 * rows the editor immediately flags red, and the user retypes dozens of names
 * that the studio could have derived. Stripping is the whole fix: `Torso
 * Muscular` → `TorsoMuscular` reads the same to a human and passes.
 *
 * Rewriting an import is not the same thing as rewriting what a user TYPED
 * (which the editor deliberately refuses to do — it flags and lets them decide).
 * Nothing is lost either: the raw property stays on the morph and is what the
 * Parameter-name column shows, so the row still says exactly which Daz morph it
 * drives.
 *
 * Falls back to the raw property when cleaning leaves nothing legal — better a
 * name derived from the prop than an empty required cell.
 */
export function importedPoseName(prop: string): string {
  return sanitizePoseName(cleanMorphName(prop)) || sanitizePoseName(prop)
}

/**
 * Parse a DAZ-exported morph CSV into poses. Each data row is:
 *
 *   frame, , , node, prop, value [, node, prop, value …]
 *
 * a frame index (kept for ordering + the import's range filter) then one or more `(node, prop, value)`
 * triplets (columns 1–2 are unused in the export). Rows without a numeric first
 * column or any complete triplet are skipped — blank lines, headers, and the
 * studio's own section-keyword rows (`RET,0,RestPose`) all fall away. The pose
 * name is the cleaned first property; the raw property is preserved on the morph.
 *
 * Parsed through the package's RFC-4180 reader ({@link parseCsvRecords}), so a
 * BOM (which made the first data row's frame parse NaN and silently dropped
 * that row) and quoted fields containing commas (a node label like
 * `"Hip, twist"` shifted every following triplet under the old naive split)
 * are handled.
 */
export function posesFromDazCsv(text: string): Array<ImportedPose> {
  const poses: Array<ImportedPose> = []
  for (const cols of parseCsvRecords(text)) {
    if (cols.length === 1 && cols[0].trim() === '') continue
    // An empty first cell must be SKIPPED, not read as frame 0: `Number('')`
    // is 0 (finite), which would otherwise import a section-keyword-less row
    // with a blank frame column as a real pose at frame 0.
    if ((cols[0] ?? '').trim() === '') continue
    const frame = Number(cols[0])
    if (!Number.isFinite(frame)) continue
    // Alignment guard, fail-loud: a data row's cells after the first three must
    // come in complete (node, prop, value) triplets. A value written with a
    // locale decimal COMMA (`1,5`) or an unquoted comma in a label splits into
    // an extra cell and shifts every later column — the old tolerant walk then
    // imported wrong-but-finite morphs without a word. Trailing EMPTY cells are
    // fine (a plain trailing comma is not corruption).
    const trimmed = [...cols]
    while (trimmed.length > 3 && (trimmed[trimmed.length - 1] ?? '').trim() === '') trimmed.pop()
    if (trimmed.length > 3 && (trimmed.length - 3) % 3 !== 0) {
      throw new Error(
        `Morph CSV row for frame ${frame} has ${trimmed.length - 3} value cells, which do not form complete (node, property, value) triplets — usually a decimal comma (locale export) or an unquoted comma in a label. Re-export the CSV with '.' decimals, or quote the offending field.`,
      )
    }
    const morphs: Array<Morph> = []
    for (let i = 3; i + 3 <= cols.length; i += 3) {
      const node = (cols[i] ?? '').trim()
      const prop = (cols[i + 1] ?? '').trim()
      const raw = (cols[i + 2] ?? '').trim()
      if (!node || !prop || raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      // New grid rows → new stable ids (schema v19) and auto-base on (v31),
      // exactly as the editor mints them.
      morphs.push(newMorph(node, { prop, value }))
    }
    if (morphs.length === 0) continue
    poses.push({ frame, name: importedPoseName(morphs[0].prop), morphs })
  }
  poses.sort((a, b) => a.frame - b.frame)
  return poses
}
