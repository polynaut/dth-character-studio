import type { ReactNode } from 'react'
import { ChevronRight, CircleCheck, CircleSlash, CircleX, FolderOpen, X } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { InfoPopup } from '#/components/ui/info-popup.tsx'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'

import type { InstallReport } from '#/lib/rom/api.ts'

/** A folder-path text field with a native "Browse…" picker button. */
export function FolderField({
  label,
  value,
  placeholder,
  help,
  onChange,
  info,
}: {
  label: string
  value: string
  placeholder: string
  help: ReactNode
  onChange: (value: string) => void
  /** Optional rich text shown in an "i" info popup next to the label. */
  info?: ReactNode
}) {
  // Prefer the richer `info` text in the popup, falling back to `help`.
  const popup = info ?? help
  return (
    <div>
      <Label className="mb-1 flex w-fit items-center gap-1">
        {label}
        {popup ? <InfoPopup label={`${label} — more information`}>{popup}</InfoPopup> : null}
      </Label>
      <div className="flex gap-2">
        <Input
          value={displayPath(value)}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={async () => {
            const picked = await pickFolder(label)
            if (picked) onChange(picked)
          }}
        >
          <FolderOpen /> Browse
        </Button>
      </div>
    </div>
  )
}

/** A dismiss "×" at the top-right of a report block. */
export function ReportClose({ onClose }: { onClose?: () => void }) {
  if (!onClose) return null
  return (
    <div className="mb-1 flex justify-end">
      <button
        type="button"
        onClick={onClose}
        title="Hide"
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

/** Per-step result list shared by both install panes. */
export function InstallReportList({ report, onClose }: { report: InstallReport; onClose?: () => void }) {
  return (
    <div className="border-t pt-2">
      <ReportClose onClose={onClose} />
      <ul className="space-y-1 text-sm">
      {report.steps.map((step, i) => {
        if (step.status === 'header') {
          return (
            <li
              key={i}
              className="pt-3 font-mono text-xs font-semibold break-all text-foreground first:pt-0"
            >
              {displayPath(step.label)}
            </li>
          )
        }
        const row = (
          <>
            {step.status === 'ok' ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : step.status === 'error' ? (
              <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span className={step.status === 'error' ? 'text-destructive' : ''}>
              <span className="font-medium">{step.label}</span>
              {step.status === 'ok' && step.files > 0 && (
                <span className="text-muted-foreground"> — {step.files} file(s)</span>
              )}
              {step.detail && <span className="text-muted-foreground"> · {step.detail}</span>}
              {step.note && (
                <span className="text-amber-600 dark:text-amber-500" title="Another asset installs these same files">
                  {' '}· ⧉ {step.note}
                </span>
              )}
            </span>
          </>
        )
        const files = step.filesList ?? []
        // A fixed-width leading slot (chevron when expandable, empty spacer
        // otherwise) keeps every row's content aligned.
        if (files.length === 0) {
          return (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {row}
            </li>
          )
        }
        // Expandable: the per-asset list of files an install would copy (hidden
        // by default — the report is already huge).
        return (
          <li key={i}>
            <details>
              <summary className="flex cursor-pointer items-start gap-2 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform in-[[open]]:rotate-90" />
                {row}
              </summary>
              <ul className="mt-1 ml-[1.625rem] space-y-0.5">
                {files.map((f) => (
                  <li key={f} className="font-mono text-xs break-all text-muted-foreground">
                    {f}
                  </li>
                ))}
                {step.files > files.length && (
                  <li className="text-xs text-muted-foreground">
                    … and {step.files - files.length} more
                  </li>
                )}
              </ul>
            </details>
          </li>
        )
      })}
      </ul>
    </div>
  )
}
