import { Link } from '@tanstack/react-router'

import type { RunnerGate } from '#/lib/rom/api.ts'

/**
 * The Runner-plugin gate notice: batches (DTH exports, the Tools genesis-index
 * build) run through the Runner plugin in Daz Studio, so a missing or outdated
 * install blocks the handoff — this box says why and deep-links to Settings →
 * General (where the Runner section lives). Shared by the DTH Export panel
 * and Tools → Build Genesis Index (`fetchExportRunnerGate` produces the gate).
 */
export function RunnerGateNotice({
  gate,
  subject = 'Exports run',
}: {
  gate: Extract<RunnerGate, { blocked: true }>
  /** Subject + verb opening the sentence — "Exports run" (default) or e.g.
   *  "The index build runs". */
  subject?: string
}) {
  return (
    <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
      <p>
        {gate.reason === 'no-install-folder'
          ? `${subject} through the Runner plugin in Daz Studio, but no Daz Studio install folder is configured yet.`
          : gate.reason === 'not-installed'
            ? `${subject} through the Runner plugin, which is not installed in this Daz Studio yet.`
            : `A Runner plugin update is pending — Daz Studio has ${gate.installedVersion || 'an unknown version'} installed, this app bundles ${gate.bundledVersion || 'a newer one'}.`}
      </p>
      <p>
        <Link
          to="/settings"
          search={{ tab: 'general' }}
          className="font-medium text-primary underline underline-offset-2"
        >
          {gate.reason === 'update-pending' ? 'Update it in Settings' : 'Set it up in Settings'}
        </Link>{' '}
        first, then come back.
      </p>
    </div>
  )
}
