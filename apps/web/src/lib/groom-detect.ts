import { sceneOverrideSchema } from '@dth/rom'

import { normalizeSceneKey } from '#/lib/rom/execute-jobs.ts'

import type { SceneWearable } from '#/lib/rom/api/native-types.ts'
import type { SceneOverride } from '@dth/rom'

/**
 * The groom-candidate heuristic over a scene's `scene_wearables` read, shared
 * by the editor's hair picker (groom-fields) and every path that links a scene
 * to a character (which pre-selects that scene's detected hair — see
 * {@link seedSceneHair}). Pure — the scene `.duf` only gives us labels, so
 * "hair" is a best-effort label match, not authoritative.
 */

/** Hair-ish labels — also floats these to the top of the groom suggestions.
 *  Beyond the literal hair words, the common HAIRSTYLE vocabulary counts too
 *  ("Bixie Cut", "Shag", "Updo"… name the style, never the word "hair").
 *  Deliberately NOT here, measured against real product names: `cut` ("Laser
 *  Cut" outfits), `fringe` (fringe jackets), `weave` (fabric weaves). */
export const HAIRISH =
  /hair|brow|lash|beard|wig|cap\b|pony|braid|bang|bun\b|fur|pixie|bixie|\bbob\b|shag|updo|curl|dread|afro|mohawk|tress|pigtail|twintail|topknot|chignon|cornrow|\blocs\b|mane\b/i
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
 *  picks, and what a newly linked scene pre-selects. */
export function detectedHairLabels(items: Array<SceneWearable>): Array<string> {
  return groomCandidates(items).filter((label) => HAIRISH.test(label))
}

/**
 * THE single rule for pre-selecting a newly linked scene's hair — used by every
 * way a scene reaches a character: creation (api/characters), the first link of
 * a primary, ADDING an extra scene, REPLACING the primary, and RELINKING a
 * missing primary (which first repoints an existing record to the new path — a
 * relink is the same scene moved, so a curated list follows the file and only a
 * record-less scene seeds). It used to be inlined at the first two and missing
 * everywhere else, where it matters most: an outfit variant (and a replacement
 * primary) is exactly the scene that brings its own hair, and unlisted hair
 * rides into the FBX.
 *
 * Returns the scene's new `sceneOverrides` array, or **null** when there is
 * nothing to do — an unreadable scan, no detected hair, or a record that
 * already exists for this scene (never clobber a list the user curated, or one
 * a re-add would overwrite).
 *
 * Best-effort by nature: the `.duf` only yields labels, so the guess can
 * overshoot — the editor's picker is where it gets trimmed.
 */
export function seedSceneHair(
  scenePath: string,
  scan: { items: Array<SceneWearable>; error: string },
  existing: ReadonlyArray<SceneOverride>,
): Array<SceneOverride> | null {
  if (scan.error !== '') return null
  // Same key normalization as `groomSceneMap`/`normalizeSceneKey` — every other
  // scene-path compare is separator/case-insensitive, so an existing record
  // stored with the other slashes (or case) must still count as "exists".
  const key = normalizeSceneKey(scenePath)
  if (existing.some((o) => normalizeSceneKey(o.scenePath) === key)) return null
  const hair = detectedHairLabels(scan.items)
  if (hair.length === 0) return null
  return [
    ...existing,
    {
      ...sceneOverrideSchema.parse({ scenePath }),
      hair: hair.map((nodeLabel) => ({ nodeLabel })),
    },
  ]
}
