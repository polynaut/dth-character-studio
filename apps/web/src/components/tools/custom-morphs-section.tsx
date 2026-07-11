import { Download } from 'lucide-react'

import { Button } from '@dth/ui'
import { FolderField, InstallReportList } from '#/components/install-controls.tsx'

import type { InstallReport } from '#/lib/rom/api.ts'

/**
 * "Custom morphs" install section — a source + destination folder pair and
 * Dry run / Install actions. Merge-only install (adds new files, never
 * overwrites). Presentational; the install itself lives in the parent.
 */
export function CustomMorphsSection({
  source,
  dest,
  onSourceChange,
  onDestChange,
  busy,
  report,
  onCloseReport,
  onDryRun,
  onInstall,
}: {
  source: string
  dest: string
  onSourceChange: (value: string) => void
  onDestChange: (value: string) => void
  busy: boolean
  report: InstallReport | null
  onCloseReport: () => void
  onDryRun: () => void
  onInstall: () => void
}) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 className="font-semibold">Custom morphs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Morphs you made with Daz's Transfer Shape Utility. Merge-only — adds new files,
          never overwrites your edits.
        </p>
      </div>
      <FolderField
        label="Morphs source"
        value={source}
        placeholder="D:\…\_morphs"
        help={<>Your custom-morphs source folder.</>}
        onChange={onSourceChange}
      />
      <FolderField
        label="Morphs destination"
        value={dest}
        placeholder="C:\Users\you\Documents\DAZ 3D\Studio\My Library\data\Daz 3D"
        help={
          <>
            Your personal library's <span className="font-mono">data/Daz 3D</span> folder.
          </>
        }
        onChange={onDestChange}
      />
      <div className="flex gap-2">
        <Button variant="outline" onClick={onDryRun} disabled={busy}>
          Dry run
        </Button>
        <Button onClick={onInstall} disabled={busy}>
          <Download /> Install morphs
        </Button>
      </div>
      {report && <InstallReportList report={report} onClose={onCloseReport} />}
    </section>
  )
}
