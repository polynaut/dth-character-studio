import { useCallback, useMemo, useState } from 'react'

import { dismissRomRunLog, fetchRomRunLog } from '#/lib/rom/api.ts'
import { dropSceneRun, morphKey } from '#/lib/rom/run-log.ts'
import { useRefetchOnFocus } from '@dth/ui'

export type RomRunLog = Awaited<ReturnType<typeof fetchRomRunLog>>

/**
 * The ROM run log written by the Daz-side script (ingested into the studio's
 * own store on read) plus the editor's "reveal this morph" signal for it. The
 * log is re-read whenever the window regains focus, so problems from a run
 * surface the moment the user switches back from Daz to the studio.
 * `failedMorphKeys` is memoized — it feeds the memoized ROM subtree, so its
 * identity may only change when the log does.
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
   * Forget the last run's report on the spot — no API call.
   *
   * For the DTH Export handoff, which has ALREADY dropped both run-log files
   * from disk (`executeCharacterJobs` → `clearRomRunLogFiles`). Starting a run
   * must clear the previous one's red banner and red morph rows immediately,
   * rather than leaving them under a live progress bar until Daz writes a new
   * log. Local-only on purpose: re-deleting files the handoff just deleted
   * would be a second round trip for nothing, and the refocus refetch now
   * reads an empty store anyway, so the state cannot come back.
   */
  const forget = useCallback(() => setRomRunLog(null), [])

  /**
   * Forget ONE scene's findings — the same deal as {@link forget}, for the
   * single-scene rebuild ("Generate new ROM" on a scene card), whose handoff
   * has already dropped that scene's entry from disk (`clearSceneRunLog`).
   *
   * Per scene because that rebuild re-runs one scene: the other scenes'
   * findings still stand, and nothing is coming to rewrite them. `dropSceneRun`
   * hands the same object back when the scene had no entry, so a rebuild of an
   * unreported scene leaves the log's identity — and with it the memoized ROM
   * subtree — untouched.
   */
  const forgetScene = useCallback((scenePath: string) => {
    setRomRunLog((prev: RomRunLog) => (prev ? dropSceneRun(prev, scenePath) : prev))
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
   * Identities (`morphKey`) of the morphs that failed anywhere in the last run
   * — the editor rows CONTAINING one go red, whatever scene is selected.
   *
   * By identity, not by frame: the log's frame numbers describe the ROM as it
   * was WHEN IT RAN, while the grid recomputes frames from row order on every
   * edit — a frame-matched set kept the same POSITION red through deletions
   * and reorders, whatever morph had moved into it. The `node`/`prop` pair is
   * the same verbatim string on both sides, so it survives any edit.
   *
   * Deliberately NOT scoped to the selected scene (the frame-matched version
   * had to be, since overrides renumber frames per scene): a dialed morph is
   * the same dial in every scene's grid, and scoping left the report visible
   * over an all-clean grid until the user happened to select the failing scene
   * — the rows must be red the moment the report is.
   */
  const failedMorphKeys = useMemo(() => {
    if (!romRunLog || romRunLog.ok) return undefined
    const keys = new Set<string>()
    for (const morph of romRunLog.failedMorphs) keys.add(morphKey(morph.node, morph.prop))
    return keys
  }, [romRunLog])

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
    forget,
    forgetScene,
    hasRunProblems,
    hasRunWarnings,
    showRunReport,
    failedMorphKeys,
    revealMorph,
    revealFailedMorph,
  }
}
