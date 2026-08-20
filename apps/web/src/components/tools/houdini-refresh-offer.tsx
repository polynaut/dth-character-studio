import { useState } from 'react'
import { Loader2, TriangleAlert, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button, Modal, Switch } from '@dth/ui'
import {
  noteHoudiniRefreshUndone,
  refreshTargetPaths,
  restoreHoudiniBackup,
  runHoudiniAssetRefresh,
} from '#/lib/rom/api.ts'

import type {
  ExistingBackup,
  HoudiniRefreshPlan,
  MaterialUtilReport,
  RefreshCandidate,
} from '#/lib/rom/api.ts'

/**
 * The offer that follows a Refresh-assets run when the DTH release changed:
 * run DazToHue's own **Refresh Assets** across every linked Houdini project,
 * headlessly, the way the Utils drawer already does for one character.
 *
 * It exists because the studio's refresh only ever fixed half the pipeline. A
 * `.hip` stores the DazToHue asset definitions it was built with, so a new
 * release leaves every project on the old ones — and the only fix used to be
 * opening each one in Houdini by hand.
 *
 * The wording throughout is bounded by what the studio can actually observe.
 * It does not say a project NEEDS this (no check anywhere can), and it does not
 * say what the refresh changed (it executes third-party code it cannot
 * inspect). What it can say — and does — is which projects it has run this on
 * before, and under which release.
 */

/** Basename for display; the full path is the row's title attribute. */
function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** A backup's date, in the user's locale; '' when it could not be stat'd. */
function backupDate(modifiedAt: string): string {
  if (!modifiedAt) return ''
  const at = new Date(modifiedAt)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString()
}

/**
 * The one destructive thing this dialog does, said before it happens.
 *
 * `_backup` keeps ONE rolling copy per project, so saving a project overwrites
 * whatever is already beside it — and the copy sitting there is, by
 * construction, the one somebody kept to get that project back onto an older
 * DazToHue release. That is too easy to lose by pressing a button labelled
 * "Refresh", so the loss gets its own block, its own list, and its own switch:
 * the run does not start until it is acknowledged.
 *
 * What the switch consents to is the overwrite itself, and the dialog does not
 * pre-empt it by deleting anything: `_backup` copies only for a project the
 * tool leaves modified, so deleting up front would take the copies beside every
 * project that reports no change or fails outright — and all of them if the run
 * cannot start at all. Left to the overwrite, a copy is lost exactly when it is
 * replaced, and never otherwise. Which is also why this lists what is AT RISK
 * rather than what will go: nothing here can know which projects the tool will
 * leave modified.
 */
function ReplaceBackupsWarning({
  backups,
  accepted,
  onAccept,
  disabled,
}: {
  backups: ReadonlyArray<ExistingBackup>
  accepted: boolean
  onAccept: (value: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-3 rounded-md border-2 border-destructive/60 bg-destructive/10 p-4">
      <p className="flex items-start gap-2 text-sm font-semibold text-destructive">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" />
        <span>
          {plural(backups.length, 'project')} already {backups.length === 1 ? 'has' : 'have'} a
          studio backup — this run <strong>replaces</strong>{' '}
          {backups.length === 1 ? 'it' : 'them'}
        </span>
      </p>
      <p className="text-sm">
        Each project keeps <strong>one rolling copy</strong>, so saving a project overwrites what
        is there. Only the projects this run actually saves lose theirs — and nothing here can say
        in advance which those are. If one of these is how you would put a project back on an
        older DazToHue release, copy it somewhere else first: this is the last point at which it
        is certainly still there.
      </p>
      <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
        {backups.map((backup) => (
          <li key={backup.backupPath} title={backup.backupPath}>
            <code className="text-foreground">{fileName(backup.backupPath)}</code>
            {backupDate(backup.modifiedAt) && <span> · saved {backupDate(backup.modifiedAt)}</span>}
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-3">
        <Switch
          id="replace-houdini-backups"
          checked={accepted}
          disabled={disabled}
          onCheckedChange={onAccept}
        />
        <label htmlFor="replace-houdini-backups" className="text-sm">
          Let this run overwrite {backups.length === 1 ? 'it' : 'them'} with its own backups.
        </label>
      </div>
    </div>
  )
}

/** One offered project: what it is, who links it, and what the studio knows. */
function CandidateRow({ candidate }: { candidate: RefreshCandidate }) {
  return (
    <li title={candidate.hipPath}>
      <code className="text-foreground">{fileName(candidate.hipPath)}</code>
      {candidate.characters.length > 0 && <span> · {candidate.characters.join(', ')}</span>}
      <span>
        {' '}
        —{' '}
        {candidate.bucket === 'stale'
          ? `last refreshed under DazToHue ${candidate.lastVersion}`
          : 'never refreshed by the studio'}
      </span>
    </li>
  )
}

/**
 * What the sweep did, per project — and the way back out of it.
 *
 * Deliberately NOT the drawer's `RefreshReport`. That one surfaces the backup
 * only beside a FAILURE, on the reasoning that a run which worked has nothing
 * to undo. Here it does: the whole point of this sweep is a DazToHue release
 * change, and putting one project back on the previous release is a want that
 * arrives days later, from a successful run. So every saved project keeps its
 * undo where the user can see it.
 */
function SweepReport({ report }: { report: MaterialUtilReport }) {
  const [restoring, setRestoring] = useState('')
  const [restored, setRestored] = useState<Set<string>>(new Set())

  async function restore(hipPath: string, backupPath: string) {
    setRestoring(hipPath)
    try {
      await restoreHoudiniBackup({ data: { hipPath, backupPath } })
      // The record follows the file: the project is back on the definitions it
      // had before the sweep, so the studio must stop claiming it refreshed it.
      // Left stamped it would read as already-on-this-release and never be
      // offered again — retired by the very act of being put back.
      await noteHoudiniRefreshUndone(hipPath)
      setRestored((prev) => new Set(prev).add(hipPath))
      toast.success(`${fileName(hipPath)} is back to the state it was in before the run.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoring('')
    }
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — no project file was saved' : 'Assets refreshed'}
      </p>
      <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
        {report.refresh.map((entry) => (
          <li key={entry.hipPath}>
            <p className="truncate" title={entry.hipPath}>
              <strong>{fileName(entry.hipPath)}</strong>
            </p>
            {entry.ok ? (
              <p className="text-muted-foreground">
                {entry.tool ? <code>{entry.tool}</code> : 'The shelf tool'} ran ·{' '}
                {entry.changed
                  ? report.dryRun
                    ? 'the scene reported changes (not saved)'
                    : 'the scene reported changes and was saved'
                  : 'the scene reported no change, so it was left as it is'}
              </p>
            ) : (
              <>
                <p className="text-destructive">{entry.error}</p>
                {entry.availableTools.length > 0 && (
                  <p className="text-muted-foreground">
                    On the DazToHue shelf hython could see: {entry.availableTools.join(', ')}.
                  </p>
                )}
              </>
            )}
            {entry.backupPath &&
              (restored.has(entry.hipPath) ? (
                <p className="mt-1 text-muted-foreground">Restored to the state before this run.</p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1.5"
                  disabled={restoring !== ''}
                  title={`Put ${fileName(entry.hipPath)} back the way it was before this run — the copy in its backup folder. The studio also stops counting it as refreshed, so it is offered again. Close it in Houdini first: an open copy would save over the restore.`}
                  onClick={() => void restore(entry.hipPath, entry.backupPath)}
                >
                  {restoring === entry.hipPath ? <Loader2 className="animate-spin" /> : <Undo2 />}{' '}
                  Undo this run
                </Button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HoudiniRefreshOffer({
  plan,
  onClose,
}: {
  plan: HoudiniRefreshPlan
  onClose: () => void
}) {
  const [running, setRunning] = useState<'' | 'dry' | 'run'>('')
  const [report, setReport] = useState<MaterialUtilReport | null>(null)
  /** The user accepted losing the backups already on disk (see
   *  {@link ReplaceBackupsWarning}). Gates the run, nothing else. */
  const [replaceAccepted, setReplaceAccepted] = useState(false)
  /** A real run has been through, so the copies beside the projects it saved
   *  are now THIS run's — the report's Undo depends on them. From here on the
   *  warning is gone: the loss it named has already happened, and the copies it
   *  would now be aimed at are the ones the user may still want to use. */
  const [replaced, setReplaced] = useState(false)
  const busy = running !== ''

  const targets = plan.candidates.filter((c) => c.bucket !== 'current')
  const stale = targets.filter((c) => c.bucket === 'stale')
  const unknown = targets.filter((c) => c.bucket === 'unknown')
  const skipped = plan.candidates.length - targets.length
  const hipPaths = refreshTargetPaths(plan.candidates)
  const doomedBackups = replaced ? [] : plan.existingBackups
  /** A real run is held until the overwrite is acknowledged. The dry run is
   *  not: it never saves, so it never reaches `_backup` and destroys nothing. */
  const blockedByBackups = doomedBackups.length > 0 && !replaceAccepted

  async function run(dryRun: boolean) {
    setRunning(dryRun ? 'dry' : 'run')
    setReport(null)
    try {
      const result = await runHoudiniAssetRefresh({
        data: { hipPaths, dthVersion: plan.activeDthVersion, dryRun },
      })
      setReport(result)
      if (dryRun) return
      setReplaced(true)
      const failed = result.refresh.filter((r) => !r.ok)
      if (failed.length > 0) {
        toast.error(
          `${failed.length} of ${result.refresh.length} projects failed — see the report.`,
        )
        return
      }
      const changed = result.refresh.filter((r) => r.changed).length
      toast.success(
        changed === 0
          ? 'Refreshed — no project reported a change, so nothing was re-saved.'
          : `${plural(changed, 'project')} refreshed and saved.`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning('')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title="Also refresh the DazToHue assets in Houdini?"
    >
      <div className="space-y-2 text-sm">
        <p>
          The active DazToHue release is <strong>{plan.activeDthVersion}</strong>
          {plan.lastSeenDthVersion && plan.lastSeenDthVersion !== plan.activeDthVersion
            ? ` — it was ${plan.lastSeenDthVersion} the last time assets were refreshed.`
            : '.'}{' '}
          A <code>.hip</code> keeps the DazToHue definitions it was built with, so your linked
          projects are still on the old ones until DazToHue&apos;s own{' '}
          <strong>Refresh Assets</strong> runs in each of them.
        </p>
        <p>
          The studio can run that tool headlessly, through hython, on{' '}
          <strong>{plural(targets.length, 'linked project')}</strong>
          {skipped > 0 && (
            <>
              {' '}
              (skipping {plural(skipped, 'project')} already refreshed under {plan.activeDthVersion})
            </>
          )}
          .
        </p>
      </div>

      <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-3 text-xs text-muted-foreground">
        {stale.map((candidate) => (
          <CandidateRow key={candidate.hipPath} candidate={candidate} />
        ))}
        {unknown.map((candidate) => (
          <CandidateRow key={candidate.hipPath} candidate={candidate} />
        ))}
      </ul>

      {doomedBackups.length > 0 && (
        <ReplaceBackupsWarning
          backups={doomedBackups}
          accepted={replaceAccepted}
          onAccept={setReplaceAccepted}
          disabled={busy}
        />
      )}

      {/* The honest limits, stated where the decision is made — the same three
          the Utils drawer states for the single-character version of this. */}
      <p className="rounded-md border p-3 text-xs text-muted-foreground">
        The studio runs DazToHue&apos;s own tool rather than doing the refresh itself, so it
        can&apos;t tell you in advance what will change — and no check anywhere says a project
        needs this. &ldquo;Never refreshed by the studio&rdquo; means exactly that: it is not a
        verdict about the project, only the absence of one. A project is saved only if the scene
        reports itself modified afterwards.
      </p>

      <p className="text-xs text-muted-foreground">
        A project is copied into its <code>backup/</code> folder before it is saved — and only
        then, because a project the tool leaves unchanged is not saved at all. Each saved project
        keeps an <strong>Undo this run</strong> button in the report below — the way back if you
        ever need one of them on the previous DazToHue release.
        {/* The rolling-copy caveat belongs to whichever block is doing the work:
            when copies are actually about to be destroyed the warning above
            states it in full, and repeating it here only teaches the eye to
            skim past both. */}
        {doomedBackups.length === 0 && (
          <>
            {' '}
            It is <strong>one rolling copy per project</strong>, so the next run of this replaces
            it.
          </>
        )}{' '}
        Close the projects in Houdini first: Houdini writes the whole scene on save and would
        overwrite this. A <strong>dry run</strong> still opens each project and runs the tool; it
        just never saves the file.
      </p>

      {report && <SweepReport report={report} />}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {report && !report.dryRun ? 'Close' : 'Not now'}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(true)}>
          {running === 'dry' ? <Loader2 className="animate-spin" /> : null} Dry run
        </Button>
        <Button
          disabled={busy || blockedByBackups}
          title={
            blockedByBackups
              ? 'Existing backups would be destroyed — accept that above to run'
              : undefined
          }
          onClick={() => void run(false)}
        >
          {running === 'run' ? <Loader2 className="animate-spin" /> : null} Refresh{' '}
          {plural(targets.length, 'project')}
        </Button>
      </div>
    </Modal>
  )
}
