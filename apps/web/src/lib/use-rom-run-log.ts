import { useCallback, useMemo, useState } from 'react'

import { dismissRomRunLog, fetchRomRunLog } from '#/lib/rom/api.ts'
import { dropSceneRuns, failedMorphKeysByScene } from '#/lib/rom/run-log.ts'
import { useRefetchOnFocus } from '@dth/ui'

export type RomRunLog = Awaited<ReturnType<typeof fetchRomRunLog>>

/**
 * The ROM run log written by the Daz-side script (ingested into the studio's
 * own store on read) plus the editor's "reveal this morph" signal for it. The
 * log is re-read whenever the window regains focus, so problems from a run
 * surface the moment the user switches back from Daz to the studio.
 * `failedMorphsByScene` is memoized — it feeds (via the route's per-selected-
 * scene derivation) the memoized ROM subtree, so its identity may only change
 * when the log does.
 */
export function useRomRunLog(projectId: string, characterId: string, initial: RomRunLog) {
  const [romRunLog, setRomRunLog] = useState(initial)
  useRefetchOnFocus(() => {
    fetchRomRunLog({ data: { projectId, id: characterId } })
      .then((fresh) => {
        // Content-compare before storing: the refocus fetch re-reads the log on
        // EVERY focus, and a fresh-but-identical object identity would ripple
        // through `failedMorphKeys` into the memoized ROM subtree for nothing.
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

  /**
   * Forget the named scenes' findings on the spot — no API call.
   *
   * The on-screen half of a handoff that has ALREADY retired the same scenes on
   * disk: the DTH Export batch (`executeCharacterJobs` → `clearSceneRunLogs`,
   * over `scenesRetiredByRun`) and the single-scene rebuild
   * (`generateRomAnimation`, over the one scene it re-runs). Starting a run must
   * clear its own red banner and red morph rows immediately, rather than leaving
   * them under a live progress bar until Daz writes a new log.
   *
   * Per scene, never wholesale, because that is all a run supersedes — the
   * scenes it does not touch keep their findings, and nothing is coming to
   * rewrite them. Local-only on purpose: re-clearing what the handoff just
   * cleared would be a second round trip for nothing, and the refocus refetch
   * now reads a store that agrees, so the state cannot come back.
   *
   * `dropSceneRuns` hands the same object back when none of the scenes had an
   * entry, so a run of unreported scenes leaves the log's identity — and with
   * it the memoized ROM subtree — untouched.
   */
  const forgetScenes = useCallback((scenePaths: ReadonlyArray<string>) => {
    if (scenePaths.length === 0) return
    setRomRunLog((prev: RomRunLog) => (prev ? dropSceneRuns(prev, scenePaths) : prev))
  }, [])

  const dismiss = useCallback(async () => {
    setRomRunLog(null)
    try {
      await dismissRomRunLog({ data: { projectId, id: characterId } })
    } catch {
      // Unreachable share — the banner is already gone locally; the stored
      // log just survives until the next successful dismiss or run.
    }
  }, [projectId, characterId])

  /** The run was not `ok` — the generated script skipped the export. Red. */
  const hasRunProblems = !!romRunLog && !romRunLog.ok
  /**
   * The run had something to say and exported anyway (runtime v79). Amber, and
   * shown just as prominently: the whole reason this channel exists is that the
   * silent version of it — an export refused over 4 keys, with a row marked
   * "done" — was invisible outside the Daz log.
   */
  const hasRunWarnings = !!romRunLog && romRunLog.warnings.length > 0
  const showRunReport = hasRunProblems || hasRunWarnings
  /**
   * Failed-morph identities (`morphKey`) bucketed by the scene whose run
   * reported them — the route derives the SELECTED scene's red-row set from
   * this ({@link failedMorphKeysForScene}), so the primary's failures no
   * longer mark the same rows red in every other scene's grid (a failure is a
   * per-scene fact: the gate read THAT scene's dial values).
   *
   * By identity, not by frame: the log's frame numbers describe the ROM as it
   * was WHEN IT RAN, while the grid recomputes frames from row order on every
   * edit — a frame-matched set kept the same POSITION red through deletions
   * and reorders, whatever morph had moved into it. The `node`/`prop` pair is
   * the same verbatim string on both sides, so it survives any edit.
   */
  const failedMorphsByScene = useMemo(
    () => (romRunLog && !romRunLog.ok ? failedMorphKeysByScene(romRunLog) : undefined),
    [romRunLog],
  )

  // The "reveal this morph" signal a clicked failed morph sends to the ROM
  // editor (nonce forces the effect to re-fire even for the same morph).
  const [revealMorph, setRevealMorph] = useState<{ key: string; nonce: number } | null>(null)
  // Clicking a failed morph in the report opens its ROM section and scrolls its
  // row into view (RomSections does the scroll off the nonce change). The
  // caller selects the run's scene FIRST — the dial that failed is dialed in
  // THAT scene, and an override-added row only exists in its own scene's grid.
  const revealFailedMorph = useCallback((key: string) => {
    setRevealMorph((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  return {
    romRunLog,
    dismiss,
    forgetScenes,
    hasRunProblems,
    hasRunWarnings,
    showRunReport,
    failedMorphsByScene,
    revealMorph,
    revealFailedMorph,
  }
}
