import { useState } from 'react'
import { Loader2, TriangleAlert, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Modal, Switch } from '@dth/ui'
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
 *
 * **All of which is true, and none of which belongs on the surface.** Those
 * caveats once filled six paragraphs of the dialog, and six paragraphs of
 * hedging is not honesty — it is a wall that gets skimmed, and skimming costs
 * exactly the attention the one destructive line needs. So the dialog carries
 * the release, ONE list, the consent line when there is something to consent
 * to, and the buttons; the caveats live in {@link OfferInfo}, where the rest of
 * the app keeps this kind of thing. The at-risk backups are marked ON the
 * project rows rather than listed again underneath — same projects, and a
 * second list of the same names reads as twice the work.
 */

/** Basename for display; the full path is the row's title attribute. */
function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** " (8/20/2026)" for a backup's mtime; '' when it could not be stat'd. */
function backupDate(modifiedAt: string): string {
  if (!modifiedAt) return ''
  const at = new Date(modifiedAt)
  return Number.isNaN(at.getTime()) ? '' : ` (${at.toLocaleDateString()})`
}

/** The caveats, in full, one click from the decision. */
function OfferInfo() {
  return (
    <InfoPopup label="Refreshing DazToHue assets — more information">
      <div className="space-y-2">
        <p>
          The studio runs DazToHue&apos;s <strong>own</strong> tool rather than doing the refresh
          itself, so it can&apos;t say in advance what will change — and no check anywhere says a
          project needs this.
        </p>
        <p>
          <strong>&ldquo;never&rdquo; in the list is not a verdict.</strong> Nothing in a{' '}
          <code>.hip</code> records which DazToHue release its assets came from, so all the studio
          knows is which projects <em>it</em> has run this on. A project is saved only if the scene
          reports itself modified afterwards.
        </p>
        <p>
          A project is copied into its <code>backup/</code> folder before it is saved — and only
          then, because a project the tool leaves unchanged is not saved at all. Each saved project
          keeps an <strong>Undo this run</strong> button in the report, which also stops the studio
          counting that project as refreshed. It is <strong>one rolling copy per project</strong>,
          so a save overwrites the copy already there. If one of those is how you would put a
          project back on an older DazToHue release, copy it somewhere else first.
        </p>
        <p>
          <strong>Close the projects in Houdini first</strong> — Houdini writes the whole scene on
          save and would overwrite this. A <strong>dry run</strong> still opens each project and
          runs the tool; it just never saves the file.
        </p>
      </div>
    </InfoPopup>
  )
}

/**
 * One offered project: the file, who links it, whether its backup is at risk,
 * and when the studio last ran this on it.
 *
 * The list's column header is what makes a bare "never" honest — it reads "last
 * refreshed by the studio", which is the absence of a verdict rather than one.
 * The backup marker says AT RISK, not "will be replaced": `_backup` only copies
 * for a project the tool leaves modified, and nothing here can know in advance
 * which those are.
 */
function CandidateRow({
  candidate,
  riskedBackup,
}: {
  candidate: RefreshCandidate
  /** The existing copy this project's save would overwrite, if there is one. */
  riskedBackup: ExistingBackup | undefined
}) {
  return (
    <li title={candidate.hipPath} className="flex items-baseline gap-2">
      <code className="shrink-0 text-foreground">{fileName(candidate.hipPath)}</code>
      {candidate.characters.length > 0 && (
        <span className="truncate">{candidate.characters.join(', ')}</span>
      )}
      {riskedBackup && (
        <span
          className="shrink-0 text-destructive"
          // The date is not worth a line on the dialog, but it is worth a hover:
          // "is this the copy I kept?" is the whole question.
          title={`${fileName(riskedBackup.backupPath)}${backupDate(riskedBackup.modifiedAt)} — overwritten if this run saves the project`}
        >
          backup at risk
        </span>
      )}
      <span className="ml-auto shrink-0">
        {candidate.bucket === 'stale' ? candidate.lastVersion : 'never'}
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
  /** The user accepted losing the backups already on disk (the destructive
   *  line below). Gates the run, nothing else. */
  const [replaceAccepted, setReplaceAccepted] = useState(false)
  /** A real run has been through, so the copies beside the projects it saved
   *  are now THIS run's — the report's Undo depends on them. From here on the
   *  warning is gone: the loss it named has already happened, and the copies it
   *  would now be aimed at are the ones the user may still want to use. */
  const [replaced, setReplaced] = useState(false)
  const busy = running !== ''

  // Stale first, then never-run: the ones the studio can say something about
  // lead, and one sorted list replaces what used to be two.
  const targets = plan.candidates
    .filter((c) => c.bucket !== 'current')
    .sort((a, b) => Number(b.bucket === 'stale') - Number(a.bucket === 'stale'))
  const skipped = plan.candidates.length - targets.length
  const hipPaths = refreshTargetPaths(plan.candidates)
  const doomedBackups = replaced ? [] : plan.existingBackups
  const riskedByHip = new Map(doomedBackups.map((b) => [b.hipPath, b]))
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
      <div className="flex items-baseline gap-1.5 text-sm">
        <p>
          DazToHue is now <strong>{plan.activeDthVersion}</strong>
          {plan.lastSeenDthVersion && plan.lastSeenDthVersion !== plan.activeDthVersion && (
            <> (was {plan.lastSeenDthVersion})</>
          )}{' '}
          — a <code>.hip</code> keeps the asset definitions it was built with until DazToHue&apos;s
          own <strong>Refresh Assets</strong> runs in it. The studio can run that in each project
          below through <code>hython</code>, without opening Houdini.
        </p>
        <OfferInfo />
      </div>

      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        <p className="mb-1.5 flex items-baseline gap-2 font-medium">
          Last refreshed by the studio
          {skipped > 0 && (
            <span className="ml-auto font-normal">
              {skipped} already on {plan.activeDthVersion}, skipped
            </span>
          )}
        </p>
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {targets.map((candidate) => (
            <CandidateRow
              key={candidate.hipPath}
              candidate={candidate}
              riskedBackup={riskedByHip.get(candidate.hipPath)}
            />
          ))}
        </ul>
      </div>

      {/* The one thing here that can lose something, and the only thing on this
          dialog holding a control.
          ONE short sentence, and "may" is doing the honest work: the consent is
          to the OVERWRITE, and only a project the tool leaves modified is saved
          — so which of these actually go cannot be known here. That distinction
          is real and belongs in OfferInfo, NOT in the sentence somebody reads
          while reaching for the switch. It was on this line once, as "one
          rolling copy per project, overwritten for whichever projects this run
          saves", which is accurate and unreadable. A precise sentence nobody
          parses protects nobody. */}
      {doomedBackups.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-md border-2 border-destructive/60 bg-destructive/10 p-3 text-sm">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span id="replace-houdini-backups-risk">
            Running may replace {plural(doomedBackups.length, 'existing backup')}.
          </span>
          {/* The risk is a STATEMENT and the switch is the consent, so they are
              two elements rather than one: a switch whose only label is
              "Running may replace 2 existing backups" announces the loss and
              never says what turning it on means. `aria-describedby` puts the
              sentence back on the control for a screen reader. */}
          <label htmlFor="replace-houdini-backups" className="ml-auto">
            Let it
          </label>
          <Switch
            id="replace-houdini-backups"
            aria-describedby="replace-houdini-backups-risk"
            checked={replaceAccepted}
            disabled={busy}
            onCheckedChange={setReplaceAccepted}
          />
        </div>
      )}

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
              ? 'An existing backup could be overwritten — accept that above to run'
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
