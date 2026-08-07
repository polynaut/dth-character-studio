import { useCallback, useState } from 'react'

import { fetchProjectDetectedFiles, getActiveProjectDir } from '#/lib/rom/api.ts'
import { useRefetchOnFocus } from '@dth/ui'

import type { ProjectDetectedCharacter } from '#/lib/rom/api.ts'

/**
 * New files across EVERY character in the window's project — the project-wide
 * half of detection (issue #740).
 *
 * `useDetectedFiles` only runs while a character page is mounted, so a Save As
 * out of Daz while the studio was showing the project page (or Settings, or
 * Tools) went unnoticed until that character happened to be opened. This runs
 * wherever the user is.
 *
 * On a focus REGAIN only, deliberately not on mount: the sweep answers "you
 * went to Daz and came back", and a window that has only just opened is nobody
 * coming back from anywhere. It would also mean every launch paying for a
 * whole-project walk before the first paint.
 *
 * Errors keep the last answer — a briefly unreachable share must not flash the
 * banner away — and the result keeps its identity while the content is
 * unchanged, so the banner does not re-appear after being dismissed.
 */
export function useProjectDetectedFiles() {
  const [found, setFound] = useState<Array<ProjectDetectedCharacter>>([])
  /** The project the finding set belongs to — captured with the sweep, so the
   *  banner's navigation cannot drift onto another window's project. */
  const [projectId, setProjectId] = useState('')
  /** The finding set the ✕ dismissed — hidden only while the sweep still
   *  answers exactly that set, so a NEW file brings the banner back. */
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  const scan = useCallback(() => {
    void (async () => {
      const dir = await getActiveProjectDir()
      if (!dir) return // Home window / browser — nothing to sweep
      const fresh = await fetchProjectDetectedFiles({ data: { projectId: dir } })
      setProjectId(dir)
      setFound((prev) => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh))
    })().catch(() => {
      // Best-effort: keep the last answer, retry on the next focus.
    })
  }, [])

  useRefetchOnFocus(scan)

  const key = found
    .map((c) => `${c.characterId}:${[...c.scenes, ...c.houdini].join('|')}`)
    .join('||')
  return {
    found,
    projectId,
    refresh: scan,
    dismissed: dismissedKey === key,
    dismiss: () => setDismissedKey(key),
  }
}
