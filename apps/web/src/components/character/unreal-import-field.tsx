import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useRefetchOnFocus } from '@dth/ui'
import unrealLogo from '#/assets/unreal-logo.svg'
import { dismissUnrealImport, fetchUnrealImportProgress } from '#/lib/rom/api.ts'
import { uprojectDisplayName } from '#/components/unreal-install-dialog.tsx'
import type { UnrealImportState } from '#/lib/rom/unreal-jobs.ts'

/**
 * What a linked Unreal project is doing with the export it was handed —
 * **status only**, and nothing to press.
 *
 * There is ONE way to send a character to Unreal: the DTH Export dialog's
 * Unreal leg. This panel used to be a second one, with its own project picker
 * and set checklist, and two ways to start the same thing is one way too many
 * — the dialog is where the pipeline is configured, so that is where the send
 * belongs.
 *
 * The WATCH could not go with it. An import runs for minutes inside an editor
 * that may not even have been open when the job was queued, so its outcome
 * arrives long after the run that queued it has finished and put its task cards
 * away. Without something reading the result file, a failed import (or a
 * successful one) would leave the studio with nothing to say. So this stays,
 * and only this: it renders nothing at all until one of the character's linked
 * projects has a job in flight.
 *
 * It adopts a job whoever wrote it — a pending job is a fact about the project,
 * not about which surface queued it.
 */
export function UnrealImportField({
  unrealProjects,
}: {
  /** The PROJECT's linked `.uproject` paths (per-project, not per-character). */
  unrealProjects: ReadonlyArray<string>
}) {
  const [run, setRun] = useState<UnrealImportState | null>(null)
  /** The project being watched — a ref so the poll never chases a different
   *  one mid-import. */
  const watching = useRef('')

  const finish = useCallback((uprojectPath: string, state: Extract<UnrealImportState, { state: 'finished' }>) => {
    watching.current = ''
    if (state.error) {
      toast.error(`Unreal import failed — ${state.error}`, { duration: Infinity })
    } else {
      // Which of the two happened is worth saying: a re-import landed on the
      // assets that were already there (possibly somewhere the studio never
      // chose), a plain import created a set at the destination it asked for.
      const what = state.reimported ? 'Re-imported in Unreal' : 'Imported into Unreal'
      const assets = `${state.assets} asset${state.assets === 1 ? '' : 's'}`
      // One set names its folder; several name their count, because a toast
      // listing three content paths is a wall.
      const where =
        state.destination !== ''
          ? ` in ${state.destination}`
          : ` across ${state.sets} export set${state.sets === 1 ? '' : 's'}`
      toast.success(`${what} — ${assets}${where}.`, { duration: Infinity })
    }
    // The files have said what they had to; the next run starts clean.
    void dismissUnrealImport({ data: { uprojectPath } })
  }, [])

  const poll = useCallback(async () => {
    const uprojectPath = watching.current
    if (!uprojectPath) return
    const state = await fetchUnrealImportProgress({ data: { uprojectPath } }).catch(() => null)
    setRun(state)
    if (state?.state === 'finished') finish(uprojectPath, state)
  }, [finish])

  /**
   * Pick up whatever is in flight, for any of the character's linked projects.
   *
   * On focus as well as on mount: the editor is another window, and coming back
   * from it is exactly when the answer has changed.
   */
  const projectsKey = unrealProjects.join('|')
  useRefetchOnFocus(
    () => {
      if (watching.current) return
      void (async () => {
        for (const uprojectPath of unrealProjects) {
          // Sequential: the first project with something to say wins, and one
          // job at a time is the whole shape of this handoff.
          // eslint-disable-next-line no-await-in-loop
          const state = await fetchUnrealImportProgress({ data: { uprojectPath } }).catch(() => null)
          if (!state || state.state === 'finished') continue
          watching.current = uprojectPath
          setRun(state)
          return
        }
      })()
    },
    [projectsKey],
    { immediate: true },
  )

  // 2.5s, the same cadence as the other two watches.
  useEffect(() => {
    if (!run || run.state === 'finished') return
    const timer = setInterval(() => void poll(), 2500)
    return () => clearInterval(timer)
  }, [run, poll])

  // Nothing in flight — and nothing to say. The DTH Export dialog is where a
  // send is started; an idle panel here would only advertise a second way.
  if (run === null || run.state === 'finished') return null

  const name = uprojectDisplayName(watching.current)
  return (
    <section className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm">
        <img src={unrealLogo} alt="" aria-hidden className="size-4 object-contain" />
        <Loader2 className="size-3.5 animate-spin" />
        <span>
          {run.state === 'waiting'
            ? `Queued for ${name} — waiting for the editor to pick it up…`
            : `Importing in ${name}…`}
        </span>
      </div>
      {run.state === 'waiting' && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Nothing has claimed it yet — the job waits on disk until the editor opens. That is
            normal while Unreal starts. If the project is already open and this does not move, the
            bridge was installed after that editor session began: restart the editor once.
          </span>
        </p>
      )}
    </section>
  )
}
