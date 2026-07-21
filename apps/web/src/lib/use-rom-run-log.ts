import { useCallback, useMemo, useState } from 'react'

import { dismissRomRunLog, fetchRomRunLog } from '#/lib/rom/api.ts'
import { useRefetchOnFocus } from '@dth/ui'

export type RomRunLog = Awaited<ReturnType<typeof fetchRomRunLog>>

/**
 * The ROM run log written by the Daz-side script (ingested into the studio's
 * own store on read) plus the editor's "reveal frame N" signal for it. The log
 * is re-read whenever the window regains focus, so problems from a run surface
 * the moment the user switches back from Daz to the studio. `failedFrames` is
 * memoized — it feeds the memoized ROM subtree, so its identity may only
 * change when the log does.
 */
export function useRomRunLog(projectId: string, characterId: string, initial: RomRunLog) {
  const [romRunLog, setRomRunLog] = useState(initial)
  useRefetchOnFocus(() => {
    void fetchRomRunLog({ data: { projectId, id: characterId } }).then(setRomRunLog)
  }, [projectId, characterId])

  const dismiss = useCallback(async () => {
    setRomRunLog(null)
    await dismissRomRunLog({ data: { projectId, id: characterId } })
  }, [projectId, characterId])

  const hasRunProblems = !!romRunLog && !romRunLog.ok
  // Frames whose morphs failed in the last run — the matching editor rows go red.
  const failedFrames = useMemo(
    () =>
      romRunLog && !romRunLog.ok
        ? new Set(romRunLog.failedMorphs.map((morph) => morph.frame))
        : undefined,
    [romRunLog],
  )

  // The "reveal frame N" signal a clicked failed morph sends to the ROM editor
  // (nonce forces the effect to re-fire even for the same frame).
  const [revealFrame, setRevealFrame] = useState<{ frame: number; nonce: number } | null>(null)
  // Clicking a failed morph in the report opens its ROM section and scrolls its
  // row into view (RomSections does the scroll off the nonce change).
  const revealFailedFrame = useCallback((frame: number) => {
    setRevealFrame((prev) => ({ frame, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  return { romRunLog, dismiss, hasRunProblems, failedFrames, revealFrame, revealFailedFrame }
}
