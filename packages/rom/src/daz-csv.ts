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
 * Parse a DAZ-exported morph CSV into poses. Each data row is:
 *
 *   frame, , , node, prop, value [, node, prop, value …]
 *
 * a frame index (kept for ordering + the import's range filter) then one or more `(node, prop, value)`
 * triplets (columns 1–2 are unused in the export). Rows without a numeric first
 * column or any complete triplet are skipped — blank lines, headers, and the
 * studio's own section-keyword rows (`RET,0,RestPose`) all fall away. The pose
 * name is the cleaned first property; the raw property is preserved on the morph.
 */
export function posesFromDazCsv(text: string): Array<ImportedPose> {
  const poses: Array<ImportedPose> = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cols = line.split(',')
    const frame = Number(cols[0])
    if (!Number.isFinite(frame)) continue
    const morphs: Array<Morph> = []
    for (let i = 3; i + 3 <= cols.length; i += 3) {
      const node = (cols[i] ?? '').trim()
      const prop = (cols[i + 1] ?? '').trim()
      const raw = (cols[i + 2] ?? '').trim()
      if (!node || !prop || raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      morphs.push({ node, prop, value })
    }
    if (morphs.length === 0) continue
    poses.push({ frame, name: cleanMorphName(morphs[0].prop), morphs })
  }
  poses.sort((a, b) => a.frame - b.frame)
  return poses
}
