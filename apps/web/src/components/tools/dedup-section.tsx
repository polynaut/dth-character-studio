import { Button, InfoPopup } from '@dth/ui'
import { FolderField } from '#/components/install-controls.tsx'
import { DedupReportList } from '#/components/tools/dedup-report-list.tsx'

import type { DedupReport } from '#/lib/rom/api.ts'

/**
 * The "Deduplicate" install section: a quarantine-folder field plus Scan / Apply
 * actions, and the scan verdict (`DedupReportList`). Presentational — the scan
 * itself and keeper overrides live in the parent.
 */
export function DedupSection({
  quarantineFolder,
  onQuarantineFolderChange,
  busy,
  report,
  keeperOverrides,
  onChooseKeeper,
  onAcceptShared,
  onCloseReport,
  onScan,
  onApply,
}: {
  quarantineFolder: string
  onQuarantineFolderChange: (value: string) => void
  busy: boolean
  report: DedupReport | null
  keeperOverrides: Set<string>
  /** Pick which copy of a duplicate group to keep — keyed by each member's full
   *  asset PATH (labels collide inside an exact-dup group; see DedupReportList). */
  onChooseKeeper: (groupPaths: Array<string>, keepPath: string) => void
  /** Accept a group of shared files as legitimately shared (drops them from the
   *  conflict list on the next scan). */
  onAcceptShared: (rels: Array<string>) => void
  onCloseReport: () => void
  onScan: () => void
  onApply: () => void
}) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 className="flex w-fit items-center gap-1 font-semibold">
          Deduplicate
          <InfoPopup label="Deduplicate — more information">
            Finds <strong>duplicate assets</strong> (a folder and its identical .zip, or the
            same product at two versions) and <strong>conflicting shared files</strong> — the
            same file shipped by two different products at different sizes (e.g. the G8 and G9
            versions of a product sharing textures), which makes both perpetually show “to
            copy”. <strong>Apply</strong> only <strong>quarantines</strong> the redundant
            duplicate copies (a move — reversible). Shared-file conflicts are{' '}
            <strong>never rewritten</strong> — that would edit an author's downloaded asset;
            instead you <strong>Accept</strong> them, which tells the scan/install they're
            legitimately shared (whatever's installed stays).
          </InfoPopup>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan first to preview; nothing is changed until you Apply.
        </p>
      </div>
      <FolderField
        label="Quarantine folder"
        value={quarantineFolder}
        placeholder="D:\…\_quarantine"
        info={
          <>
            Where Apply moves the redundant duplicate copies. Required to run Apply — nothing is
            moved until it's set. Pick a folder <strong>outside</strong> your asset source
            folders (so it isn't re-scanned); same drive is fastest. The move is reversible.
          </>
        }
        help={<>Where redundant duplicate copies are moved.</>}
        onChange={onQuarantineFolderChange}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onScan} disabled={busy}>
          {busy ? 'Working…' : 'Scan for duplicates'}
        </Button>
        <Button
          variant="destructive"
          onClick={onApply}
          disabled={
            busy ||
            !report?.dryRun ||
            report.duplicates.length === 0 ||
            !quarantineFolder.trim()
          }
          title={
            quarantineFolder.trim()
              ? 'Move the redundant duplicate copies to the quarantine folder (reversible; files are never edited)'
              : 'Set a quarantine folder first'
          }
        >
          Apply dedup
        </Button>
        {report?.duplicates.length && !quarantineFolder.trim() ? (
          <span className="self-center text-xs text-muted-foreground">
            Set a quarantine folder to enable Apply.
          </span>
        ) : null}
      </div>
      {report && (
        <DedupReportList
          report={report}
          busy={busy}
          keeperOverrides={keeperOverrides}
          onChooseKeeper={onChooseKeeper}
          onAcceptShared={onAcceptShared}
          onClose={onCloseReport}
        />
      )}
    </section>
  )
}
