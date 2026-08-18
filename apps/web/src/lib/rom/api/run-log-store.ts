/**
 * The ROM run log's life on DISK — the filesystem half of `lib/rom/run-log.ts`
 * (which is pure: parse + merge + per-scene drop, no I/O).
 *
 * A leaf on purpose. Both files live in the character's meta folder and three
 * very different layers retire a report: `characters.ts` (the user dismissing
 * it, which drops the lot), and both handoffs in `api/execute/jobs.ts` — the
 * DTH Export batch and the single-scene rebuild — which retire only the scenes
 * they re-run. `jobs.ts` importing `characters.ts` for it closes an import
 * cycle through `generate.ts`, so the shared part lives here.
 */
import { exists, readTextFile, remove } from '@tauri-apps/plugin-fs'

import { ROM_RUN_LOG_FILE } from '@dth/rom'

import { LAST_ROM_RUN_FILE } from '../character-internals.ts'
import { dropSceneRuns, parseRomRunLogText } from '../run-log.ts'
import * as storage from '../storage'
import { join } from '../storage/fs'

/** Both spellings the log lives under, in the character's meta folder: the
 *  studio's store and the Daz-written transport that may not be ingested yet.
 *  Every clear has to reach BOTH — a failure left in an un-ingested transport
 *  comes straight back on the next ingest. Independent files, so both are
 *  worked in parallel (same shape as `scriptRunFailures`, which reads them). */
const RUN_LOG_FILES: ReadonlyArray<string> = [LAST_ROM_RUN_FILE, ROM_RUN_LOG_FILE]

/**
 * Drop BOTH run-log files from a character's meta folder — the studio's stored
 * copy and any Daz-written transport that was never ingested. Best-effort.
 *
 * The wholesale clear, for the user dismissing the report. A HANDOFF must not
 * use this: it retires only the scenes it re-runs (`clearSceneRunLogs`), or it
 * throws away findings for scenes that have nothing coming to rewrite them.
 *
 * Clearing the STORE matters as much as clearing the screen: the ingest
 * (`fetchRomRunLog`) merges the transport into the store PER SCENE, so a
 * surviving store folds old failures back into the next run's report — and the
 * character page's focus refetch puts the old red banner (and the red morph
 * rows) straight back.
 */
export async function clearRomRunLogFiles(metaDir: string): Promise<void> {
  await Promise.all(
    RUN_LOG_FILES.map(async (name) => {
      try {
        const path = join(metaDir, name)
        if (await exists(path)) await remove(path)
      } catch {
        // best-effort — a locked file just leaves the banner until the next run
      }
    }),
  )
}

/**
 * Retire the named scenes' verdicts from both run-log files, leaving every
 * other scene's alone. Best-effort, like the wholesale clear.
 *
 * This is what BOTH handoffs use, because both re-run a known set of scenes and
 * supersede nothing else: the single-scene rebuild (`generateRomAnimation`) its
 * one scene, the DTH Export batch (`executeCharacterJobs`) whatever the user
 * ticked — see `scenesRetiredByRun` for the rule, including which modes retire
 * anything at all. Wiping the log instead would throw away findings for scenes
 * the run never touches, and nothing would bring them back, because nothing is
 * going to re-run them.
 *
 * A file that will not parse is deleted rather than rewritten: it holds nothing
 * attributable to a scene, and the run about to start writes a fresh one.
 */
export async function clearSceneRunLogs(
  metaDir: string,
  scenePaths: ReadonlyArray<string>,
): Promise<void> {
  if (scenePaths.length === 0) return
  await Promise.all(
    RUN_LOG_FILES.map(async (name) => {
      try {
        const path = join(metaDir, name)
        if (!(await exists(path))) return
        let parsed = null
        try {
          parsed = parseRomRunLogText(await readTextFile(path))
        } catch {
          // Unparseable (corrupt, or torn by a racing Daz write) — same answer
          // as an `unreadable` log: nothing here is attributable to a scene.
        }
        const next = parsed && dropSceneRuns(parsed, scenePaths)
        if (next === null) {
          await remove(path)
        } else if (next !== parsed) {
          // `dropSceneRuns` hands the SAME object back when no named scene had
          // an entry — so this only writes when something actually went.
          await storage.writeTextFileAtomic(path, JSON.stringify(next, null, 2))
        }
      } catch {
        // best-effort — a locked file just leaves those scenes' rows red until
        // the run they belong to writes its own verdict over them
      }
    }),
  )
}
