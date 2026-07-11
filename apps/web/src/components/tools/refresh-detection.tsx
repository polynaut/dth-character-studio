import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { poseAssetCsvEra } from '@dth/rom'

import { InfoPopup } from '@dth/ui'

import type { AssetVersionReport } from '#/lib/rom/api.ts'

/** One row of the local-vs-app version table. `state` drives the colour + icon:
 *  matched (green/check), differing (red value + yellow warning), or not comparable
 *  (muted "—" — no DAZ library, or no DTH release to compare against). */
type VersionRowState = 'match' | 'mismatch' | 'unchecked'
interface VersionRow {
  label: string
  local: string
  app: string
  state: VersionRowState
  /** Popup copy explaining which generated files this version governs. */
  info: ReactNode
}

/** The version-detection block: a compact local-vs-app table over the three version
 *  dimensions (DTH release, character schema, script runtime). A row is green +
 *  checkmark when the local value(s) match what the app generates, red + a yellow
 *  warning when they differ, or muted when it can't be checked. "Local" usually holds
 *  one value per row, but lists several when characters sit at different versions. */
export function RefreshDetection({ report }: { report: AssetVersionReport }) {
  const { app, characters, hasDazLibrary, hasDthRelease } = report
  const hasChars = characters.length > 0

  // Distinct local values per dimension — normally one each; more than one only when
  // characters were generated/saved at differing versions (some not yet refreshed).
  const schemaLocals = [...new Set(characters.map((c) => c.schemaVersion))].sort((a, b) => a - b)
  const runtimeLocals = [...new Set(characters.map((c) => c.runtimeVersion))].sort(
    (a, b) => (a ?? -1) - (b ?? -1),
  )
  const releaseLocals = [...new Set(characters.map((c) => c.generatedDthVersion))].sort((a, b) =>
    a.localeCompare(b),
  )

  // A row matches only when there's exactly one local value and it equals the app's.
  const matches = (locals: ReadonlyArray<unknown>, appValue: unknown) =>
    locals.length === 1 && locals[0] === appValue
  const schemaState: VersionRowState = !hasChars
    ? 'unchecked'
    : matches(schemaLocals, app.schema)
      ? 'match'
      : 'mismatch'
  const runtimeState: VersionRowState =
    !hasDazLibrary || !hasChars
      ? 'unchecked'
      : matches(runtimeLocals, app.runtime)
        ? 'match'
        : 'mismatch'
  // The CSV is tied to the DTH *era* (a breaking-release boundary), not the exact
  // release — two releases in the same era are interchangeable. Compare eras, and
  // (unlike runtime) this needs no DAZ library: the CSV + its provenance are local.
  const appEra = poseAssetCsvEra(app.dthRelease)
  const localEras = [...new Set(characters.map((c) => poseAssetCsvEra(c.generatedDthVersion)))]
  const releaseState: VersionRowState =
    !hasDthRelease || !hasChars
      ? 'unchecked'
      : localEras.length === 1 && localEras[0] === appEra
        ? 'match'
        : 'mismatch'

  const rows: Array<VersionRow> = [
    {
      label: 'DTH Version',
      local:
        releaseState === 'unchecked'
          ? '—'
          : releaseLocals.map((r) => (r === '' ? 'not generated' : `v${r}`)).join(', '),
      app: hasDthRelease ? `v${app.dthRelease}` : 'none',
      state: releaseState,
      info: (
        <>
          Governs the Houdini <strong>PoseAsset CSV</strong> (<em>…_pose_asset.csv</em>) — the only
          artifact tied to the DTH release. It's pinned to the release's CSV <em>era</em>, so a
          non-breaking release (e.g. 2.4.3 → 2.4.4) stays current; only a release that changes the
          CSV format marks it out of date. Out of date → the CSV is regenerated.
        </>
      ),
    },
    {
      label: 'Character Schema Version',
      local: schemaState === 'unchecked' ? '—' : schemaLocals.map((n) => `v${n}`).join(', '),
      app: `v${app.schema}`,
      state: schemaState,
      info: (
        <>
          Governs the <strong>character definition</strong> (its <em>.json</em>). A newer version
          means the stored shape changed: the definition is migrated and re-saved — and, since a
          migration can change generated output, its Daz scripts and PoseAsset CSV are regenerated
          too.
        </>
      ),
    },
    {
      label: 'Script Runtime Version',
      local:
        runtimeState === 'unchecked'
          ? '—'
          : runtimeLocals.map((n) => (n === null ? 'not generated' : `v${n}`)).join(', '),
      app: `v${app.runtime}`,
      state: runtimeState,
      info: (
        <>
          Governs the generated <strong>Daz scripts</strong> (the ROM / Export <em>.dsa</em>) and the
          shared <strong>DTH runtime files</strong>. A newer version means the runtime's call API
          changed, so the runtime files are reinstalled and every character's scripts regenerated.
        </>
      ),
    },
  ]

  const valueClass = (state: VersionRowState) =>
    state === 'match'
      ? 'text-emerald-600 dark:text-emerald-500'
      : state === 'mismatch'
        ? 'text-red-600 dark:text-red-500'
        : 'text-muted-foreground'

  return (
    <div className="space-y-3">
      {report.total === 0 ? (
        <p className="text-sm text-muted-foreground">No characters to check yet.</p>
      ) : report.refreshNeeded ? (
        <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <strong>Refresh needed</strong> — {report.staleCount} of {report.total} character
            {report.total === 1 ? '' : 's'} are out of date. Refresh migrates and regenerates them.
          </span>
        </div>
      ) : null}

      <table className="w-full max-w-md overflow-hidden rounded-lg border text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-2 font-medium"></th>
            <th className="px-3 py-2 font-medium">Local</th>
            <th className="px-3 py-2 font-medium">App</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.label}>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-0.5">
                  {row.label}
                  <InfoPopup label={`${row.label} — what it affects`}>{row.info}</InfoPopup>
                </span>
              </th>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center gap-1.5 font-medium ${valueClass(row.state)}`}>
                  {row.state === 'match' && <CircleCheck className="size-4 shrink-0" />}
                  {row.state === 'mismatch' && (
                    <TriangleAlert className="size-4 shrink-0 text-amber-500" />
                  )}
                  {row.local}
                </span>
              </td>
              <td className="px-3 py-2">
                {/* App is the reference value — always neutral; only Local is coloured. */}
                <span className="font-medium text-foreground">{row.app}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!report.hasDazLibrary ? (
        <p className="text-xs text-muted-foreground">
          No <strong className="text-foreground">My DAZ 3D Library</strong> is set, so generated-script
          versions (runtime / DTH release) can't be checked — set it in{' '}
          <Link to="/settings" className="font-medium text-primary underline underline-offset-2">
            Settings
          </Link>{' '}
          to refresh scripts too. Definition migrations don't need it.
        </p>
      ) : (
        !report.hasDthRelease && (
          <p className="text-xs text-muted-foreground">
            No DTH release is configured, so the release version can't be checked — set one in{' '}
            <Link to="/settings" className="font-medium text-primary underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
        )
      )}
    </div>
  )
}
