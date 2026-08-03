import { useCallback, useMemo, useState } from 'react'

import { dismissRomRunLog, fetchRomRunLog } from '#/lib/rom/api.ts'
import { normalizeSceneKey } from '#/lib/rom/execute-jobs.ts'
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
export function useRomRunLog(
  projectId: string,
  characterId: string,
  initial: RomRunLog,
  /** The scene the editor currently shows — what `failedFrames` is scoped to. */
  selectedScene = '',
) {
  const [romRunLog, setRomRunLog] = useState(initial)
  useRefetchOnFocus(() => {
    fetchRomRunLog({ data: { projectId, id: characterId } })
      .then((fresh) => {
        // Content-compare before storing: the refocus fetch re-reads the log on
        // EVERY focus, and a fresh-but-identical object identity would ripple
        // through `failedFrames` into the memoized ROM subtree for nothing.
        setRomRunLog((prev: RomRunLog) =>
          JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh,
        )
      })
      .catch(() => {
        // A briefly unreachable project share (fetch throws
        // ProjectUnreachableError) must not surface as an unhandled rejection
        // on every refocus — keep the last log; the next focus retries.
      })
  }, [projectId, characterId])

  const dismiss = useCallback(async () => {
    setRomRunLog(null)
    try {
      await dismissRomRunLog({ data: { projectId, id: characterId } })
    } catch {
      // Unreachable share — the banner is already gone locally; the stored
      // log just survives until the next successful dismiss or run.
    }
  }, [projectId, characterId])

  const hasRunProblems = !!romRunLog && !romRunLog.ok
  /**
   * Frames whose morphs failed — the matching editor rows go red — for the
   * SELECTED scene only.
   *
   * Scoping is a correctness requirement, not a filter: a scene override can
   * reorder, insert and delete ROM frames, so frame 40 in the summer scene is a
   * different pose than frame 40 in the default one. A flat set across every
   * scene painted the wrong rows red on whichever scene happened to be open.
   *
   * A run with NO scene (`''` — an unsaved scene, or a log written by a runtime
   * older than v54) can't be attributed, so it applies to whatever is selected:
   * that is the pre-scene-tagging behaviour, and dropping it would silently stop
   * marking rows for a log that is already on disk at upgrade time.
   */
  const failedFrames = useMemo(() => {
    if (!romRunLog || romRunLog.ok) return undefined
    const key = normalizeSceneKey(selectedScene)
    const frames = new Set<number>()
    for (const run of romRunLog.runs) {
      if (run.scene !== '' && normalizeSceneKey(run.scene) !== key) continue
      for (const morph of run.failedMorphs) frames.add(morph.frame)
    }
    return frames
  }, [romRunLog, selectedScene])

  // The "reveal frame N" signal a clicked failed morph sends to the ROM editor
  // (nonce forces the effect to re-fire even for the same frame).
  const [revealFrame, setRevealFrame] = useState<{ frame: number; nonce: number } | null>(null)
  // Clicking a failed morph in the report opens its ROM section and scrolls its
  // row into view (RomSections does the scroll off the nonce change). The
  // caller selects the run's scene FIRST — revealing a frame in the wrong
  // scene's grid would scroll to a pose that isn't the one that failed.
  const revealFailedFrame = useCallback((frame: number) => {
    setRevealFrame((prev) => ({ frame, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  return { romRunLog, dismiss, hasRunProblems, failedFrames, revealFrame, revealFailedFrame }
}
