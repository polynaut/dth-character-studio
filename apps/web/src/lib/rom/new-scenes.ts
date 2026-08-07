import { z } from 'zod'

import { LEGACY_ROM_ANIMATIONS_FOLDER, ROM_ANIMATIONS_FOLDER } from '@dth/rom'

/**
 * Noticing a Daz scene the user just saved into a character's folder.
 *
 * The workflow this serves: you keep working in Daz — an outfit variant, or an
 * old scene you have just cleaned up with `Kill_Animation` — and Save As into
 * the character's scenes folder. Switching back to the studio, the new file is
 * simply there on disk and nothing says so; you have to remember to press **Add
 * scene** and find it again in a picker you just came from.
 *
 * So the studio looks when its window regains focus. The rules are deliberately
 * narrow, because an offer that fires when it shouldn't is worse than no offer:
 *
 * - only `.duf` files under a character's OWN scenes root (`characterScenesRoot`
 *   — a character whose primary lives outside its folder has no root and is
 *   skipped entirely),
 * - never a file any character in the project already links,
 * - never a file the studio ITSELF wrote — the generated ROM animations under
 *   `rom-animations/` are `.duf`s sitting in exactly that tree, and offering to
 *   "add" one would be the tool tripping over its own output,
 * - never one the user has already declined AT THIS VERSION (see
 *   {@link isDismissed}).
 *
 * The logic here is pure so all four rules are testable without a filesystem;
 * `api/new-scenes.ts` supplies the reads.
 */

/** The per-project record of declined scenes, in the project's `.dcsmeta`. */
export const NEW_SCENES_DISMISSED_FILE = 'new-scenes-dismissed.json'

export const dismissedStoreSchema = z.object({
  version: z.literal(1).default(1),
  /** Lower-cased '/'-separated path → the mtime it carried when declined. */
  scenes: z.record(z.string(), z.number()).default({}),
})
export type DismissedStore = z.infer<typeof dismissedStoreSchema>

export function emptyDismissed(): DismissedStore {
  return { version: 1, scenes: {} }
}

/** Tolerant read — an unreadable or hand-edited store is an empty one, never an
 *  error: the worst it can cost is one more offer. */
export function parseDismissed(json: string): DismissedStore {
  try {
    return dismissedStoreSchema.parse(JSON.parse(json))
  } catch {
    return emptyDismissed()
  }
}

export function dismissedJson(store: DismissedStore): string {
  return JSON.stringify(store, null, 2)
}

/** The key a path is recorded under. Windows paths: separators and case are not
 *  differences (the same fold every other path compare in this app uses). */
export function sceneKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * Whether this exact VERSION of the file was declined.
 *
 * Keyed on the mtime, not the path alone, and that is the whole design: "not
 * now" on a half-finished scene must not bury it forever. Save over it and the
 * mtime moves, so the studio asks again — which is what a user who just edited
 * the file expects. A permanent dismissal would silently hide the fixed
 * version, and nothing in the UI would ever mention it again.
 */
export function isDismissed(store: DismissedStore, path: string, mtimeMs: number): boolean {
  const seen = store.scenes[sceneKey(path)]
  return seen !== undefined && seen === mtimeMs
}

/** Record these paths as declined at the mtime they carry now. */
export function withDismissed(
  store: DismissedStore,
  entries: ReadonlyArray<{ path: string; mtimeMs: number }>,
): DismissedStore {
  const scenes = { ...store.scenes }
  for (const entry of entries) scenes[sceneKey(entry.path)] = entry.mtimeMs
  return { ...store, scenes }
}

/**
 * Drop records for scenes that are no longer loose on disk.
 *
 * Applied on every write, against the paths the scan just saw. Without it the
 * record grows for the lifetime of the project — every scene ever declined,
 * every one later added or deleted, kept forever in a file nothing prunes. It
 * is small, but "app-generated data with no retention bound" is exactly the
 * shape that fills a disk somewhere else in this app, so it gets one here.
 */
export function pruneDismissed(
  store: DismissedStore,
  stillLoose: ReadonlyArray<string>,
): DismissedStore {
  const keep = new Set(stillLoose.map(sceneKey))
  const scenes: Record<string, number> = {}
  for (const [key, mtime] of Object.entries(store.scenes)) {
    if (keep.has(key)) scenes[key] = mtime
  }
  return { ...store, scenes }
}

/** A `.duf` on disk under some character's scenes root. */
export interface FoundScene {
  path: string
  characterId: string
  characterName: string
  mtimeMs: number
}

/** Anything under a `rom-animations/` (or the legacy `.ROM_Animations/`) folder
 *  — the studio's OWN generated scenes, which must never be offered. Matched on
 *  a path SEGMENT so a user folder merely containing the words cannot trip it. */
export function isGeneratedScene(relPath: string): boolean {
  const segments = relPath.replace(/\\/g, '/').toLowerCase().split('/')
  return (
    segments.includes(ROM_ANIMATIONS_FOLDER.toLowerCase()) ||
    segments.includes(LEGACY_ROM_ANIMATIONS_FOLDER.toLowerCase())
  )
}

/**
 * The scenes worth offering: found on disk, linked by nobody, not declined at
 * this version.
 *
 * `linked` is every scene path the project's characters carry (primary AND
 * extras, across ALL characters — a scene sitting in one character's folder can
 * legitimately be linked by another, and offering it again would produce the
 * "already linked to X" hard fail in the add dialog).
 */
export function offerableScenes({
  found,
  linked,
  dismissed,
}: {
  found: ReadonlyArray<FoundScene>
  linked: ReadonlyArray<string>
  dismissed: DismissedStore
}): Array<FoundScene> {
  const taken = new Set(linked.map(sceneKey))
  return found.filter(
    (scene) => !taken.has(sceneKey(scene.path)) && !isDismissed(dismissed, scene.path, scene.mtimeMs),
  )
}
