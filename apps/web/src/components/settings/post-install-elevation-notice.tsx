import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@dth/ui'
import { isElevatedSession, relaunchDeelevated } from '#/lib/rom/api.ts'

import type { InstallReport } from '#/lib/rom/api.ts'

/**
 * Shown after a SUCCESSFUL real plugin install while the studio runs elevated
 * (issue #342): elevating is exactly what a Program Files install asked for,
 * but Windows UIPI then silently blocks drag-and-drop from a normal-elevation
 * Explorer into the elevated window — no event, no error, drops just do
 * nothing. The moment the install is done, elevation has served its purpose,
 * so offer the way back: a one-click de-elevated relaunch (Explorer hands the
 * launch off at the shell's integrity level; the current project reopens via
 * its `.dcsp` association). Renders nothing when not elevated, on a dry run,
 * or on a failed install (the error hint next to it owns that case).
 */
export function PostInstallElevationNotice({ report }: { report: InstallReport | null }) {
  const [elevated, setElevated] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void isElevatedSession().then(setElevated)
  }, [])
  const succeeded = !!report && !report.dryRun && !report.steps.some((s) => s.status === 'error')
  if (!elevated || !succeeded) return null
  async function restart() {
    setBusy(true)
    try {
      await relaunchDeelevated()
      // The native side exits this instance — nothing to settle here.
    } catch (err) {
      toast.error(
        `Couldn't restart by itself — close the studio and start it normally. (${err instanceof Error ? err.message : String(err)})`,
      )
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
      <span className="flex-1">
        Installed — but the studio is running as administrator, and Windows silently blocks
        drag-and-drop into an elevated window. Restart normally to get it back.
      </span>
      <Button size="sm" disabled={busy} onClick={() => void restart()}>
        <RefreshCw /> {busy ? 'Restarting…' : 'Restart normally'}
      </Button>
    </div>
  )
}
