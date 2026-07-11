import { useEffect, useState } from 'react'
import { CircleAlert, RefreshCw } from 'lucide-react'

import { Button, InfoPopup } from '@dth/ui'
import { detectAssetVersions, refreshAllAssets } from '#/lib/rom/api.ts'
import { RefreshDetection } from '#/components/tools/refresh-detection.tsx'
import { toast } from 'sonner'

import type { AssetVersionReport, RefreshSummary } from '#/lib/rom/api.ts'

/**
 * "Refresh assets" tab — re-generate the Daz scripts + PoseAsset CSVs (e.g. after a
 * studio update or a DTH-release switch). Scope follows the window: the current
 * project in a project window, every known (recent) project from the Home window.
 * Shows a compact local-vs-app version table (DTH release, character schema, script
 * runtime), then offers the one-click Refresh with a per-run summary. Refresh
 * migrates stale definitions (re-stamping the schema version) and regenerates them.
 */
export function RefreshAssetsTab() {
  const [report, setReport] = useState<AssetVersionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [summary, setSummary] = useState<RefreshSummary | null>(null)

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

  async function onRefresh() {
    setRefreshing(true)
    setSummary(null)
    try {
      const result = await refreshAllAssets()
      setSummary(result)
      if (result.runtime && !result.runtime.ok) {
        toast.error(`Runtime refresh failed: ${result.runtime.detail ?? ''}`)
      } else if (result.total === 0) {
        toast(
          result.runtime?.ok
            ? 'DTH runtime refreshed — no characters to regenerate'
            : 'No characters to refresh yet',
        )
      } else if (result.failed > 0) {
        toast.error(`Re-generated ${result.regenerated} of ${result.total} — ${result.failed} failed`)
      } else {
        // Spell out exactly what was (re)generated, per artifact, in the toast.
        const n = (count: number, one: string, many = `${one}s`) =>
          `${count} ${count === 1 ? one : many}`
        const lines: Array<string> = []
        if (result.counts.migrated > 0)
          lines.push(`Migrated ${n(result.counts.migrated, 'character definition')}`)
        if (result.counts.scripts > 0)
          lines.push(`Re-generated Daz scripts for ${n(result.counts.scripts, 'character')}`)
        if (result.counts.csv > 0)
          lines.push(`Re-generated ${n(result.counts.csv, 'PoseAsset CSV')}`)
        if (result.runtime?.ok) lines.push('Re-installed the DTH runtime files')
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
      await reload() // re-detect so the version table reflects the regeneration
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const failures = summary?.results.filter((r) => !r.ok) ?? []
  const warnings = summary?.results.filter((r) => r.ok && r.detail) ?? []
  // Pulse the action while there's pending work (but not mid-refresh — the spinner
  // carries that state). `report` is null until the first detection finishes.
  const needsRefresh = (report?.refreshNeeded ?? false) && !refreshing

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="flex w-fit items-center gap-1 font-semibold">
          Refresh assets
          <InfoPopup label="Refresh assets — more information">
            Re-generates the Daz scripts and PoseAsset CSVs so all generated files match the current
            version — run this after updating the studio or switching DTH release. It always covers
            every known (recent) project, no matter which window it runs from. Character definitions
            aren't changed.
          </InfoPopup>
        </h2>
        {/* The action sits up top so it's visible at a glance, above the table; it's
            enlarged and pulses a light orange while a refresh is pending. */}
        <Button
          size="lg"
          variant="outline"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          className={`h-11 px-6 text-base ${needsRefresh ? 'refresh-pulse' : ''}`}
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh assets'}
        </Button>
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
