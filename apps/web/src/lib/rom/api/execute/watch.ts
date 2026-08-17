/**
 * The run watch: real file watching over the three files an export run speaks
 * through — the job-file pair in the Daz library's studio scripts root and
 * the verbose progress log in app-data. What makes the Runner handoff feel
 * instant: the pickup rename, every per-row rewrite and the final
 * progress-100 write all land as change events instead of waiting for the
 * UI's next poll tick.
 *
 * Layer 2 of `api/execute/` — imports `primitives.ts`, no sibling above.
 *
 * Watches the two DIRECTORIES rather than the three files: the files appear,
 * get renamed and are deleted as the run progresses — precisely the
 * transitions the watch exists to see — and a directory watch reports all of
 * them no matter which side did it. Events are filtered to the run's own
 * basenames ({@link isExportRunFile}), so unrelated traffic in app-data (a
 * settings save, a scan output) never wakes the UI.
 *
 * Null when watching isn't available — a plain browser, no Daz library, the
 * watch failing to start (the smoke fake's stance) — and the CALLER keeps its
 * interval at full speed then: the watch is an accelerator on top of the
 * poll, never its replacement. fs-watch.ts explains why the poll must
 * survive: notify over SMB shares is best-effort, and the Daz library can
 * live on a NAS.
 */
import * as storage from '../../storage'
import { EXPORT_PROGRESS_FILE, isExportRunFile } from '../../execute-jobs'
import { watchPaths } from '../../../fs-watch.ts'
import type { StopWatching } from '../../../fs-watch.ts'
import { dirname } from '../core'

import { exporterJobFilePaths } from './primitives.ts'

export type { StopWatching }

export async function watchExportRunFiles(onChange: () => void): Promise<StopWatching | null> {
  const paths = await exporterJobFilePaths()
  if (!paths) return null
  const scriptsDir = dirname(paths.pending)
  const appDataDir = dirname(await storage.dataPath(EXPORT_PROGRESS_FILE))
  return watchPaths([scriptsDir, appDataDir], (changed) => {
    if (changed.some(isExportRunFile)) onChange()
  })
}
