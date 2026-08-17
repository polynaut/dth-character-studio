import { AlertTriangle, Loader2, RefreshCw, Pencil } from 'lucide-react'

import { Button, InfoPopup, Switch } from '@dth/ui'
import { InstallCard } from '#/components/settings/install-card.tsx'
import { PathCode } from '#/components/path-code.tsx'
import { displayPath } from '#/lib/path.ts'
import { exportOnlyCandidateKeys } from '#/lib/daz-install.ts'
import dazLogo from '#/assets/daz-logo.png'

import type { DazInstallScan, DerivedDazPaths } from '#/lib/daz-install.ts'

/**
 * The Daz installation, picked once instead of typed three times.
 *
 * Everything the studio needs about Daz — the content library, the Studio
 * install folder, the DIM manifest database — is already recorded by the DAZ
 * Install Manager. This section reads it (`lib/daz-install.ts`), shows each
 * installed Daz Studio as a card, and DERIVES the three paths from whichever
 * one the user activates. Activating writes them straight to disk: the paths
 * are a consequence of the choice, so there is nothing left to "save".
 *
 * The read-only display is the point — a derived value you can edit is a value
 * that silently disagrees with what it was derived from. That rule cuts both
 * ways, so the Settings route RE-DERIVES on every scan: change DIM's content
 * library afterwards and the stored paths follow, without anyone having to know
 * that re-clicking the active card would have done it. The escape hatch is
 * explicit instead: **Set the paths manually** deactivates the installation and
 * hands the three fields back, for the machine DIM doesn't describe (a portable
 * install, a library on a share, no DIM at all).
 */
export function DazInstallSection({
  scan,
  loading,
  activeKey,
  derived,
  busyKey,
  recommendedKey,
  onRescan,
  onActivate,
  onSetManually,
  exportOnlyKey,
  onExportOnly,
}: {
  scan: DazInstallScan | null
  loading: boolean
  /** The activated installation's key, '' when the paths are the user's own. */
  activeKey: string
  /** The three derived paths as STORED — the read-only list. Kept in step with
   *  what DIM currently says by the Settings route's re-derive-on-scan, so this
   *  and the card above it can't drift apart. */
  derived: DerivedDazPaths | null
  /** The card mid-activation, '' when idle. */
  busyKey: string
  /** The one to suggest while nothing is active — newest Studio present. */
  recommendedKey: string
  onRescan: () => void
  onActivate: (key: string) => void
  onSetManually: () => void
  /** The installation currently flagged **Export only**, '' when none is. */
  exportOnlyKey: string
  /** Flip the flag. `key` when turning one on, '' when turning it off — the
   *  caller stores ONE key, which is what makes the switches exclusive without
   *  any card having to know about the others. */
  onExportOnly: (key: string) => void
}) {
  const apps = scan?.apps ?? []
  // A stored installation this machine no longer has. Never silently swapped
  // for another: the paths on disk still point at the old one, and only the
  // user can say whether that is a reinstall or the wrong machine.
  const activeMissing = activeKey !== '' && !apps.some((app) => app.key === activeKey)

  // Which cards may carry the Export-only switch — the older installs that can
  // still run a batch, and only while the newest one is the active one. The rule
  // is pure and lives with the install model (`lib/daz-install.ts`), so it can
  // be tested without a Settings page around it.
  const exportOnlyCandidates = exportOnlyCandidateKeys(apps, activeKey)
  // A card that CARRIES the flag always keeps its switch, even once it stops
  // being a candidate (its folder went away, or the user activated an older
  // install so the whole arrangement no longer applies). Offering the switch and
  // taking it back are not the same decision: the stored key still redirects
  // every export, so withdrawing the control would leave the flag armed with
  // nothing on screen to disarm it.
  //
  // The ACTIVE card is the one exception, and it is not a withdrawal: an
  // installation that already runs everything cannot ALSO run "only the
  // exports", so a switch there offers a distinction that no longer exists —
  // and reads as if the active install were somehow demoted. Activating a
  // flagged install clears the flag in the same save (the Settings route), so
  // this hides nothing that is still armed; and even a settings.json that says
  // otherwise resolves to that same folder anyway (`exportInstallFolder`).
  const showsExportOnly = (key: string) =>
    key !== activeKey && (exportOnlyCandidates.includes(key) || exportOnlyKey === key)
  // …and the flag can outlive the card entirely, once DIM stops listing the
  // install at all. Same treatment as `activeMissing`: say so and let the user
  // decide, rather than silently re-pointing their exports.
  const exportMissing = exportOnlyKey !== '' && !apps.some((app) => app.key === exportOnlyKey)

  // A plain div, not a <section>: the Settings route wraps this in the card
  // <section> every other block on that page uses, and nesting two would make
  // "the Daz installation card" ambiguous to anything selecting by section.
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* An h2 like every other card on this page — the section headings are
            what the page (and the guide's screenshots) navigate by. */}
        <h2 className="flex items-center gap-1 font-semibold">
          Daz installation
          <InfoPopup label="Daz installation — more information">
            The DAZ Install Manager already knows where your Daz Studio, your content library
            and its product database live — it writes them to{' '}
            <span className="font-mono">%APPDATA%\DAZ 3D</span>. Activating an installation here
            reads those and fills the three paths below, so there is nothing to type and nothing
            to keep in step. They stay read-only while an installation is active; use{' '}
            <strong>Set the paths manually</strong> for a machine DIM doesn&apos;t describe.
          </InfoPopup>
        </h2>
        <Button variant="ghost" size="sm" disabled={loading} onClick={onRescan}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Rescan
        </Button>
      </div>

      {/* The call to action, because a card that only CHANGES on hover reads as
          a status display — measured the hard way: the section shipped, the
          maintainer looked straight at two correct cards and asked why his
          paths hadn't been filled in. Nothing had told him to click. */}
      {!loading && apps.length > 0 && activeKey === '' && (
        <p className="text-sm text-muted-foreground">
          Pick the installation your Daz paths should come from — they are filled in and saved
          the moment you do.
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading the DAZ Install Manager…
        </p>
      ) : apps.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {scan?.dimFound
            ? 'The DAZ Install Manager is here, but lists no installed Daz Studio. Set the paths below yourself.'
            : 'No DAZ Install Manager settings found on this machine — set the paths below yourself.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {apps.map((app) => (
            <InstallCard
              key={app.key}
              logo={dazLogo}
              title={app.name}
              path={displayPath(app.path)}
              active={app.key === activeKey}
              exists={app.exists}
              busy={busyKey === app.key}
              recommended={activeKey === '' && app.key === recommendedKey}
              disabled={busyKey !== ''}
              tone="daz"
              onActivate={() => onActivate(app.key)}
              footer={
                showsExportOnly(app.key) ? (
                  <span className="mt-1.5 flex items-center gap-2 rounded-md border border-dashed p-2">
                    <Switch
                      checked={exportOnlyKey === app.key}
                      onCheckedChange={(on) => onExportOnly(on ? app.key : '')}
                      disabled={busyKey !== ''}
                      aria-label={`Run export batches in ${app.name}`}
                    />
                    {/* The reasoning is one click away, not four lines under
                        every older card: the switch is a one-line decision and
                        the paragraph explaining WHY is what makes the section
                        long enough to skim past. */}
                    <span className="flex min-w-0 items-center gap-1 text-xs font-medium">
                      Export only
                      <InfoPopup label="Export only — more information">
                        <div className="space-y-2">
                          <p>
                            DTH Export runs its batch in <strong>{app.name}</strong>; everything
                            else — opening scenes, running scripts, installing content — keeps
                            using the active installation.
                          </p>
                          <p>
                            For when the Runner plugin has no build for the newer Studio yet:
                            the export batch is the one thing that needs that plugin, so this
                            lets the rest of the app move on without it.
                          </p>
                          <p>
                            Only one installation can carry it, and the Runner is installed and
                            checked wherever it points.
                          </p>
                        </div>
                      </InfoPopup>
                    </span>
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {activeMissing && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            The installation these paths came from isn&apos;t on this machine any more. They are
            still set to what it had — activate one above, or set them manually.
          </span>
        </p>
      )}

      {/* The flag outliving its installation is the one state the switches
          cannot express, because the card it belonged to is gone. Left alone it
          is silent and total: every export would launch a folder that isn't
          there. So it gets its own row, and its own way out. */}
      {exportMissing && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-500">
          <p className="flex min-w-0 flex-1 items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Export batches are still pointed at an installation this machine no longer lists,
              so they have nowhere to start. Send them back to the active installation.
            </span>
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busyKey !== ''}
            onClick={() => onExportOnly('')}
          >
            Use the active installation
          </Button>
        </div>
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
            <DerivedPath label="My DAZ 3D Library" value={derived.dazLibraryFolder} />
            <DerivedPath label="Daz Studio install folder" value={derived.dazInstallFolder} />
            <DerivedPath label="DIM product database" value={derived.dimManifestsFolder} />
            {/* DIM's DOWNLOAD folder is deliberately not listed. It is a fine
                asset SOURCE, but the studio never applies it — that list is the
                user's own curation (Tools → Daz assets) — and a path this card
                shows but does not use reads as one it does. This card is "the
                paths that come from this installation"; nothing else belongs. */}
          </dl>
        </div>
      )}
    </div>
  )
}

/** One read-only derived path — or a named reason it is empty. */
function DerivedPath({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <dt className="w-44 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">
        {value ? (
          <PathCode path={displayPath(value)} />
        ) : (
          <span className="text-amber-500">the DAZ Install Manager has no value for this</span>
        )}
      </dd>
    </div>
  )
}
