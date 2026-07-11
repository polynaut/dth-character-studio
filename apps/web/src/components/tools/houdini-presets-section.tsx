import { Download } from 'lucide-react'

import { Button } from '@dth/ui'
import { FolderField, InstallReportList } from '#/components/install-controls.tsx'

import type { InstallReport } from '#/lib/rom/api.ts'

/**
 * "Houdini presets" install section — a single source folder and Dry run /
 * Install actions. Merges into the folder set in the DazToHue tab and wires it
 * into `houdini.env`. Presentational; the install itself lives in the parent.
 */
export function HoudiniPresetsSection({
  source,
  onSourceChange,
  busy,
  report,
  onCloseReport,
  onDryRun,
  onInstall,
}: {
  source: string
  onSourceChange: (value: string) => void
  busy: boolean
  report: InstallReport | null
  onCloseReport: () => void
  onDryRun: () => void
  onInstall: () => void
}) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 className="font-semibold">Houdini presets</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your Houdini <span className="font-mono">my_presets</span>. Merges into the folder in
          your Houdini documents folder (set in the DazToHue tab) — adds/updates files without
          deleting the folder first — and wires it into{' '}
          <span className="font-mono">houdini.env</span> (SHARED_PRESETS + HOUDINI_PATH).
        </p>
      </div>
      <FolderField
        label="Houdini presets source"
        value={source}
        placeholder="D:\…\houdini\my_presets"
        help={<>Your Houdini presets source folder.</>}
        onChange={onSourceChange}
      />
      <div className="flex gap-2">
        <Button variant="outline" onClick={onDryRun} disabled={busy}>
          Dry run
        </Button>
        <Button onClick={onInstall} disabled={busy}>
          <Download /> Install Houdini presets
        </Button>
      </div>
      {report && <InstallReportList report={report} onClose={onCloseReport} />}
    </section>
  )
}
