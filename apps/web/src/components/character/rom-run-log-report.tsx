import { CircleX, X } from 'lucide-react'

import { Button } from '@dth/ui'

import type { RomRunLog, RomRunSceneRun } from '#/lib/rom/api.ts'

/**
 * The problem report the studio shows when the last Daz-side ROM run reported
 * errors or failed morphs. Purely presentational: clicking a failed morph asks
 * the parent to reveal that frame in the ROM editor (`onRevealFrame`, which also
 * SELECTS the run's scene); the dismiss button clears the log (`onDismiss`). The
 * parent gates rendering on `romRunLog && !romRunLog.ok`, so this always
 * receives a failing log.
 *
 * A DTH Export batch runs one row per scene, so a log can hold several scenes'
 * runs — failures are listed UNDER THE SCENE they came from rather than in one
 * flat list, because "frame 40 failed" means nothing until you know whose frame
 * 40 (a scene override can reorder, insert and delete ROM frames).
 */
export function RomRunLogReport({
  romRunLog,
  onDismiss,
  onRevealFrame,
}: {
  romRunLog: RomRunLog
  onDismiss: () => void
  /** Select `scene` (when it names one) and jump to `frame` in the editor. */
  onRevealFrame: (frame: number, scene: string) => void
}) {
  const problems = romRunLog.errors.length + romRunLog.failedMorphs.length
  // Only the runs that actually failed — a batch's clean scenes have nothing to
  // report, and listing them would bury the ones that need attention.
  const failedRuns = romRunLog.runs.filter((run) => !run.ok)
  // With a single untagged run (one scene, or a legacy log) the heading is noise.
  const showSceneHeadings = failedRuns.length > 1 || failedRuns.some((r) => r.scene !== '')

  return (
    <section className="mb-8 rounded-lg border border-destructive/50 bg-destructive/10 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <CircleX className="size-5 shrink-0 text-destructive" />
          The last ROM run in Daz reported {problems} problem{problems === 1 ? '' : 's'}
          {failedRuns.length > 1 && ` across ${failedRuns.length} scenes`}
        </h2>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          <X /> Dismiss
        </Button>
      </div>
      {romRunLog.finishedAt && (
        <p className="mt-1 text-xs text-muted-foreground">Run finished: {romRunLog.finishedAt}</p>
      )}

      {romRunLog.failedMorphs.length > 0 && (
        <p className="mt-3 text-sm">
          These morphs could not be applied — their frames stay in the ROM (empty), so the rest
          of the character is unaffected. The matching rows in the ROM sections below are marked
          red for the selected scene. Click one to jump to it — the studio switches to that
          scene first — then fix the morph name or add the missing content, Save, and re-run.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {failedRuns.map((run, i) => (
          <SceneRunProblems
            key={`${run.scene}|${i}`}
            run={run}
            showHeading={showSceneHeadings}
            onRevealFrame={onRevealFrame}
          />
        ))}
      </div>
    </section>
  )
}

/** One scene's problems: its errors, then its failed morphs. */
function SceneRunProblems({
  run,
  showHeading,
  onRevealFrame,
}: {
  run: RomRunSceneRun
  showHeading: boolean
  onRevealFrame: (frame: number, scene: string) => void
}) {
  return (
    <div>
      {showHeading && (
        <p className="text-sm font-semibold">{run.sceneName || run.scene || 'Unsaved scene'}</p>
      )}
      {run.errors.length > 0 && (
        <ul className="mt-1 space-y-1 text-sm">
          {run.errors.map((error, i) => (
            <li key={i} className="text-destructive">
              {error}
            </li>
          ))}
        </ul>
      )}
      {run.failedMorphs.length > 0 && (
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto font-mono text-xs">
          {run.failedMorphs.map((morph, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onRevealFrame(morph.frame, run.scene)}
                className="text-left hover:underline"
                title={
                  run.sceneName
                    ? `Switch to “${run.sceneName}” and jump to this morph`
                    : 'Jump to this morph in the ROM editor'
                }
              >
                frame {morph.frame} · {morph.node} / <strong>{morph.prop}</strong> —{' '}
                {morph.reason}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
