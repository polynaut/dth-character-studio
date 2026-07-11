import { CircleCheck } from 'lucide-react'

import type { DazToHueScriptsStatus } from '#/lib/rom/api.ts'

/** First 7 chars of a commit SHA — the familiar short form. */
function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/**
 * Installed-vs-latest line for the DazToHue-Scripts install — phrased + sized to
 * match the DTH Exporter Plugin status in Settings: an emerald, check-marked
 * "Already installed (X) — up to date." when the local commit matches GitHub's HEAD,
 * an "Installed: X → updating to Y." line when a newer commit exists, and muted text
 * otherwise. Every line is `text-sm`. Hidden until the first check resolves.
 */
export function ScriptsVersionStatus({ status }: { status: DazToHueScriptsStatus | null }) {
  if (!status) return null
  switch (status.state) {
    case 'uptodate':
      return (
        <p className="flex items-center gap-1.5 text-sm text-emerald-500">
          <CircleCheck className="size-4 shrink-0" />
          Already installed ({shortSha(status.installed ?? '')}) — up to date.
        </p>
      )
    case 'outdated':
      return (
        <p className="text-sm text-muted-foreground">
          Installed: <strong className="text-foreground">{shortSha(status.installed ?? '')}</strong> →
          updating to <strong className="text-foreground">{shortSha(status.latest ?? '')}</strong>.
        </p>
      )
    case 'unknown':
      return (
        <p className="text-sm text-muted-foreground">
          Installed: <strong className="text-foreground">{shortSha(status.installed ?? '')}</strong> —
          couldn't check for the latest version.
        </p>
      )
    case 'unversioned':
      return (
        <p className="text-sm text-muted-foreground">
          Installed, but its version isn't tracked yet — reinstall to record it.
        </p>
      )
    default:
      return <p className="text-sm text-muted-foreground">Not installed yet.</p>
  }
}
