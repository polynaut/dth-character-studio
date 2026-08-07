import { ROM_RUN_LOG_FILE } from '@dth/rom'

import { EXECUTE_STAMPS_FILE, EXPORT_FOLDERS_FILE } from './execute-jobs.ts'

/**
 * The app's OWN per-character files — the ones a user never authored and never
 * wants to look at — and the rule for relocating the copies older builds left in
 * the character folder.
 *
 * They all live in the project's hidden meta folder now
 * (`.dcsmeta/characters/<folder>`, see `storage.characterMetaDir`). Before that
 * they sat in the character folder root, mixed in with the Daz scenes and the
 * Houdini projects the user actually put there:
 *
 *  - `.dth_execute_stamps.json` — what DTH Export last handed off per scene.
 *  - `.dth_export_folders.json` — the export folders this layout comprises.
 *  - `.last_rom_run.json`       — the studio's copy of the last ROM run log.
 *  - `dth_rom_run_log.json`     — the Daz-written transport for that log.
 *  - `<Name>_pose_asset.csv`    — the generated Houdini PoseAsset CSV(s), which
 *    the export script copies into the export folder when it runs. Written at
 *    generation time so it is ready and waiting; never edited by hand.
 *
 * This module is pure (names + the match rule) so the relocation rule can be
 * tested without a filesystem; the move itself lives in api/generate.ts.
 */

/** The studio's OWN copy of the last run log. The Daz-written
 *  {@link ROM_RUN_LOG_FILE} is a throwaway transport: `fetchRomRunLog` ingests
 *  it into this file and deletes it. */
export const LAST_ROM_RUN_FILE = '.last_rom_run.json'

/** The fixed-name app-internal files, in no particular order. The PoseAsset
 *  CSVs are NOT here — their names carry the character (and scene) name, so
 *  each caller derives them from the definition it holds. */
export const CHARACTER_INTERNAL_FILES: ReadonlyArray<string> = [
  EXECUTE_STAMPS_FILE,
  EXPORT_FOLDERS_FILE,
  LAST_ROM_RUN_FILE,
  ROM_RUN_LOG_FILE,
]

/**
 * Which of the character folder's top-level file names belong to the app and
 * should move into its meta folder — the intersection of what is actually there
 * with what the studio itself writes, compared case-INSENSITIVELY (Windows
 * resolves names that way, and `characterSlug` preserves the character's own
 * casing, so a case-only rename must still match).
 *
 * An INTERSECTION on purpose, rather than a `*_pose_asset.csv` pattern: the
 * character folder is the user's, and the one thing this migration must never
 * do is move a file the studio didn't write. A CSV the user copied back out of
 * an export folder would match such a pattern; it can't match this list.
 *
 * Returns the names as they appear on disk (so the move uses the real casing).
 */
export function relocatableInternals(
  present: ReadonlyArray<string>,
  owned: ReadonlyArray<string>,
): Array<string> {
  const wanted = new Set(owned.map((name) => name.toLowerCase()))
  return present.filter((name) => wanted.has(name.toLowerCase()))
}
