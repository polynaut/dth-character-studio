import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button, InfoPopup, cn } from '@dth/ui'
import { ensureNetworkDrives, fetchKnownDrives, forgetNetworkDrive, uncForPath } from '#/lib/rom/api.ts'

/**
 * Lists the network drives the app has remembered (X: → \\host\share) with their
 * current mapped status, a "Forget" per drive, and a manual re-map. Drives are
 * remembered automatically as paths are picked and re-mapped on startup. Renders
 * nothing when there are no remembered drives.
 */
export function NetworkDrivesSection() {
  const [drives, setDrives] = useState<Array<{ drive: string; unc: string; mapped: boolean }>>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const known = await fetchKnownDrives()
    const withStatus = await Promise.all(
      known.map(async (d) => ({ ...d, mapped: (await uncForPath(d.drive)) !== '' })),
    )
    setDrives(withStatus)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // No detected network drives → render nothing (the parent shows only this, so
  // the whole "Network drives" block — separator, heading and all — disappears).
  // Users who don't use mapped drives shouldn't see an empty, confusing section.
  if (drives.length === 0) return null

  async function remap() {
    setBusy(true)
    try {
      const results = await ensureNetworkDrives()
      const failed = results.filter((r) => r.status === 'failed')
      const remapped = results.filter((r) => r.status === 'remapped').length
      if (failed.length > 0) toast.error(`${failed.length} drive(s) failed to map`)
      else toast.success(remapped > 0 ? `Re-mapped ${remapped} drive(s)` : 'All drives already mapped')
      await load()
    } catch (e) {
      // Same as forget(): without this a rejected ensureNetworkDrives was an
      // unhandled rejection with zero feedback.
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function forget(drive: string) {
    try {
      await forgetNetworkDrive({ data: { drive } })
      await load()
    } catch (e) {
      // Previously an unhandled rejection with zero feedback.
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-3 flex w-fit items-center gap-1 font-semibold">
        Network drives
        <InfoPopup label="Network drives — more information">
          Mapped drives are remembered as you pick paths and re-mapped on startup, so the app keeps
          working after relaunching as administrator.
        </InfoPopup>
      </h2>
      <div className="space-y-3">
        <ul className="space-y-2 text-sm">
          {drives.map((d) => (
            <li key={d.drive} className="flex items-center gap-2">
              <span
                className={cn('size-2 shrink-0 rounded-full', d.mapped ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
                title={d.mapped ? 'Mapped' : 'Not mapped'}
              />
              <span className="font-mono">{d.drive}</span>
              <span className="text-muted-foreground">→</span>
              <span className="truncate font-mono text-muted-foreground">{d.unc}</span>
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto shrink-0"
                onClick={() => void forget(d.drive)}
              >
                Forget
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => void remap()} disabled={busy}>
          {busy ? 'Mapping…' : 'Re-map missing now'}
        </Button>
      </div>
    </section>
  )
}
