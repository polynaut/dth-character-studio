/**
 * The ROM run log's life on DISK — the filesystem half of `lib/rom/run-log.ts`
 * (which is pure: parse + merge + per-scene drop, no I/O).
 *
 * A leaf on purpose. Both files live in the character's meta folder and three
 * very different layers retire a report: `characters.ts` (the user dismissing
 * it), `api/execute/jobs.ts`'s DTH Export handoff (which supersedes the whole
 * report) and the same module's single-scene rebuild (which may only retire the
 * one scene it re-runs). `jobs.ts` importing `characters.ts` for it closes an
 * import cycle through `generate.ts`, so the shared part lives here.
 */
import { exists, readTextFile, remove } from '@tauri-apps/plugin-fs'

import { ROM_RUN_LOG_FILE } from '@dth/rom'

import { LAST_ROM_RUN_FILE } from '../character-internals.ts'
import { dropSceneRun, parseRomRunLogText } from '../run-log.ts'
import * as storage from '../storage'
import { join } from '../storage/fs'

/** Both spellings the log lives under, in the character's meta folder: the
 *  studio's store and the Daz-written transport that may not be ingested yet.
 *  Every clear has to reach BOTH — a failure left in an un-ingested transport
 *  comes straight back on the next ingest. */
const RUN_LOG_FILES: ReadonlyArray<string> = [LAST_ROM_RUN_FILE, ROM_RUN_LOG_FILE]

/**
 * Drop BOTH run-log files from a character's meta folder — the studio's stored
 * copy and any Daz-written transport that was never ingested. Best-effort.
 *
 * The DTH Export handoff MUST clear the STORE, not just the on-screen state:
 * the ingest (`fetchRomRunLog`) merges the transport into the store PER SCENE,
 * so a surviving store would fold the previous run's failures into the new
 * run's report — and the character page's focus refetch would put the old red
 * banner (and the red morph rows) straight back while the new run is still
 * working.
 */
export async function clearRomRunLogFiles(metaDir: string): Promise<void> {
  for (const name of RUN_LOG_FILES) {
    try {
      const path = join(metaDir, name)
      if (await exists(path)) await remove(path)
    } catch {
      // best-effort — a locked file just leaves the banner until the next run
    }
  }
}

/**
 * Retire ONE scene's verdict from both run-log files, leaving every other
 * scene's alone. Best-effort, like the wholesale clear.
 *
 * For the single-scene rebuild (`generateRomAnimation`, the scene card's
 * "Generate new ROM"): it re-runs one scene and nothing else, so wiping the log
 * would throw away findings for scenes it never touched — and nothing would
 * bring them back, because nothing is going to re-run them.
 *
 * A file that will not parse is deleted rather than rewritten: it holds nothing
 * attributable to a scene, and the run about to start writes a fresh one.
 */
export async function clearSceneRunLog(metaDir: string, scenePath: string): Promise<void> {
  for (const name of RUN_LOG_FILES) {
    try {
      const path = join(metaDir, name)
      if (!(await exists(path))) continue
      let parsed = null
      try {
        parsed = parseRomRunLogText(await readTextFile(path))
      } catch {
        // Unparseable (corrupt, or torn by a racing Daz write) — same answer as
        // an `unreadable` log: nothing here is attributable to a scene.
      }
      const next = parsed && dropSceneRun(parsed, scenePath)
      if (next === null) {
        await remove(path)
      } else if (next !== parsed) {
        // `dropSceneRun` hands the SAME object back when the scene had no entry
        // — so this only writes when something actually went.
        await storage.writeTextFileAtomic(path, JSON.stringify(next, null, 2))
      }
    } catch {
      // best-effort — a locked file just leaves that scene's rows red until the
      // run it belongs to writes its own verdict over them
    }
  }
}
