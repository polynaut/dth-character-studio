import { AlertTriangle, Loader2, Pencil, RefreshCw } from 'lucide-react'

import { Button, InfoPopup } from '@dth/ui'
import { InstallCard } from '#/components/settings/install-card.tsx'
import { PathCode } from '#/components/path-code.tsx'
import { displayPath } from '#/lib/path.ts'
import houdiniLogo from '#/assets/houdini-logo.svg'

import type { DerivedHoudiniPaths, HoudiniInstallScan } from '#/lib/houdini-install.ts'

/**
 * The Houdini installation, picked once instead of typed twice.
 *
 * The twin of the Daz installation section, and for the same reason: SideFX
 * registers every install under `HKLM\SOFTWARE\Side Effects Software\Houdini`,
 * so the studio can read where Houdini is rather than ask. Activating one card
 * fills the install folder AND the `houdini<major>.<minor>` preferences folder
 * that belongs to it.
 *
 * **Pairing the two is the load-bearing part**, not a nicety: hython runs with
 * the prefs folder as `HOUDINI_USER_PREF_DIR`, and pointed at another version's
 * it loads the wrong DazToHue otls — or none — so every node comes back as an
 * unknown type. Picking them apart by hand is exactly how that goes wrong.
 *
 * `extraHoudiniDocsFolders` is left alone: it exists so an OLDER Houdini can
 * keep an OLDER DTH release, which is a decision about the other versions.
 */
export function HoudiniInstallSection({
  scan,
  loading,
  activeKey,
  derived,
  busyKey,
  recommendedKey,
  onRescan,
  onActivate,
  onSetManually,
}: {
  scan: HoudiniInstallScan | null
  loading: boolean
  /** The activated install's four-part version, '' when paths are the user's. */
  activeKey: string
  derived: DerivedHoudiniPaths | null
  busyKey: string
  recommendedKey: string
  onRescan: () => void
  onActivate: (version: string) => void
  onSetManually: () => void
}) {
  const installs = scan?.installs ?? []
  const activeMissing = activeKey !== '' && !installs.some((i) => i.version === activeKey)
  /** Prefs folders no installed version claims — a leftover worth naming, since
   *  it is usually the trace of an uninstalled Houdini. */
  const orphanDocs = (scan?.docsFolders ?? []).filter(
    (docs) => !installs.some((install) => install.docsFolder === docs),
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1 font-semibold">
          Houdini installation
          <InfoPopup label="Houdini installation — more information">
            SideFX registers every installed Houdini, so the studio reads where they are instead
            of asking. Activating one fills the installation folder and the matching{' '}
            <span className="font-mono">houdini&lt;major&gt;.&lt;minor&gt;</span> documents
            folder together — which matters: hython runs with that folder as its preferences
            directory, and pointed at another version&apos;s it loads the wrong DazToHue assets,
            or none. Extra Houdini folders below stay yours to manage, so an older Houdini can
            keep an older DTH release.
          </InfoPopup>
        </h2>
        <Button variant="ghost" size="sm" disabled={loading} onClick={onRescan}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Rescan
        </Button>
      </div>

      {!loading && installs.length > 0 && activeKey === '' && (
        <p className="text-sm text-muted-foreground">
          Pick the Houdini your paths should come from — they are filled in and saved the moment
          you do.
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Looking for installed Houdini versions…
        </p>
      ) : installs.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No installed Houdini found on this machine — set the folders below yourself. (Houdini
          is optional; everything on the Daz side works without it.)
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {installs.map((install) => (
            <InstallCard
              key={install.version}
              logo={houdiniLogo}
              title={install.name}
              path={displayPath(install.path)}
              active={install.version === activeKey}
              exists={install.exists}
              busy={busyKey === install.version}
              recommended={activeKey === '' && install.version === recommendedKey}
              disabled={busyKey !== ''}
              // Offered, not refused: activating still sets the install folder,
              // and the empty documents folder below says what is missing. The
              // user may simply not have started this Houdini yet — its prefs
              // folder does not exist until first launch.
              warning={
                install.docsFolder === '' ? (
                  <>
                    no <span className="font-mono">houdini{install.release}</span> documents
                    folder found — start this Houdini once, or set it below
                  </>
                ) : undefined
              }
              onActivate={() => onActivate(install.version)}
            />
          ))}
        </div>
      )}

      {activeMissing && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            The Houdini these paths came from isn&apos;t on this machine any more. They still
            point at what it had — activate one above, or set them manually.
          </span>
        </p>
      )}

      {activeKey !== '' && derived && (
        <div className="rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Paths from this installation</p>
            <Button variant="ghost" size="sm" onClick={onSetManually}>
              <Pencil /> Set the paths manually
            </Button>
          </div>
          <dl className="space-y-1.5 text-xs">
            <DerivedPath label="Houdini installation" value={derived.houdiniInstallFolder} />
            <DerivedPath label="Houdini documents" value={derived.houdiniDocsFolder} />
          </dl>
        </div>
      )}

      {orphanDocs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Also found, with no installed Houdini to match:{' '}
          {orphanDocs.map((docs) => displayPath(docs)).join(', ')} — usually left behind by an
          uninstalled version. Add one below if an older DTH release still lives there.
        </p>
      )}
    </div>
  )
}

/** One read-only derived path, or a named reason it is empty. */
function DerivedPath({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <dt className="w-44 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">
        {value ? (
          <PathCode path={displayPath(value)} />
        ) : (
          <span className="text-amber-500">
            not found — set it below, or start this Houdini once to create it
          </span>
        )}
      </dd>
    </div>
  )
}
