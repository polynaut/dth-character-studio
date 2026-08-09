import { useEffect, useState } from 'react'
import { CircleAlert, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react'

import { Button, InfoPopup, useModifierHeld } from '@dth/ui'
import { GuideLink } from '#/components/guide-link.tsx'
import { CHARACTER_SCHEMA_VERSION } from '@dth/rom'
import { detectAssetVersions, refreshAllAssets } from '#/lib/rom/api.ts'
import { RefreshDetection } from '#/components/tools/refresh-detection.tsx'
import { toast } from 'sonner'

import type { AssetVersionReport, RefreshSummary } from '#/lib/rom/api.ts'

/**
 * "Refresh assets" tab — re-generate the Daz scripts + PoseAsset CSVs (e.g. after a
 * studio update or a DTH-release switch). Scope is every known (recent) project
 * plus the active one, whatever window the button is pressed in (`sweepTargets`).
 * Shows a compact local-vs-app version table (DTH release, character schema, script
 * runtime), then offers the one-click Refresh with a per-run summary. Refresh
 * migrates stale definitions (re-stamping the schema version) and regenerates them.
 *
 * A refresh can also surface definitions saved by a NEWER build than this one (a
 * dev ran a schema-bump branch, then went back) — those it can't read. It offers a
 * separate, explicit "Reset to v{current}" that force-downgrades them, dropping the
 * newer fields.
 */
export function RefreshAssetsTab() {
  const [report, setReport] = useState<AssetVersionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [summary, setSummary] = useState<RefreshSummary | null>(null)
  const working = refreshing || resetting
  // Power-user: holding Ctrl turns Refresh into "Refresh + rebuild avatars" —
  // scene-sourced avatar masters are re-derived from their scenes' pristine tips,
  // so masters written by an older upscale pipeline pick up the current one
  // (mirrors the Ctrl force-save affordance in the character header).
  const ctrlHeld = useModifierHeld('Control')

  async function reload() {
    setLoading(true)
    try {
      setReport(await detectAssetVersions())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void reload()
  }, [])

  function reportSummary(result: RefreshSummary, rebuiltAvatars: boolean) {
    if (result.runtime && !result.runtime.ok) {
      toast.error(`Runtime refresh failed: ${result.runtime.detail ?? ''}`)
      return
    }
    // Nothing regenerated, but newer-build files are waiting — point at the reset
    // panel rather than the misleading "no characters" line.
    if (result.total === 0 && result.tooNew.length > 0) {
      toast.warning(
        `${result.tooNew.length} character file${result.tooNew.length === 1 ? '' : 's'} saved by a newer build — reset ${result.tooNew.length === 1 ? 'it' : 'them'} below to open here`,
      )
      return
    }
    if (result.total === 0) {
      toast(
        result.runtime?.ok
          ? 'DTH runtime refreshed — no characters to regenerate'
          : 'No characters to refresh yet',
      )
      return
    }
    if (result.failed > 0) {
      toast.error(`Re-generated ${result.regenerated} of ${result.total} — ${result.failed} failed`)
      return
    }
    // Spell out exactly what was (re)generated, per artifact, in the toast.
    const n = (count: number, one: string, many = `${one}s`) =>
      `${count} ${count === 1 ? one : many}`
    const lines: Array<string> = []
    if (result.counts.reset > 0)
      lines.push(
        `Reset ${n(result.counts.reset, 'newer file')} to v${CHARACTER_SCHEMA_VERSION} (dropped their newer fields)`,
      )
    if (result.counts.migrated > 0)
      lines.push(`Migrated ${n(result.counts.migrated, 'character definition')}`)
    // Named explicitly because this one MOVED the user's files — a folder full
    // of gigabytes changing place is not something a run should do quietly.
    if (result.counts.exports > 0)
      lines.push(
        `Moved the export folder of ${n(result.counts.exports, 'character')} into its Houdini folder`,
      )
    if (result.counts.scripts > 0)
      lines.push(`Re-generated Daz scripts for ${n(result.counts.scripts, 'character')}`)
    if (result.counts.csv > 0) lines.push(`Re-generated ${n(result.counts.csv, 'PoseAsset CSV')}`)
    if (result.counts.avatars > 0)
      lines.push(
        rebuiltAvatars
          ? `Rebuilt ${n(result.counts.avatars, 'avatar master')} from their stored originals`
          : `Upscaled ${n(result.counts.avatars, 'avatar')} to 768px`,
      )
    if (result.runtime?.ok) lines.push('Re-installed the DTH runtime files')
    if (result.houdiniEnv && result.houdiniEnv.updated > 0)
      lines.push(
        `Wired DAZ3D_LIB into ${n(result.houdiniEnv.updated, 'houdini.env file')} (applies on the next Houdini start)`,
      )
    for (const error of result.houdiniEnv?.errors ?? [])
      lines.push(`houdini.env wiring failed: ${error}`)
    toast.success(`Refreshed ${n(result.regenerated, 'character')}`, {
      description: lines.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : undefined,
    })
  }

  async function run(opts: { resetTooNew?: boolean; rebuildAvatars?: boolean } = {}) {
    const setBusy = opts.resetTooNew ? setResetting : setRefreshing
    setBusy(true)
    setSummary(null)
    try {
      const result = await refreshAllAssets(opts)
      setSummary(result)
      reportSummary(result, opts.rebuildAvatars === true)
      await reload() // re-detect so the version table reflects the regeneration
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const failures = summary?.results.filter((r) => !r.ok) ?? []
  const warnings = summary?.results.filter((r) => r.ok && r.detail) ?? []
  const tooNew = summary?.tooNew ?? []
  // Pulse the action while there's pending work (but not mid-refresh — the spinner
  // carries that state). `report` is null until the first detection finishes.
  const needsRefresh = (report?.refreshNeeded ?? false) && !working

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="flex w-fit items-center gap-1 font-semibold">
          Refresh assets
          <InfoPopup label="Refresh assets — more information">
            Re-generates every project's Daz scripts and PoseAsset CSVs to the current version. It
            only ever writes a character definition to MIGRATE it — bringing an old one up to the
            current schema, or repointing it after the studio moved a folder it owns.{' '}
            <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/tools.html#tab-3--refresh-assets">
              Open guide
            </GuideLink>
          </InfoPopup>
        </h2>
        {/* The action sits up top so it's visible at a glance, above the table; it's
            enlarged and pulses a light orange while a refresh is pending. */}
        <Button
          size="lg"
          variant="outline"
          onClick={() => void run({ rebuildAvatars: ctrlHeld })}
          disabled={working}
          title={
            ctrlHeld
              ? 'Also re-derives avatar masters from their stored originals (Ctrl)'
              : undefined
          }
          // my-3 on top of the container's space-y-3: the enlarged action gets
          // extra air above and below so it doesn't crowd the title/table.
          className={`my-3 h-11 px-6 text-base ${needsRefresh ? 'refresh-pulse' : ''}`}
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : ctrlHeld ? 'Refresh + rebuild avatars' : 'Refresh assets'}
        </Button>

        {/* Definitions saved by a NEWER build than this one — the one recoverable
            read problem. Kept distinct (amber, not a red failure) because it IS
            fixable, and the fix is a deliberate, lossy downgrade. */}
        {tooNew.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="flex items-start gap-2 font-medium text-amber-600 dark:text-amber-500">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {tooNew.length} character file{tooNew.length === 1 ? ' was' : 's were'} saved by a
                newer build — this build reads up to schema v{CHARACTER_SCHEMA_VERSION} and can't
                open {tooNew.length === 1 ? 'it' : 'them'}.
              </span>
            </p>
            <ul className="ml-6 list-disc space-y-0.5 text-muted-foreground">
              {tooNew.map((t) => (
                <li key={t.path}>
                  <span className="font-medium text-foreground">{t.character}</span> · {t.project}{' '}
                  <span className="text-xs">(schema v{t.storedVersion})</span>
                </li>
              ))}
            </ul>
            <p className="ml-6 text-muted-foreground">
              Resetting re-saves {tooNew.length === 1 ? 'it' : 'them'} at v
              {CHARACTER_SCHEMA_VERSION} and <strong>drops any fields the newer build added</strong>{' '}
              — only do this if you don't need that newer data (e.g. after running an in-development
              build).
            </p>
            <Button
              variant="outline"
              size="sm"
              className="ml-6"
              disabled={working}
              onClick={() => void run({ resetTooNew: true })}
            >
              <RotateCcw className={resetting ? 'animate-spin' : ''} />
              {resetting ? 'Resetting…' : `Reset to v${CHARACTER_SCHEMA_VERSION}`}
            </Button>
          </div>
        )}

        {/* The success summary is a toast now; only per-character problems stay on
            the page (they're detailed and worth keeping visible). */}
        {(failures.length > 0 || warnings.length > 0) && (
          <div className="space-y-2 text-sm">
            {failures.map((r, i) => (
              <p key={`f${i}`} className="flex items-start gap-2 text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">
                    {r.project} · {r.character}
                  </span>
                  {r.detail && <span className="text-muted-foreground"> — {r.detail}</span>}
                </span>
              </p>
            ))}
            {warnings.map((r, i) => (
              <p key={`w${i}`} className="flex items-start gap-2 text-muted-foreground">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">
                    {r.project} · {r.character}
                  </span>{' '}
                  — {r.detail}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="border-t pt-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Checking local versions…</p>
        ) : report ? (
          <RefreshDetection report={report} />
        ) : null}
      </div>
    </div>
  )
}
