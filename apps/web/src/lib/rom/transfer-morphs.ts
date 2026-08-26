import type { MorphIndexEntry } from './api/characters'

/**
 * The TS mirror of `Prepare_For_Transfer.dsa`'s matching — what the Settings →
 * Daz scripts tab uses to show, under each entry, which indexed G8/8.1 dials
 * that entry would zero. The rule lives on BOTH sides of the install boundary
 * (the baked script matches at run time in Daz, this half previews it in the
 * UI), so the two must not drift: an entry is compared normalized — lowercase,
 * spaces/underscores/dashes stripped — by CONTAINS against a dial's internal
 * name and its UI label. `transfer-morphs.test.ts` pins the same examples the
 * script's comments promise ("Breasts Size" ↔ `PBMBreastsSize`, "Nipple"
 * covers Nipples Tip Adjust).
 */

/** `normalize()` from the script: lowercase, spaces/underscores/dashes gone. */
export function normalizeTransferEntry(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '')
}

/** The indexed dials this entry would zero — `shouldZero` over the index's
 *  name + label (the script also checks the modifier name, which the index
 *  does not carry separately; for DzMorph dials it equals the internal name).
 *  An empty/whitespace entry matches nothing — the script drops it too. */
export function matchingTransferDials(
  entry: string,
  index: ReadonlyArray<MorphIndexEntry>,
): Array<MorphIndexEntry> {
  const needle = normalizeTransferEntry(entry)
  if (!needle) return []
  return index.filter(
    (e) =>
      normalizeTransferEntry(e.name).includes(needle) ||
      normalizeTransferEntry(e.label).includes(needle),
  )
}
