import { exists, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { EXPORT_FOLDERS_FILE, migratedExportFolder, parseExportFoldersRecord } from '../execute-jobs.ts'
import { characterExportRoot } from '#/lib/scene-subfolder.ts'
import { normalizePathLower } from '#/lib/path.ts'
import { joinPath, locateCharacter } from './core'

import type { Character } from '@dth/rom'
import type { ProjectInfo } from './core'

// Relocating a character's EXPORT ROOT — moving the already-exported files to
// where the derivation now says they belong, and repointing the definition.
//
// Its own module because BOTH `saveCharacter` (api/characters.ts) and Refresh
// assets (api/generate.ts) need it, and those two already import each other in
// the other direction — putting it in either one makes a dependency cycle the
// `import(no-cycle)` lint rule rejects. Nothing here reaches back into either.

/**
 * Carry a character's already-exported files into the fixed export root before
 * the save repoints `exportPath` at it — otherwise a relocation would silently
 * strand them (often gigabytes) at the old location.
 *
 * Written for schema v29 (when the export directory stopped being user-chosen)
 * and reused unchanged for the later move of the root itself, from
 * `<dazSubdir>/dth-exports` to `<houdiniSubdir>/daz-export` — which is the point
 * of deriving the trigger from the paths rather than from a version flag.
 *
 * Runs at most once per character per relocation, and needs no version flag to
 * know: it fires only while the STORED path still differs from the derived one,
 * which the save itself then fixes. Idempotent by construction.
 *
 * Returns whether the roots differed, so the caller knows the definition needs
 * writing. Deliberately NOT "the move succeeded": the save re-derives
 * `exportPath` unconditionally, so a caller that skipped it on a partial move
 * would leave the two halves disagreeing in a way a manual save never produces.
 *
 * What moves is exactly what the studio recorded as its own export folders
 * ({@link EXPORT_FOLDERS_FILE}) — never the whole old directory, which for the
 * default layout WAS the character's Houdini folder and holds the user's
 * `.hiplc` files. Each recorded folder loses its dead v27
 * `<project>/dth-export/` prefix and keeps the rest, so nested scene subfolders
 * survive. Best-effort throughout: a failed move leaves the files where they
 * are (the Rust side never deletes a source without a complete copy), and the
 * save proceeds either way — a blocked migration must not block editing.
 */
export async function migrateExportRoot(
  project: { path: string; houdiniSubdir?: string },
  character: Character,
  lib: string,
): Promise<boolean> {
  // TRUE once the stored root is known to differ from the derived one — see the
  // return note above.
  let needed = false
  if (!isTauri()) return needed
  try {
    const oldRoot = character.exportPath.trim().replace(/\\/g, '/')
    if (!oldRoot) return needed
    const location = await locateCharacter(lib, character.id)
    if (!location?.relFolder) return needed
    // The SAME derivation the save writes. It must stay literally the same call:
    // while this trigger spelled the anchor differently from the save, a
    // character whose layout disagreed with the project default re-fired it on
    // EVERY save and moved its exports back and forth between two trees.
    const newRoot = characterExportRoot(location.folderAbs, project.houdiniSubdir)
    if (!newRoot || normalizePathLower(newRoot) === normalizePathLower(oldRoot)) return needed
    // Past here the roots DIFFER, which is the whole answer the caller needs.
    needed = true

    // The record lives in the character's meta folder — but this save can be the
    // FIRST one after the v0.68 relocation, and the relocation itself only runs
    // on generation (which comes after this). So fall back to the old spot in
    // the character folder; missing it here would strand exactly the gigabytes
    // this function exists to carry.
    const metaRecord = joinPath(
      storage.characterMetaDir(project.path, location.relFolder, character.id),
      EXPORT_FOLDERS_FILE,
    )
    const legacyRecord = joinPath(location.folderAbs, EXPORT_FOLDERS_FILE)
    const recordPath = (await exists(metaRecord))
      ? metaRecord
      : (await exists(legacyRecord))
        ? legacyRecord
        : ''
    if (!recordPath) return needed
    const recorded = parseExportFoldersRecord(await readTextFile(recordPath))
    // A record written for a DIFFERENT export dir describes folders that aren't
    // at `oldRoot` — the same guard the housekeeping's delete side applies.
    if (!recorded || normalizePathLower(recorded.exportDir) !== normalizePathLower(oldRoot)) {
      return needed
    }

    const moves = recorded.folders
      .map((rel) => ({
        from: joinPath(oldRoot, rel),
        to: joinPath(newRoot, migratedExportFolder(rel)),
      }))
      .filter((m) => normalizePathLower(m.from) !== normalizePathLower(m.to))
    if (moves.length === 0) return needed

    const failures = z.array(z.string()).parse(await invoke('move_exports', { request: { moves } }))
    if (failures.length > 0) {
      console.warn(`Export migration left ${failures.length} folder(s) behind:\n${failures.join('\n')}`)
    }
    // The record still names the OLD dir + the old nesting. Drop it: the next
    // generation writes a fresh one for the layout that now exists, and a stale
    // record would aim the housekeeping's delete at the wrong tree.
    await remove(recordPath)
    // The old root itself is now an empty shell the user never asked for, and
    // `move_exports` only ever moved what was INSIDE it. `remove_dir_if_empty`
    // is the whole safety argument: a root still holding something (a scene
    // subfolder whose move failed, or files the user put there) is left alone,
    // and the command refuses a symlink. Best-effort — an empty folder is never
    // worth reporting, let alone failing a save over.
    try {
      // Parsed, not a bare invoke — the same z.enum spelling `sweepHoudiniProjectDirs`
      // uses for this command (the FFI ritual in .ai/conventions.md: a primitive
      // return still goes through a schema, it just needs no fixture). Nothing
      // acts on the verdict here, but a silently changed contract should fail
      // loudly in one place rather than be swallowed by two different `catch`es.
      z.enum(['removed', 'absent', 'not-empty', 'not-a-directory']).parse(
        await invoke('remove_dir_if_empty', { request: { dirPath: oldRoot } }),
      )
    } catch {
      // locked or unreadable: an empty leftover folder, nothing more
    }
  } catch {
    // Never fail a save over the migration — the files stay where they are, and
    // the caller still repoints the definition, exactly as it would have if the
    // move had found nothing to carry.
  }
  return needed
}

/**
 * The migration AND the save that persists it — the whole-library half of what a
 * character save does, for **Tools → Refresh assets**.
 *
 * {@link migrateExportRoot} moves the FILES; `storage.saveCharacter` is what
 * rewrites `exportPath`, and the two must happen together or the definition and
 * the disk disagree (files at the new root under a definition naming the old one
 * sends the next export straight back to the vacated folder). In the editor
 * `saveCharacter` pairs them; this is the pairing for the sweep, which is the
 * only way a relocation reaches a library the user isn't opening character by
 * character.
 *
 * Returns whether anything was relocated, for the run report.
 *
 * Deliberately NOT driven by a version flag. The export-root move bumped
 * `RUNTIME_VERSION`, which does make Refresh visit every character — but the
 * regeneration it triggers reads the STORED `exportPath`, so on its own the bump
 * would have re-emitted the OLD folder and then stamped the new version over the
 * staleness that brought the user here. The trigger has to be the path
 * disagreeing with its own derivation, which is exactly what `migrateExportRoot`
 * tests.
 */
export async function relocateExportRoot(
  project: ProjectInfo,
  lib: string,
  character: Character,
  location: storage.CharacterLocation,
): Promise<boolean> {
  try {
    if (!(await migrateExportRoot(project, character, lib))) return false
    await storage.saveCharacter(project, character, lib, { location, character })
    return true
  } catch {
    // Best-effort, like every other repair in this sweep: a character whose
    // files are locked keeps the old root and is picked up by the next run
    // (the trigger stays true until the definition is actually rewritten).
    return false
  }
}
