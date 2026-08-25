import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button, InfoPopup, useRefetchOnFocus } from '@dth/ui'
import { PathCode } from '#/components/path-code.tsx'
import { detectUnrealEngines } from '#/lib/rom/api.ts'
import { displayPath } from '#/lib/path.ts'
import unrealLogo from '#/assets/unreal-logo.svg'

import type { UnrealEngineScan } from '#/lib/unreal-install.ts'

/**
 * "Unreal Engine" (Settings → General) — the engines the Epic launcher has
 * registered on this machine.
 *
 * Purely informational, unlike the Daz/Houdini twins above it: there is no
 * "active" Unreal — a `.uproject` names its own engine version, and the studio
 * matches per project at install time. What this list feeds is the install
 * dialog's engine matching (which plugin builds fit a project) and the user's
 * own confidence that detection sees what they see in the launcher.
 */
export function UnrealInstallSection() {
  const [scan, setScan] = useState<UnrealEngineScan | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setScan(await detectUnrealEngines())
    } catch {
      setScan(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Installing or removing an engine happens in the Epic launcher, outside
  // this window — re-read when the user comes back.
  useRefetchOnFocus(
    () => {
      void load()
    },
    [load],
    { immediate: false },
  )
  useEffect(() => {
    // Load-on-mount: the flagged setState is the async load's own bookkeeping —
    // the rule flags ANY setState reachable through the called function, even
    // after its first await, so an async load can never satisfy it (#960).
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  const installs = scan?.installs ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1 font-semibold">
          Unreal Engine
          <InfoPopup label="Unreal Engine — more information">
            <div className="space-y-2">
              <p>
                The Unreal Engine versions the Epic Games launcher has installed on this machine.
                Nothing to activate here — every linked <span className="font-mono">.uproject</span>{' '}
                names its own engine version, and the studio matches DTH content and plugins to it
                per project, at install time.
              </p>
              <p>
                Create the Unreal project itself in Unreal — its New Project screen is where the
                templates live. Link the <span className="font-mono">.uproject</span> here
                afterwards and install into it.
              </p>
            </div>
          </InfoPopup>
        </h2>
        {/* Distinct accessible name — Daz, Houdini and the Daz-plugins panels
            each carry a "Rescan" on this page already. */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Rescan Unreal Engines"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Rescan
        </Button>
      </div>

      {installs.length === 0 && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {loading
            ? 'Looking for installed Unreal Engines…'
            : 'No Unreal Engine detected — the Epic Games launcher registers each install. Linked Unreal projects can still take DTH content and plugins; only checking a plugin build against the engine it was built for needs a detected engine.'}
        </p>
      )}
      {installs.length > 0 && (
        <ul className="space-y-2">
          {installs.map((install) => (
            <li key={install.version} className="flex items-start gap-3 rounded-lg border p-3">
              <img src={unrealLogo} alt="" aria-hidden className="size-8 shrink-0 object-contain" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{install.name}</div>
                <PathCode path={displayPath(install.path)} />
                {!install.exists && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                    <AlertTriangle className="size-3 shrink-0" /> folder not found — the launcher
                    still registers this version, but its plugin builds cannot be matched
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
