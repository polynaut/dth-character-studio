import { Link } from '@tanstack/react-router'
import { Download, ExternalLink } from 'lucide-react'

import { Button, InfoPopup } from '@dth/ui'
import { DAZTOHUE_SCRIPTS_REPO } from '#/lib/rom/api.ts'
import { daztohueScriptsDir } from '#/lib/rom/storage.ts'
import { openExternal } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'
import { ScriptsVersionStatus } from '#/components/tools/scripts-version-status.tsx'
import { InstallReportList } from '#/components/install-controls.tsx'

import type { DazToHueScriptsStatus, InstallReport } from '#/lib/rom/api.ts'

/** The morph-scanning script the install is mainly there to deliver. */
const DTH_SCAN_FRAMES_URL = `${DAZTOHUE_SCRIPTS_REPO}/blob/main/DthScanFrames.dsa`

/**
 * The "DazToHue-Scripts" tab body — an intro pointing at the companion repo plus
 * the download + install section, showing the installed-vs-latest commit status
 * (`ScriptsVersionStatus`) and Dry run / Install actions. Presentational; the
 * install itself lives in the parent.
 */
export function DazToHueScriptsSection({
  dazLibraryFolder,
  status,
  busy,
  report,
  onCloseReport,
  onDryRun,
  onInstall,
}: {
  dazLibraryFolder: string
  status: DazToHueScriptsStatus | null
  busy: boolean
  report: InstallReport | null
  onCloseReport: () => void
  onDryRun: () => void
  onInstall: () => void
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Install the companion{' '}
        <a
          href={DAZTOHUE_SCRIPTS_REPO}
          onClick={(e) => {
            e.preventDefault()
            void openExternal(DAZTOHUE_SCRIPTS_REPO)
          }}
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
        >
          DazToHue-Scripts repo <ExternalLink className="size-3.5" />
        </a>{' '}
        — the Daz Studio scripts behind DTH Character Studio. It includes{' '}
        <strong>DthScanFrames.dsa</strong>, which exports the full morph list of an existing Daz
        scene as a CSV you can import into a character's ROM section.
      </p>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div>
          <h2 className="flex w-fit items-center gap-1 font-semibold">
            DazToHue-Scripts
            <InfoPopup label="DazToHue-Scripts — more information">
              Downloads{' '}
              <a
                href={DAZTOHUE_SCRIPTS_REPO}
                className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
              >
                soltude/DazToHue-Scripts <ExternalLink className="size-3.5" />
              </a>{' '}
              and installs it into “My DAZ 3D Library”. Then, inside Daz Studio, run{' '}
              <a
                href={DTH_SCAN_FRAMES_URL}
                className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
              >
                DthScanFrames.dsa <ExternalLink className="size-3.5" />
              </a>{' '}
              on an open scene to write a CSV of every morph on it — then use a section's{' '}
              <strong>Import from CSV</strong> to pull that morph list into a character's ROM.
            </InfoPopup>
          </h2>
        </div>

        {dazLibraryFolder.trim() ? (
          <p className="text-sm text-muted-foreground">
            Installs into{' '}
            <PathCode path={displayPath(daztohueScriptsDir(dazLibraryFolder.trim()))} />.
          </p>
        ) : (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            “My DAZ 3D Library” isn't set — the scripts have nowhere to install. Set it in{' '}
            <Link to="/settings" className="font-medium underline underline-offset-2">
              Settings
            </Link>{' '}
            first.
          </p>
        )}

        <ScriptsVersionStatus status={status} />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onDryRun}
            disabled={busy || !dazLibraryFolder.trim()}
          >
            {busy ? 'Working…' : 'Dry run'}
          </Button>
          <Button onClick={onInstall} disabled={busy || !dazLibraryFolder.trim()}>
            <Download />{' '}
            {busy
              ? 'Installing…'
              : status?.state === 'outdated'
                ? 'Update'
                : status && status.state !== 'notinstalled'
                  ? 'Reinstall'
                  : 'Install'}
          </Button>
        </div>
        {report && <InstallReportList report={report} onClose={onCloseReport} />}
      </section>
    </>
  )
}
