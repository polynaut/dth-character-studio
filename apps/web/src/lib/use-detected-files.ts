import { useCallback, useRef, useState } from 'react'

import { fetchDetectedFiles, ignoreDetectedFiles } from '#/lib/rom/api.ts'
import { useRefetchOnFocus } from '@dth/ui'

import type { DetectedFilesResult } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

const EMPTY: DetectedFilesResult = { scenes: [], houdini: [] }

/**
 * New files in the character's folder (unlinked, un-ignored `.duf`/`.hip*`) —
 * rescanned on mount and every window focus (tabbing back from Daz/Houdini is
 * exactly when files appear), feeding the banner and the add wizard. The scan
 * subtracts the LIVE draft's linked lists, so an add is reflected without
 * waiting for the definition on disk; errors keep the last answer (an
 * unreachable share must not flash the banner away). The result keeps its
 * identity while the content is unchanged — the wizard's page list keys on it.
 */
export function useDetectedFiles(projectId: string, character: Character) {
  const [detected, setDetected] = useState<DetectedFilesResult>(EMPTY)
  // The detection set the banner's ✕ dismissed — hidden only while detection
  // still answers exactly that set; a NEW file re-shows the banner.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  /**
   * Files this session already answered for, by unlinking or deleting them.
   *
   * Unlinking makes a file "new" by definition — it is in the folder and no
   * longer linked — so without this, removing a scene re-offers it as a
   * discovery the instant the unlink persists. Worse for a DELETE: the unlink
   * is persisted BEFORE the file is removed (deliberately — see
   * `daz-scene-field.confirmRemove`), and persisting is what re-runs this scan,
   * so the rescan races the delete, sees a file that is about to vanish, and
   * leaves a banner advertising it until the next window focus.
   *
   * A ref, not state: it must not itself trigger a scan, and it is read inside
   * the scan's own callback. Session-scoped on purpose — the permanent answer
   * is the `.dcsmeta` skip list, which is the wizard's Skip and is deliberately
   * not written from here (it has no undo, and its read-modify-write is
   * unguarded because the wizard is its only writer).
   */
  const answered = useRef<Set<string>>(new Set())

  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const linkedHoudini = character.houdiniProjects
  // The latest linked lists for out-of-band refreshes (wizard actions) — the
  // focus hook already holds its own latest closure.
  const scanArgs = useRef({ projectId, id: character.id, linkedScenes, linkedHoudini })
  scanArgs.current = { projectId, id: character.id, linkedScenes, linkedHoudini }

  /** Drop everything this session already answered for. */
  const withoutAnswered = useCallback((result: DetectedFilesResult): DetectedFilesResult => {
    if (answered.current.size === 0) return result
    const gone = answered.current
    const keep = (p: string) => !gone.has(p.toLowerCase())
    const scenes = result.scenes.filter(keep)
    const houdini = result.houdini.filter(keep)
    // Keep the identity when nothing was dropped — the wizard's page list keys
    // on it, same contract as the scan below.
    return scenes.length === result.scenes.length && houdini.length === result.houdini.length
      ? result
      : { scenes, houdini }
  }, [])

  const scan = useCallback(() => {
    void fetchDetectedFiles({ data: scanArgs.current })
      .then((raw) => {
        const fresh = withoutAnswered(raw)
        setDetected((prev) => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh))
      })
      // Best-effort: a briefly unreachable share keeps the last answer — the
      // next focus retries; never an unhandled rejection.
      .catch(() => {})
  }, [withoutAnswered])

  useRefetchOnFocus(
    scan,
    // A link/unlink changes what counts as "new" — rescan immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, character.id, [...linkedScenes, ...linkedHoudini].join('|')],
    { immediate: true },
  )

  /** Permanently skip `paths` (the wizard's Skip): persist to the `.dcsmeta`
   *  skip list, then drop them locally without waiting for the next focus. */
  const ignore = useCallback(
    async (paths: Array<string>) => {
      await ignoreDetectedFiles({ data: { projectId, id: character.id, paths } })
      const gone = new Set(paths.map((p) => p.toLowerCase()))
      setDetected((prev) => ({
        scenes: prev.scenes.filter((p) => !gone.has(p.toLowerCase())),
        houdini: prev.houdini.filter((p) => !gone.has(p.toLowerCase())),
      }))
    },
    [projectId, character.id],
  )

  /**
   * "The user just answered for these" — call it from every unlink/delete flow,
   * with the paths that were removed from the character.
   *
   * Applied to the CURRENT result and to every later scan this session, so it
   * holds whether the rescan lands before the flow finishes (the delete race) or
   * after it (the plain unlink).
   */
  const answerFor = useCallback(
    (paths: Array<string>) => {
      for (const p of paths) if (p) answered.current.add(p.toLowerCase())
      setDetected((prev) => withoutAnswered(prev))
    },
    [withoutAnswered],
  )

  const key = [...detected.scenes, ...detected.houdini].join('|')
  return {
    detected,
    refresh: scan,
    ignore,
    answerFor,
    bannerDismissed: dismissedKey === key,
    dismissBanner: () => setDismissedKey(key),
  }
}
