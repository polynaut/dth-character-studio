import { Button, InfoPopup } from '@dth/ui'
import { PathCode } from '#/components/path-code.tsx'
import { ReportClose } from '#/components/install-controls.tsx'
import { displayPath } from '#/lib/path.ts'

import type { ConflictCopy, DedupReport, FileConflict } from '#/lib/rom/api.ts'

/** Parse the Genesis number from a source folder name ("_genesis 9" → 9) — mirrors
 *  the Rust `genesis_rank` so the UI can show which copy the install picks. */
function genesisRank(source: string): number {
  const nums = source.match(/\d+/g)
  return nums ? Number(nums[nums.length - 1]) : 0
}
/** The copy the install keeps for a shared file: newer Genesis, then bigger. */
function conflictWinner(copies: Array<ConflictCopy>): ConflictCopy {
  return copies.reduce((best, cp) => {
    const better =
      genesisRank(cp.source) > genesisRank(best.source) ||
      (genesisRank(cp.source) === genesisRank(best.source) && cp.size > best.size)
    return better ? cp : best
  })
}

/** Result of the dedup scan/apply: shared files + duplicate assets. Shared files
 *  are read-only here — the install auto-resolves them (newer genesis, then bigger);
 *  duplicate/version groups are the only thing Apply acts on (quarantine). */
export function DedupReportList({
  report,
  busy,
  keeperOverrides,
  onChooseKeeper,
  onAcceptShared,
  onClose,
}: {
  report: DedupReport
  busy?: boolean
  keeperOverrides: Set<string>
  onChooseKeeper: (groupLabels: Array<string>, keep: string) => void
  /** Accept every shared file in a product group as legitimately shared. */
  onAcceptShared?: (rels: Array<string>) => void
  onClose?: () => void
}) {
  const clean = report.conflicts.length === 0 && report.duplicates.length === 0

  // Collapse shared files by the set of products that ship them — e.g. 8 shared
  // Headlights textures become one "A ↔ B" group.
  const byProducts = new Map<string, { labels: Array<string>; items: Array<FileConflict> }>()
  for (const c of report.conflicts) {
    const labels = c.copies.map((cp) => cp.label).sort()
    const key = labels.join(' | ')
    const g = byProducts.get(key) ?? { labels, items: [] }
    g.items.push(c)
    byProducts.set(key, g)
  }
  const groups = [...byProducts.values()].sort((a, b) => b.items.length - a.items.length)

  return (
    <div className="space-y-4 border-t pt-2 text-sm">
      <ReportClose onClose={onClose} />
      {clean && <p className="text-muted-foreground">No duplicate assets or shared files found.</p>}

      {report.duplicates.length > 0 && (
        <div>
          <p className="mb-1 flex w-fit items-center gap-1 font-medium">
            Duplicate &amp; version assets ({report.duplicates.length})
            <InfoPopup label="Duplicate & version assets — more information">
              Each group is the same content found more than once — an{' '}
              <strong>exact duplicate</strong> (a folder and its identical .zip) or the{' '}
              <strong>same product at a different version</strong> (high file overlap with differing
              sizes, e.g. a <code>…UD</code> vs <code>…UPDATE</code>, marked “version”).{' '}
              <strong>Pick which copy to keep</strong> (the radio) — the rest are moved to the
              quarantine folder on Apply. The chip shows which asset folder (e.g.{' '}
              <code>_genesis 9</code>) the group lives in.
            </InfoPopup>
          </p>
          <ul className="space-y-2">
            {report.duplicates.map((d) => {
              const labels = d.members.map((m) => m.label)
              const sources = [...new Set(d.members.map((m) => m.source))].join(', ')
              const keeperLabel =
                d.members.find((m) => keeperOverrides.has(m.label))?.label ??
                d.members.find((m) => m.isKeeper)?.label
              return (
                <li key={labels.join('|')} className="rounded-md border bg-background/40 p-2">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{sources}</span>
                    {d.kind === 'version' && (
                      <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500">
                        same product, different version
                      </span>
                    )}
                  </div>
                  <ul>
                    {d.members.map((m) => {
                      const isKeep = m.label === keeperLabel
                      return (
                        <li key={m.label}>
                          <button
                            type="button"
                            disabled={!report.dryRun || isKeep}
                            onClick={() => onChooseKeeper(labels, m.label)}
                            className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left ${isKeep ? '' : 'hover:bg-muted/60'} disabled:cursor-default`}
                          >
                            <span
                              className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${isKeep ? 'border-emerald-500' : 'border-muted-foreground/40'}`}
                            >
                              {isKeep && <span className="size-1.5 rounded-full bg-emerald-500" />}
                            </span>
                            <span className={`break-all ${isKeep ? 'font-medium' : 'text-muted-foreground'}`}>
                              {m.label}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              · {m.fileCount} files{m.isZip ? ' · zip' : ''}
                              {isKeep
                                ? ' · keep'
                                : report.dryRun
                                  ? ' · quarantine'
                                  : d.fixed
                                    ? ' · quarantined'
                                    : ''}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {groups.length > 0 && (
        <div>
          <p className="mb-1 flex w-fit items-center gap-1 font-medium">
            Shared files ({report.conflicts.length} across {groups.length} product group
            {groups.length === 1 ? '' : 's'})
            <InfoPopup label="Shared files — more information">
              Files shipped by two different products at different sizes. The install resolves these
              automatically — <strong>newer Genesis wins</strong>, then the <strong>bigger</strong>{' '}
              file — installs the winner and leaves the rest, so they never show as “to copy” (the{' '}
              <span className="text-emerald-600 dark:text-emerald-500">◀ keeps</span> marker shows
              which). If a group is legitimately shared and you'd rather it stop appearing here,{' '}
              <strong>Accept</strong> it — the scan/install then treats those files as in-sync
              (whatever's installed stays). Files are never edited.
            </InfoPopup>
          </p>
          <ul className="space-y-2">
            {groups.map((g) => {
              const sourceOf = new Map<string, string>()
              for (const c of g.items) for (const cp of c.copies) sourceOf.set(cp.label, cp.source)
              return (
                <li key={g.labels.join('|')} className="rounded-md border bg-background/40 p-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium break-all">
                      {g.labels.map((l, idx) => (
                        <span key={l}>
                          {idx > 0 && <span className="text-muted-foreground"> ↔ </span>}
                          {l}
                          <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                            {sourceOf.get(l)}
                          </span>
                        </span>
                      ))}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {g.items.length} shared file{g.items.length === 1 ? '' : 's'} differ
                    </span>
                    {onAcceptShared && report.dryRun && (
                      <Button
                        variant="outline"
                        size="xs"
                        className="ml-auto shrink-0"
                        disabled={busy}
                        title="Mark these shared files as legitimately shared — they stop appearing here (files are never edited)"
                        onClick={() => onAcceptShared(g.items.map((c) => c.rel))}
                      >
                        Accept
                      </Button>
                    )}
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                      Show files
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {g.items.map((c) => {
                        const winner = conflictWinner(c.copies)
                        return (
                          <li key={c.rel} className="font-mono text-xs break-all">
                            {c.rel}
                            <span className="font-sans text-muted-foreground">
                              {' '}—{' '}
                              {c.copies.map((cp, k) => (
                                <span key={cp.label}>
                                  {k > 0 && ' vs '}
                                  {cp.size}B{cp.inZip ? ' (zip)' : ''}
                                  {cp === winner && (
                                    <span className="text-emerald-600 dark:text-emerald-500">
                                      {' '}◀ keeps
                                    </span>
                                  )}
                                </span>
                              ))}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {!report.dryRun && (
        <p className="text-xs text-muted-foreground">
          Quarantined {report.assetsQuarantined} asset(s) — moved to{' '}
          <PathCode path={displayPath(report.backupDir)} />. Your downloaded files were not edited.
          Re-scan to confirm, then delete that folder when satisfied.
        </p>
      )}
    </div>
  )
}
