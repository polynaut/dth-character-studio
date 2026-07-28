import type { SceneWearable } from '#/lib/rom/api/native-types.ts'

/**
 * The groom-candidate heuristic over a scene's `scene_wearables` read, shared
 * by the editor's hair picker (groom-fields) and character creation (which
 * pre-selects the primary scene's detected hair). Pure — the scene `.duf`
 * only gives us labels, so "hair" is a best-effort label match, not
 * authoritative.
 */

/** Hair-ish labels — also floats these to the top of the groom suggestions. */
export const HAIRISH = /hair|brow|lash|beard|wig|cap\b|pony|braid|bang|bun\b|fur/i
/** Body followers + gen assets are never groom candidates. */
export const BODY_FOLLOWER = /^genesis ?9|goldenpalace|dicktator/i

/** Decode a DSON ref ("#Black%20Tie%20Cap_1529") to the node id it points at. */
function refKey(ref: string): string {
  const raw = ref.replace(/^#/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The groom-pickable labels of a scene: top-level conforms only (an item
 *  fitted to another wearable rides along with its parent), body followers
 *  dropped, deduped by label, hair-ish ones first. */
export function groomCandidates(items: Array<SceneWearable>): Array<string> {
  const ids = new Set(items.map((wearable) => wearable.id))
  return items
    .filter((wearable) => !ids.has(refKey(wearable.conformTarget)))
    .filter((wearable) => !BODY_FOLLOWER.test(wearable.label))
    .filter(
      (wearable, index, arr) => arr.findIndex((other) => other.label === wearable.label) === index,
    )
    .sort(
      (a, b) =>
        Number(HAIRISH.test(b.label)) - Number(HAIRISH.test(a.label)) ||
        a.label.localeCompare(b.label),
    )
    .map((wearable) => wearable.label)
}

/** The candidates that read as hair — what "Select all detected hair items"
 *  picks, and what creation pre-selects from the primary scene. */
export function detectedHairLabels(items: Array<SceneWearable>): Array<string> {
  return groomCandidates(items).filter((label) => HAIRISH.test(label))
}
