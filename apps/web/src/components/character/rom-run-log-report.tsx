import { CircleX, TriangleAlert, X } from 'lucide-react'

import { Button } from '@dth/ui'

import type { RomRunKeyProblem, RomRunLog, RomRunSceneRun } from '#/lib/rom/api.ts'

/**
 * The report the studio shows for the last Daz-side ROM run — errors, warnings,
 * failed morphs and the individual keys the interpolation pass could not stamp.
 * Purely presentational: clicking a failed morph asks the parent to reveal that
 * frame in the ROM editor (`onRevealFrame`, which also SELECTS the run's scene);
 * the dismiss button clears the log (`onDismiss`).
 *
 * TWO severities, and the difference is the export gate. An **error** (or a
 * failed morph) means the run was not `ok`, so the generated script skipped the
 * export. A **warning** means the run exported and there is still something to
 * see. Warnings exist because the alternative was silence: a run whose only
 * complaint was 4 keys out of 7968 used to block the export, and the user saw a
 * row marked "done", no files, and no reason unless they opened the Daz log.
 * So the parent renders this whenever there is EITHER, and the styling says
 * which — red when the export was blocked, amber when it was not.
 *
 * A DTH Export batch runs one row per scene, so a log can hold several scenes'
 * runs — findings are listed UNDER THE SCENE they came from rather than in one
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
  // Did the export run? That is what the colour has to answer — `ok` is the
  // very flag the generated script's export gate reads.
  const blocked = !romRunLog.ok
  // Only the runs with something to say. A batch's silent scenes have nothing to
  // report, and listing them would bury the ones that need attention.
  const reportingRuns = romRunLog.runs.filter(
    (run) => !run.ok || run.warnings.length > 0 || run.keyProblems.length > 0,
  )
  // With a single untagged run (one scene, or a legacy log) the heading is noise.
  const showSceneHeadings = reportingRuns.length > 1 || reportingRuns.some((r) => r.scene !== '')

  return (
    <section
      className={`mb-8 rounded-lg border p-5 ${
        blocked ? 'border-destructive/50 bg-destructive/10' : 'border-amber-500/40 bg-amber-500/10'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {blocked ? (
            <CircleX className="size-5 shrink-0 text-destructive" />
          ) : (
            <TriangleAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-500" />
          )}
          {blocked ? (
            <>
              The last ROM run in Daz reported {problems} problem{problems === 1 ? '' : 's'}
              {reportingRuns.length > 1 && ` across ${reportingRuns.length} scenes`}
            </>
          ) : (
            <>
              The last ROM run in Daz finished, with {romRunLog.warnings.length} warning
              {romRunLog.warnings.length === 1 ? '' : 's'}
            </>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          <X /> Dismiss
        </Button>
      </div>
      {romRunLog.finishedAt && (
        <p className="mt-1 text-xs text-muted-foreground">Run finished: {romRunLog.finishedAt}</p>
      )}
      {!blocked && (
        <p className="mt-1 text-xs text-muted-foreground">
          The ROM built and the export ran — nothing here blocked it.
        </p>
      )}

      {romRunLog.failedMorphs.length > 0 && (
        <p className="mt-3 text-sm">
          These morphs could not be applied — their frames stay in the ROM (empty), so the rest
          of the character is unaffected. The matching rows in the ROM sections below are marked
          red for the selected scene. Click one to jump to it — the studio switches to that
          scene first — then fix the morph name or add the missing content, Save, and re-run.
        </p>
      )}

      {romRunLog.keyProblems.length > 0 && <KeyProblemExplainer />}

      <div className="mt-3 space-y-3">
        {reportingRuns.map((run, i) => (
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

/**
 * What a listed key actually means — the paragraph that was missing when these
 * were an anonymous count. Deliberately says what is NOT wrong too: the counts
 * used to read as data loss, and the ones that are data loss say so themselves
 * (`value-lost`, which still fails the run).
 */
function KeyProblemExplainer() {
  return (
    <p className="mt-3 text-sm">
      The keys below kept Daz&rsquo;s default interpolation instead of Linear. Their{' '}
      <strong>values are unchanged</strong>, so every ROM pose frame is exact — only the motion
      between pose frames on those channels differs, which a PoseAsset export does not sample.
      Each one names its node, dial and frame so you can open the scene and look. The list is
      capped per kind; the message above it carries the exact total.
    </p>
  )
}

/** One scene's findings: errors, warnings, failed morphs, then named keys. */
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
      {run.warnings.length > 0 && (
        <ul className="mt-1 space-y-1 text-sm">
          {run.warnings.map((warning, i) => (
            <li key={i} className="text-amber-600 dark:text-amber-500">
              {warning}
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
      {run.keyProblems.length > 0 && (
        <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto font-mono text-xs">
          {run.keyProblems.map((problem, i) => (
            <li key={i}>
              <KeyProblemLine problem={problem} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One key, named the way the Daz log names it. NOT clickable, unlike a failed
 * morph: a key's frame is wherever Daz put the key, which need not be one of the
 * ROM's pose rows — jumping to "that" row would point at a pose that has nothing
 * to do with the finding.
 */
function KeyProblemLine({ problem }: { problem: RomRunKeyProblem }) {
  return (
    <>
      <span className="text-amber-600 dark:text-amber-500">{problem.kind}</span>{' '}
      {problem.frame >= 0 ? `frame ${problem.frame}` : 'frame ?'}
      {problem.key >= 0 && ` · key ${problem.key}${problem.keys ? ` of ${problem.keys}` : ''}`} ·{' '}
      {problem.node} /{' '}
      <strong>{problem.prop}</strong>
      {problem.propLabel && ` (${problem.propLabel})`}
      {problem.interp && ` · reads back ${problem.interp}`}
      {problem.reason && (
        <span className="text-muted-foreground"> — {problem.reason}</span>
      )}
      {problem.path && <span className="text-muted-foreground"> [{problem.path}]</span>}
    </>
  )
}
