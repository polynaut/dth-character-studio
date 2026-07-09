import { CircleX, X } from 'lucide-react'

import { Button } from '@dth/ui'

import type { RomRunLog } from '#/lib/rom/api.ts'

/**
 * The problem report the studio shows when the last Daz-side ROM run reported
 * errors or failed morphs. Purely presentational: clicking a failed morph asks
 * the parent to reveal that frame in the ROM editor (`onRevealFrame`); the
 * dismiss button clears the log (`onDismiss`). The parent gates rendering on
 * `romRunLog && !romRunLog.ok`, so this always receives a failing log.
 */
export function RomRunLogReport({
  romRunLog,
  onDismiss,
  onRevealFrame,
}: {
  romRunLog: RomRunLog
  onDismiss: () => void
  onRevealFrame: (frame: number) => void
}) {
  return (
    <section className="mb-8 rounded-lg border border-destructive/50 bg-destructive/10 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <CircleX className="size-5 shrink-0 text-destructive" />
          The last ROM run in Daz reported{' '}
          {romRunLog.errors.length + romRunLog.failedMorphs.length} problem
          {romRunLog.errors.length + romRunLog.failedMorphs.length === 1 ? '' : 's'}
        </h2>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          <X /> Dismiss
        </Button>
      </div>
      {romRunLog.finishedAt && (
        <p className="mt-1 text-xs text-muted-foreground">Run finished: {romRunLog.finishedAt}</p>
      )}
      {romRunLog.errors.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {romRunLog.errors.map((error, i) => (
            <li key={i} className="text-destructive">
              {error}
            </li>
          ))}
        </ul>
      )}
      {romRunLog.failedMorphs.length > 0 && (
        <div className="mt-3">
          <p className="text-sm">
            These morphs could not be applied — their frames stay in the ROM (empty), so the
            rest of the character is unaffected. The matching rows in the ROM sections below
            are marked red. Click one to jump to it, then fix the morph name or add the
            missing content, Save, and re-run the script:
          </p>
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto font-mono text-xs">
            {romRunLog.failedMorphs.map((morph, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onRevealFrame(morph.frame)}
                  className="text-left hover:underline"
                  title="Jump to this morph in the ROM editor"
                >
                  frame {morph.frame} · {morph.node} / <strong>{morph.prop}</strong> —{' '}
                  {morph.reason}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
