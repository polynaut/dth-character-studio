/**
 * The Houdini utils drawer's presentational parts — the General tab, the row
 * primitives, the per-action reports and the node picker.
 *
 * Every one of these takes props and holds no drawer state, which is why they
 * split cleanly out of `houdini-utils-panel.tsx`: the panel owns the runs and
 * the selection, these only render what a run produced.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Undo2 } from 'lucide-react'

import { Button, InfoPopup, Label } from '@dth/ui'
import type {
  MaterialNodeInfo,
  MaterialScanProject,
  MaterialUtilReport,
  NodeKind,
  ProjectPrefillInfo,
} from '#/lib/rom/api.ts'
import { DTH_FPS, defaultsRowsFor, formatFps, formatFrameRange } from '#/lib/rom/houdini-defaults.ts'
import { countRehomable } from '#/lib/rom/houdini-validate.ts'
import { mergeTouchCount, surfaceLabel } from '#/lib/rom/houdini-material-merge.ts'
import type { SurfaceMergePlan } from '#/lib/rom/houdini-material-merge.ts'
import { displayPath } from '#/lib/path.ts'
import houdiniLogo from '#/assets/houdini-logo.svg'

import { fileName, nodeKey, nodeLabel, sectionLabel } from './shared.ts'
import type { ActionReport, RestoreProps, ScanState } from './shared.ts'

export function GeneralTab({
  scan,
  charFolder,
  result,
  repathReason,
  restore,
  onRescan,
}: {
  scan: ScanState
  charFolder: string
  /** The last action's report — one slot for all three (see {@link ActionReport}). */
  result: ActionReport | null
  /** Why the repath action is unavailable, '' when it can run. */
  repathReason: string
  restore: RestoreProps
  onRescan: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Title + Rescan on one line. There used to be a "N projects read" count
          under it, from when this tab listed the character's whole set; with one
          project it only ever said "1 project read" — and the card below already
          names it. */}
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Label className="flex w-fit items-center gap-1 text-base font-semibold">
            Project checks
            {/* The full `$JOB` story lives here rather than above the cards: it
                explains WHY the row exists, which is worth one click and not
                worth six lines of prose on every visit. */}
            <InfoPopup label="Project checks — more information">
              <div className="space-y-2">
                <p>
                  What has to be true for a project to keep working when it — or your library —
                  moves.
                </p>
                <p>
                  <code>$JOB</code> is saved inside the project file, so an older one can still
                  point somewhere else. <strong>Repair project settings</strong> puts it back on
                  the character folder, which is what makes the paths you pick from now on come
                  out relative.
                </p>
                <p>
                  The same run puts the <strong>timeline</strong> on {DTH_FPS} fps. A ROM is one
                  pose per frame at {DTH_FPS}, so a scene left on Houdini&apos;s own 24 lands
                  every imported frame between two of its own. DazToHue&apos;s import node sets
                  this itself when it loads the files — this is for the projects where that
                  hasn&apos;t happened.
                </p>
                <p>
                  <strong>Make paths portable</strong> is the other half: it rewrites paths
                  already stored absolute to <code>$HIP/…</code> or <code>$JOB/…</code>.
                </p>
              </div>
            </InfoPopup>
          </Label>
          {/* Rescan sits beside the title, not after the count: it is an ACTION on
              the section, and the count is a result of it. Splitting them puts the
              two things you can click next to each other. */}
          <Button variant="ghost" size="sm" disabled={scan.loading} onClick={onRescan}>
            <RefreshCw className={scan.loading ? 'animate-spin' : ''} /> Rescan
          </Button>
        </div>
      </div>

      {scan.loading ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Opening the project in Houdini — this takes a moment per file.
        </p>
      ) : scan.error ? (
        <p className="rounded-md border border-destructive/50 p-3 text-xs text-destructive">
          {scan.error}
        </p>
      ) : scan.projects.length === 0 ? (
        // The drawer always HAS a project — it is the card its button was
        // pressed on — so "none linked" would be a false explanation. Nothing
        // here means the scan came back without it.
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          The scan returned nothing for this project — try Rescan.
        </p>
      ) : (
        <div className="space-y-3">
          {scan.projects.map((project) => (
            <ProjectCard key={project.hipPath} project={project}>
              {!project.ok ? (
                <p className="text-xs text-destructive">{project.error}</p>
              ) : (
                <ul className="space-y-2.5">
                  {defaultsRowsFor(project, charFolder).map((row) => (
                    <CheckRow
                      key={row.key}
                      label={row.label}
                      // `unknown` is NOT a warning: nobody read the value, so
                      // nothing is known to be wrong — and the repair skips it.
                      warn={row.status === 'differs'}
                      // Spelled by the row: "unknown" means nobody could read
                      // the $JOB, but for the CSV path it means the installed
                      // DazToHue has no such parameter — different answers.
                      verdict={row.verdict}
                    >
                      {/* Values stay VISIBLE rather than moving into a tooltip:
                          a row the user can't action needs its reason on
                          screen, and a row they can needs to show what a run
                          would replace. A matching row is just the one path. */}
                      {row.status === 'differs' ? (
                        <>
                          <PathLine label="now" value={row.current} />
                          <PathLine label="studio expects" value={row.expected} />
                          {!row.actionable && <p>{row.reason}</p>}
                        </>
                      ) : row.status === 'unknown' ? (
                        <p>The scan could not read this value, so nothing here is repaired.</p>
                      ) : (
                        <PathLine value={row.current} />
                      )}
                    </CheckRow>
                  ))}
                  <RefRows refs={project.refs} reason={repathReason} />
                  <PrefillRow prefill={project.prefill} />
                </ul>
              )}
            </ProjectCard>
          ))}
        </div>
      )}

      {/* ONE report slot for the tab's three actions — see {@link ActionReport}. */}
      {result?.kind === 'defaults' && <DefaultsReport report={result.report} restore={restore} />}
      {result?.kind === 'repath' && <RepathReport report={result.report} restore={restore} />}
      {result?.kind === 'prefill' && <PrefillReport report={result.report} restore={restore} />}
      {result?.kind === 'refresh' && <RefreshReport report={result.report} restore={restore} />}
    </div>
  )
}

/**
 * One project check: its name, a right-aligned verdict, and the detail beneath.
 *
 * The aligned verdict column is what makes a card scannable — a status that
 * sits wherever its label happens to end turns five checks into five unrelated
 * sentences, which is exactly how this tab read before.
 */
export function CheckRow({
  label,
  warn,
  verdict,
  children,
}: {
  label: string
  /** true = something to fix here (amber + the warning mark). */
  warn: boolean
  verdict: string
  children?: ReactNode
}) {
  return (
    <li className="text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{label}</span>
        {warn ? (
          <span className="flex shrink-0 items-center gap-1 text-amber-500">
            <AlertTriangle className="size-3 shrink-0" />
            {verdict}
          </span>
        ) : (
          <span className="shrink-0 text-muted-foreground">{verdict}</span>
        )}
      </div>
      {children ? <div className="mt-0.5 space-y-0.5 text-muted-foreground">{children}</div> : null}
    </li>
  )
}

/** A folder value inside a check row — one truncated line, full path on hover. */
export function PathLine({ label, value }: { label?: string; value: string }) {
  return (
    <p className="truncate" title={value}>
      {label ? `${label}: ` : ''}
      <code>{displayPath(value) || '—'}</code>
    </p>
  )
}

/**
 * The three reference rows: how portable this project's stored paths are,
 * whether any DazToHue import points at a file that isn't there, and whether
 * any baker LAYER texture does.
 *
 * The first two are repairable, and that is the point of showing them here:
 * repairing `$JOB` only helps paths picked AFTERWARDS — these are the ones
 * already written down, and fixing them is what turns "capable of being
 * movable" into movable.
 *
 * The third is the near-exception: a missing texture whose library-relative
 * tail exists under the CURRENT library (`rehomable`) is fixed by Make paths
 * portable; the rest are fixed outside the studio. Shown either way because
 * nothing else in the pipeline reports it (DazToHue bakes without it and still
 * says success). Only the UNFIXABLE remainder stays out of `clean` — gating a
 * repair on a problem that repair cannot touch would strand the button.
 */
export function RefRows({
  refs,
  reason,
}: {
  refs: {
    collapsible: number
    foreign: number
    broken: ReadonlyArray<string>
    missingTextures: ReadonlyArray<string>
    rehomable: ReadonlyArray<string>
  }
  reason: string
}) {
  const clean =
    refs.collapsible === 0 && refs.broken.length === 0 && refs.rehomable.length === 0
  const fixableTextures = countRehomable(refs.missingTextures, refs.rehomable)
  return (
    <>
      <CheckRow
        label="Reference paths"
        warn={refs.collapsible > 0 || refs.rehomable.length > 0}
        // The two numbers are NOT summed: `collapsible` counts PARMS and
        // `rehomable` counts unique FILES (de-duplicated so the Baker-textures
        // row can intersect it with `missingTextures`). Adding them would
        // print one label over two units — and the tab's whole contract is
        // that a number it shows is a number the run delivers.
        verdict={
          refs.collapsible > 0 && refs.rehomable.length > 0
            ? `${refs.collapsible} absolute, ${refs.rehomable.length} to repoint`
            : refs.collapsible > 0
              ? `${refs.collapsible} absolute`
              : refs.rehomable.length > 0
                ? `${refs.rehomable.length} to repoint`
                : refs.foreign > 0
                  ? 'nothing more to make portable'
                  : 'all relative'
        }
      >
        {refs.collapsible > 0 && (
          <p>
            {refs.collapsible} path{refs.collapsible === 1 ? '' : 's'} can be stored relative to{' '}
            <code>$HIP</code>, <code>$JOB</code> or <code>$DAZ3D_LIB</code>.
          </p>
        )}
        {refs.rehomable.length > 0 && (
          <p>
            {refs.rehomable.length} file{refs.rehomable.length === 1 ? '' : 's'} under another
            library root exist{refs.rehomable.length === 1 ? 's' : ''} in your Daz library —
            Make paths portable points {refs.rehomable.length === 1 ? 'it' : 'them'} at{' '}
            <code>$DAZ3D_LIB</code>.
          </p>
        )}
        {refs.foreign > 0 && (
          <p>
            {refs.foreign} live outside those roots and cannot be made portable — they stay
            absolute.
          </p>
        )}
      </CheckRow>
      <CheckRow
        label="Import references"
        warn={refs.broken.length > 0}
        verdict={refs.broken.length === 0 ? 'all resolve' : `${refs.broken.length} broken`}
      >
        {refs.broken.length > 0 && (
          <p className="truncate" title={refs.broken.join(', ')}>
            {refs.broken.join(', ')} — rebuilt from the same node&apos;s other export files.
          </p>
        )}
      </CheckRow>
      {/* Full paths here, basenames on the card badge: this is the view where
          "which product is gone" is answerable. */}
      <CheckRow
        label="Baker textures"
        warn={refs.missingTextures.length > 0}
        verdict={
          refs.missingTextures.length === 0
            ? 'all resolve'
            : `${refs.missingTextures.length} missing`
        }
      >
        {refs.missingTextures.length > 0 && (
          <>
            <p className="truncate" title={refs.missingTextures.join(', ')}>
              {refs.missingTextures.slice(0, 3).join(', ')}
              {refs.missingTextures.length > 3
                ? ` (+${refs.missingTextures.length - 3} more)`
                : ''}
            </p>
            <p>
              DazToHue bakes without them and still reports success, so nothing else in the
              pipeline will tell you.{' '}
              {fixableTextures > 0
                ? fixableTextures === refs.missingTextures.length
                  ? `${fixableTextures === 1 ? 'It exists' : 'All of them exist'} in your Daz library — Make paths portable repoints ${fixableTextures === 1 ? 'it' : 'them'}.`
                  : `${fixableTextures} of them exist in your Daz library — Make paths portable repoints those; for the rest, reinstall the product or restore the library.`
                : 'Reinstall the product or restore the library.'}
            </p>
          </>
        )}
      </CheckRow>
      {/* The gate's reason belongs beside the rows it blocks, not only on the
          disabled button. */}
      {!clean && reason !== '' && <li className="text-xs text-amber-500">{reason}</li>}
    </>
  )
}

/**
 * What Generate project would have wired, for a project that already exists.
 *
 * Two separate facts, and conflating them would be the whole trap: `fillable`
 * is work the studio can do now; `missing` is a parameter the INSTALLED
 * DazToHue doesn't have. Naming the second is the point — the PoseAsset CSV
 * path is absent from DazToHue 2.5 (the node ships a button instead), so a user
 * who expected it filled gets a reason rather than a silent gap, and the same
 * action starts filling it the day that release lands.
 */
export function PrefillRow({ prefill }: { prefill: ProjectPrefillInfo }) {
  const short = (label: string) => label.split(' ').pop() ?? label
  if (prefill.fillable.length === 0 && prefill.missing.length === 0) return null
  return (
    <CheckRow
      label="DazToHue network"
      warn={prefill.fillable.length > 0}
      verdict={
        prefill.fillable.length === 0
          ? 'nothing left to fill'
          : `${prefill.fillable.length} blank`
      }
    >
      {prefill.fillable.length > 0 && (
        <p className="truncate" title={prefill.fillable.join(', ')}>
          The studio knows these: {prefill.fillable.map(short).join(', ')}.
        </p>
      )}
      {prefill.missing.length > 0 && (
        <p>
          Your DazToHue version has no {prefill.missing.map(short).join(', ')} — it will be filled
          automatically once a release adds it.
        </p>
      )}
    </CheckRow>
  )
}

/**
 * The revert offer, and the only place a backup is ever mentioned.
 *
 * Every real run takes one rolling backup before it saves. Saying so on each
 * successful run — which is what this drawer used to do, four times over —
 * teaches the eye to skip the line, so the backup stays silent until it is
 * worth something: an entry that FAILED, on a file the run had already started
 * writing. Anything that failed earlier carries no `backupPath` and gets no
 * offer, because there is nothing it could undo.
 */
export function RestoreOffer({
  hipPath,
  backupPath,
  restore,
}: {
  hipPath: string
  /** '' = nothing was written for this file, so nothing to put back. */
  backupPath: string
  restore: RestoreProps
}) {
  if (!backupPath) return null
  if (restore.done.has(hipPath)) {
    return <p className="mt-1 text-muted-foreground">Restored to the state before this run.</p>
  }
  return (
    <div className="mt-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={restore.busy !== ''}
        title={`Put ${fileName(hipPath)} back the way it was before this run. Close it in Houdini first — an open copy would save over the restore.`}
        onClick={() => restore.onRestore(hipPath, backupPath)}
      >
        {restore.busy === hipPath ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo this
        run
      </Button>
    </div>
  )
}

/** What a prefill did, or would do, per project. */
export function PrefillReport({
  report,
  restore,
}: {
  report: MaterialUtilReport
  restore: RestoreProps
}) {
  const short = (label: string) => label.split(' ').pop() ?? label
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Network filled'}
      </p>
      <ul className="space-y-2 text-xs">
        {report.prefill.map((entry) => (
          <li key={entry.hipPath}>
            <p className="truncate" title={entry.hipPath}>
              <strong>{fileName(entry.hipPath)}</strong>
            </p>
            {entry.ok ? (
              <>
                <p className="text-muted-foreground">
                  {entry.filled.length} parameter{entry.filled.length === 1 ? '' : 's'} filled
                  {entry.skippedSet.length > 0
                    ? ` · ${entry.skippedSet.length} already set, left alone`
                    : ''}
                </p>
                {entry.filled.map((parm) => (
                  <p key={parm.label} className="truncate text-muted-foreground" title={parm.value}>
                    {short(parm.label)} = <code>{parm.value}</code>
                  </p>
                ))}
                {entry.skippedMissing.length > 0 && (
                  <p className="text-muted-foreground">
                    Not in your DazToHue version: {entry.skippedMissing.map(short).join(', ')}.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-destructive">{entry.error}</p>
                <RestoreOffer
                  hipPath={entry.hipPath}
                  backupPath={entry.backupPath}
                  restore={restore}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What an asset refresh did, per project.
 *
 * Deliberately thin on claims: the studio executed DazToHue's own tool and has
 * no view of what it changed, so the row reports the tool that ran and whether
 * the scene came back modified — the two things actually observed.
 *
 * The "tool not found" case gets the most words, because it is the one failure
 * the user can act on: the shelves come from the Houdini documents folder in
 * Settings, and naming the DazToHue tools that WERE there turns a dead end into
 * a diagnosis.
 */
export function RefreshReport({
  report,
  restore,
}: {
  report: MaterialUtilReport
  restore: RestoreProps
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — no project file was saved' : 'Assets refreshed'}
      </p>
      <ul className="space-y-2 text-xs">
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
                <RestoreOffer
                  hipPath={entry.hipPath}
                  backupPath={entry.backupPath}
                  restore={restore}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What a repath did, or would do, per project. */
export function RepathReport({
  report,
  restore,
}: {
  report: MaterialUtilReport
  restore: RestoreProps
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Paths updated'}
      </p>
      <ul className="space-y-2 text-xs">
        {report.repath.map((entry) => (
          <li key={entry.hipPath}>
            <p className="truncate" title={entry.hipPath}>
              <strong>{fileName(entry.hipPath)}</strong>
            </p>
            {entry.ok ? (
              <>
                <p className="text-muted-foreground">
                  {entry.collapsed} reference{entry.collapsed === 1 ? '' : 's'} made portable
                  {entry.repaired.length > 0
                    ? ` · ${entry.repaired.length} broken import${entry.repaired.length === 1 ? '' : 's'} repaired`
                    : ''}
                  {/* `reference(s)`, not a bare count: the confirm dialog
                      promised de-duplicated FILES and the run reports the
                      PARMS it rewrote, which is the larger number whenever one
                      moved product is named by several layers. */}
                  {entry.rehomed.length > 0
                    ? ` · ${entry.rehomed.length} reference${entry.rehomed.length === 1 ? '' : 's'} rehomed onto $DAZ3D_LIB`
                    : ''}
                </p>
                {entry.repaired.map((fix) => (
                  <p key={fix.label} className="truncate text-muted-foreground" title={fix.from}>
                    {fix.label}: <code>{fix.to}</code>
                  </p>
                ))}
                {/* Old AND new for a rehome — this rewrite changes which FILE
                    the scene reads, so the report shows the pair, not just
                    the destination. */}
                {entry.rehomed.map((fix) => (
                  <p key={fix.label} className="truncate text-muted-foreground" title={fix.from}>
                    {fix.label}: <code>{fix.from}</code> → <code>{fix.to}</code>
                  </p>
                ))}
                {entry.foreign.length > 0 && (
                  <p className="flex items-start gap-1 text-amber-500">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>
                      {entry.foreign.length} path{entry.foreign.length === 1 ? '' : 's'} stay
                      absolute — outside your Daz library and this character&apos;s folders:{' '}
                      {entry.foreign.slice(0, 3).join(', ')}
                      {entry.foreign.length > 3 ? ` (+${entry.foreign.length - 3} more)` : ''}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-destructive">{entry.error}</p>
                <RestoreOffer
                  hipPath={entry.hipPath}
                  backupPath={entry.backupPath}
                  restore={restore}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What a `$JOB` repair did, or would do, per project. */
export function DefaultsReport({
  report,
  restore,
}: {
  report: MaterialUtilReport
  restore: RestoreProps
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Repair complete'}
      </p>
      <ul className="space-y-2 text-xs">
        {report.defaults.map((entry) => (
          <li key={entry.hipPath}>
            <p className="truncate" title={entry.hipPath}>
              <strong>{fileName(entry.hipPath)}</strong>
            </p>
            {entry.ok ? (
              <div className="space-y-0.5 text-muted-foreground">
                {entry.changedJob && (
                  <p>
                    <code>{displayPath(entry.previousJob) || '—'}</code> →{' '}
                    <code>{displayPath(entry.job)}</code>
                  </p>
                )}
                {entry.changedFps && (
                  <p>
                    {formatFps(entry.previousFps) || '—'} fps → {formatFps(entry.fps)} fps
                  </p>
                )}
                {entry.changedRange && (
                  <p>
                    frames {formatFrameRange(entry.previousStart, entry.previousEnd)} →{' '}
                    {formatFrameRange(entry.start, entry.end)}
                  </p>
                )}
                {!entry.changed && <p>Already correct — left untouched.</p>}
              </div>
            ) : (
              <>
                <p className="text-destructive">{entry.error}</p>
                <RestoreOffer
                  hipPath={entry.hipPath}
                  backupPath={entry.backupPath}
                  restore={restore}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What the merge will do to each target's own material slots, before running.
 *
 * The transfer's one genuinely surprising act: installing a `Skin` that merges
 * fifteen Daz surfaces removes the fifteen slots at the target that claim those
 * same surfaces, because a surface can belong to only one slot. Correct — and
 * previously invisible until the report, which is how it read as data loss.
 *
 * Silent when nothing is affected: a preview that says "0 slots replaced" on
 * every run trains the user to skip the one time it doesn't.
 */
export function MergePreview({
  entries,
  labelFor,
}: {
  entries: ReadonlyArray<{ hipPath: string; nodePath: string; plan: SurfaceMergePlan }>
  labelFor: (hipPath: string, nodePath: string) => string
}) {
  const affected = entries.filter(
    (entry) => mergeTouchCount(entry.plan) > 0 || entry.plan.unclaimed.length > 0,
  )
  if (affected.length === 0) return null
  return (
    <div className="rounded-md border p-3 text-xs">
      <p className="mb-1 text-sm font-medium">What this replaces at each target</p>
      <p className="mb-2 text-muted-foreground">
        A Daz surface belongs to exactly one material slot, so installing these materials takes
        back the surfaces they claim. Every other slot is left alone.
      </p>
      <ul className="space-y-1.5">
        {affected.map((entry) => (
          <li key={nodeKey(entry.hipPath, entry.nodePath)}>
            <p className="truncate">
              <strong>{labelFor(entry.hipPath, entry.nodePath)}</strong> —{' '}
              <code>{fileName(entry.hipPath)}</code>
            </p>
            {entry.plan.evicted.length > 0 && (
              <p className="text-muted-foreground">
                {entry.plan.evicted.length} slot{entry.plan.evicted.length === 1 ? '' : 's'}{' '}
                replaced: {entry.plan.evicted.join(', ')}
              </p>
            )}
            {entry.plan.trimmed.length > 0 && (
              <p className="text-muted-foreground">
                {entry.plan.trimmed.length} slot{entry.plan.trimmed.length === 1 ? '' : 's'} keep
                their remaining surfaces: {entry.plan.trimmed.join(', ')}
              </p>
            )}
            {entry.plan.unclaimed.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  {entry.plan.unclaimed.length} surface
                  {entry.plan.unclaimed.length === 1 ? '' : 's'} the copied materials claim exist
                  on no slot here: {entry.plan.unclaimed.map(surfaceLabel).join(', ')}.{' '}
                  {entry.plan.evicted.length === 0 && entry.plan.trimmed.length === 0
                    ? 'Nothing at all matched — check both nodes are the same figure.'
                    : 'Normal if the source wears something this character does not.'}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The project → material-node list both sides share. */
export function NodePicker({
  scan,
  kind,
  mode,
  selected,
  onToggle,
  disabledKey,
  empty,
}: {
  scan: ScanState
  /** Only this kind's nodes are listed — one scan carries both. */
  kind: NodeKind
  mode: 'single' | 'multi'
  selected: ReadonlySet<string>
  onToggle: (hipPath: string, nodePath: string) => void
  /** A node that cannot be picked here (the chosen source, in the target list). */
  disabledKey?: string
  empty?: string
}) {
  if (scan.loading) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Opening the project in Houdini — this takes a moment per file.
      </p>
    )
  }
  if (scan.error) {
    return <p className="rounded-md border border-destructive/50 p-3 text-xs text-destructive">{scan.error}</p>
  }
  if (scan.projects.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        {empty ?? 'No Houdini projects to scan.'}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {scan.projects.map((project) => (
        <ProjectCard key={project.hipPath} project={project}>
          {!project.ok ? (
            <p className="text-xs text-destructive">{project.error}</p>
          ) : project.nodes.filter((n) => n.nodeType === kind).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No DazToHue {kind} nodes in this project.
            </p>
          ) : (
            <ul>
              {project.nodes
                .filter((n) => n.nodeType === kind)
                .map((node) => {
                  const key = nodeKey(project.hipPath, node.path)
                  return (
                    <li key={key}>
                      <MaterialNodeRow
                        node={node}
                        mode={mode}
                        checked={selected.has(key)}
                        disabled={disabledKey === key}
                        onToggle={() => onToggle(project.hipPath, node.path)}
                      />
                    </li>
                  )
                })}
            </ul>
          )}
        </ProjectCard>
      ))}
    </div>
  )
}

/**
 * A scanned Houdini project, wearing the linked-project card look: the
 * `houdini-card` tint/border, the orange left accent bar and the Houdini mark —
 * the same anatomy as the card this drawer was opened from, so a project reads
 * as the same kind of thing here as on the character page.
 *
 * The card is the PROJECT; its material nodes are plain rows inside it. Making
 * each node a card too would have two nested card frames competing for the same
 * "this is one thing" signal, and the node is not a file — it lives in this one.
 */
export function ProjectCard({
  project,
  children,
}: {
  project: MaterialScanProject
  children: ReactNode
}) {
  return (
    <div className="relative w-full">
      <div className="houdini-card relative rounded-lg border p-3 pl-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#262626]">
            <img src={houdiniLogo} alt="" aria-hidden className="size-5 object-contain" />
          </span>
          <p className="min-w-0 flex-1 truncate text-base font-medium" title={project.hipPath}>
            {fileName(project.hipPath)}
          </p>
        </div>
        <div className="mt-2">{children}</div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-houdini-orange"
      />
    </div>
  )
}

/**
 * One material node inside a project card — a plain row, not a card of its own.
 *
 * The whole row is the control (a `<label>` wrapping the input), so clicking
 * anywhere on it selects. Selection reads as an orange tint rather than a ring:
 * inside a card that already has an orange border, another border would just
 * add noise. The heading is the network-box title when the node has one, since
 * that is the name the user gave this network.
 */
export function MaterialNodeRow({
  node,
  mode,
  checked,
  disabled,
  onToggle,
}: {
  node: MaterialNodeInfo
  /** Multi = a target (checkbox); single = the one source (radio). */
  mode: 'single' | 'multi'
  checked: boolean
  /** Already chosen as the source — shown but refused, so the reason is visible
   *  rather than the row silently vanishing from the target list. */
  disabled: boolean
  onToggle: () => void
}) {
  const { primary, secondary } = nodeLabel(node)
  return (
    <label
      className={`flex items-start gap-3 rounded-md px-2 py-2 ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : `cursor-pointer ${checked ? 'bg-houdini-orange/20' : 'hover:bg-houdini-orange/10'}`
      }`}
    >
      <input
        type={mode === 'multi' ? 'checkbox' : 'radio'}
        name={mode === 'single' ? 'material-source' : undefined}
        className="mt-1 size-4 shrink-0 accent-houdini-orange"
        aria-label={primary}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {primary}
          {secondary && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground/70">{secondary}</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={node.path}>
          {/* Every folder kind reports itself the same way — section counts
              straight off the scan; only the material node has a bespoke line. */}
          {node.nodeType !== 'material'
            ? node.sectionCounts.map((s) => `${s.label} ${s.count}`).join(' · ')
            : `${node.materials} material${node.materials === 1 ? '' : 's'} · ${node.uvChannels} UV channel${
                node.uvChannels === 1 ? '' : 's'
              } · ${node.bakers} baker${node.bakers === 1 ? '' : 's'} · ${node.layers} layer${
                node.layers === 1 ? '' : 's'
              }`}
          {disabled && ' — chosen as the source'}
        </span>
      </span>
    </label>
  )
}

/** What a run (or dry run) did, per target. */
export function TransferReport({
  report,
  labelFor,
  restore,
}: {
  report: MaterialUtilReport
  /** Network-box name for a node — falls back to the node path when unscanned. */
  labelFor: (hipPath: string, nodePath: string) => string
  restore: RestoreProps
}) {
  // A failed SAVE marks every target node in that file, and they all share the
  // one rolling backup — so the revert is offered once per FILE, not once per
  // node, or a three-node project would grow three buttons that do the same
  // thing. Keyed on the first failing entry for each path.
  const offerAt = new Map<string, number>()
  report.targets.forEach((target, index) => {
    if (!target.ok && target.backupPath && !offerAt.has(target.hipPath)) {
      offerAt.set(target.hipPath, index)
    }
  })
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Transfer complete'}
      </p>
      {report.useLibVar && (
        <p className="mb-2 text-xs text-muted-foreground">
          {report.rewrittenPaths} texture path{report.rewrittenPaths === 1 ? '' : 's'} pointed at{' '}
          <code>$DAZ3D_LIB</code>.
        </p>
      )}
      {report.foreignPaths.length > 0 && (
        <p className="mb-2 flex items-start gap-1 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>
            {report.foreignPaths.length} texture
            {report.foreignPaths.length === 1 ? '' : 's'} live outside your Daz library and stay
            absolute — the copy is only as movable as those paths:{' '}
            {report.foreignPaths.slice(0, 3).join(', ')}
            {report.foreignPaths.length > 3 ? ` (+${report.foreignPaths.length - 3} more)` : ''}
          </span>
        </p>
      )}
      <ul className="space-y-2 text-xs">
        {report.targets.map((target, index) => (
          <li key={`${target.hipPath}|${target.nodePath}`}>
            <p className="truncate" title={`${target.hipPath} — ${target.nodePath}`}>
              <strong>{labelFor(target.hipPath, target.nodePath)}</strong> —{' '}
              <code>{fileName(target.hipPath)}</code>
            </p>
            {target.ok ? (
              <>
                <p className="text-muted-foreground">
                  {target.sections
                    .map((s) => `${sectionLabel(s.key)} ${s.before} → ${s.after}`)
                    .join(' · ')}
                </p>
                {/* Named, not just counted: a slot that vanished without being
                    named reads as data loss even when it was the correct
                    thing to do. */}
                {target.sections
                  .filter((s) => s.evicted.length > 0 || s.trimmed.length > 0)
                  .map((s) => (
                    <p key={s.key} className="text-muted-foreground">
                      {s.evicted.length > 0 &&
                        `Replaced ${s.evicted.length} slot${s.evicted.length === 1 ? '' : 's'} whose surfaces moved into the copied materials: ${s.evicted.join(', ')}. `}
                      {s.trimmed.length > 0 &&
                        `Kept ${s.trimmed.join(', ')} with the surfaces nothing else claims.`}
                    </p>
                  ))}
              </>
            ) : (
              <>
                <p className="text-destructive">{target.error}</p>
                {offerAt.get(target.hipPath) === index && (
                  <RestoreOffer
                    hipPath={target.hipPath}
                    backupPath={target.backupPath}
                    restore={restore}
                  />
                )}
              </>
            )}
            {target.unclaimedSurfaces.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  {target.unclaimedSurfaces.length} surface
                  {target.unclaimedSurfaces.length === 1 ? '' : 's'} the copied materials claim
                  exist on no slot here:{' '}
                  {target.unclaimedSurfaces.map(surfaceLabel).join(', ')} — normal if the source
                  wears something this character does not, but a whole set means the two nodes
                  describe different figures.
                </span>
              </p>
            )}
            {target.missingMaterials.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Set up first: this node still has no material named{' '}
                  {target.missingMaterials.map((m) => `"${m}"`).join(', ')} — add a matching slot
                  in the Materials tab (or include Material slots above), or those bakers produce
                  no texture.
                </span>
              </p>
            )}
            {target.missingUvSources.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Set up first: these bakers read {target.missingUvSources.join(', ')}, which only
                  a UV channel produces — tick UV channels, or build the same channel at the
                  target.
                </span>
              </p>
            )}
            {target.missingGroups.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>Groups not found on the target geometry: {target.missingGroups.join(', ')}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
