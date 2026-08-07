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

  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const linkedHoudini = character.houdiniProjects
  // The latest linked lists for out-of-band refreshes (wizard actions) — the
  // focus hook already holds its own latest closure.
  const scanArgs = useRef({ projectId, id: character.id, linkedScenes, linkedHoudini })
  scanArgs.current = { projectId, id: character.id, linkedScenes, linkedHoudini }

  const scan = useCallback(() => {
    void fetchDetectedFiles({ data: scanArgs.current })
      .then((fresh) => {
        setDetected((prev) => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh))
      })
      // Best-effort: a briefly unreachable share keeps the last answer — the
      // next focus retries; never an unhandled rejection.
      .catch(() => {})
  }, [])

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

  const key = [...detected.scenes, ...detected.houdini].join('|')
  return {
    detected,
    refresh: scan,
    ignore,
    bannerDismissed: dismissedKey === key,
    dismissBanner: () => setDismissedKey(key),
  }
}
