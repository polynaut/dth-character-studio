import type { CSSProperties } from 'react'
import { useCallback, useEffect } from 'react'
import { Outlet, createRootRoute, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Toaster, toast } from 'sonner'

import {
  consumeSettingsFileCorrupt,
  ensureNetworkDrives,
  fetchPoseAssets,
  fetchSettings,
} from '#/lib/rom/api.ts'
import { checkForUpdates } from '#/lib/updater.ts'
import { onMenu, openExternal } from '#/lib/desktop.ts'
import { ConfirmProvider } from '#/lib/use-confirm.tsx'
import { UpdatePromptHost } from '#/components/update-prompt.tsx'
import { Button, TooltipHost, UiConfigProvider, installAltMenuGuard } from '@dth/ui'

import type { ErrorComponentProps } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
})

/**
 * App-styled last-resort error boundary: any loader/render throw that nothing
 * below catches lands here instead of TanStack's default error UI. Deliberately
 * self-contained (plain anchor, no router Link) — it must render even when the
 * router state itself is broken.
 */
function RootErrorComponent({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The app hit an unexpected error. Reload to try again, or go back to the start screen.
        </p>
        <pre className="mt-4 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap">
          {message || 'Unknown error'}
        </pre>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" asChild>
            <a href="/">Back to start</a>
          </Button>
        </div>
      </div>
    </main>
  )
}

function RootComponent() {
  const navigate = useNavigate()

  // Alt over a reveal target must not arm the native menu bar (Alt+click is
  // the "show in Explorer" hotkey there) — bare Alt elsewhere still does.
  useEffect(() => installAltMenuGuard(), [])

  // On launch, surface a corrupt settings.json ONCE: getSettings degrades to
  // defaults (deliberately tolerant), but silently — the next save would then
  // overwrite the broken file and the user would lose every tool path with no
  // notice. The read here primes the flag even before any settings-using route.
  useEffect(() => {
    void fetchSettings().then(() => {
      if (consumeSettingsFileCorrupt()) {
        toast.error(
          'Your settings file could not be read — starting from defaults. Check the tool paths under Settings before saving (a save overwrites the broken file).',
          { duration: 12000 },
        )
      }
    })
  }, [])

  // On launch, re-map any known network drives that aren't currently available
  // (an elevated relaunch doesn't inherit the user's interactive mappings).
  useEffect(() => {
    void (async () => {
      const results = await ensureNetworkDrives()
      const remapped = results.filter((r) => r.status === 'remapped').map((r) => r.drive)
      const failed = results.filter((r) => r.status === 'failed')
      if (remapped.length > 0) toast.success(`Re-mapped network drive ${remapped.join(', ')}`)
      for (const f of failed) {
        toast.error(`Couldn't map ${f.drive} → ${f.unc}: ${f.detail}`)
      }
      // Warm the in-memory pose catalog now that any network drives are mapped
      // (the release often lives on a share) — so the first character open is
      // instant. Fire-and-forget; a failed scan isn't cached and just retries.
      void fetchPoseAssets()
    })()
  }, [])

  // Native app-menu actions (built in Rust — see lib.rs). Main → Refresh assets /
  // Exit; Help → About / Check for Updates. Exit quits natively; the rest emit an
  // event handled here. No-op in the plain web build (no Tauri).
  useEffect(() => {
    const unsub = [
      onMenu('menu-about', () => void navigate({ to: '/about' })),
      onMenu('menu-refresh-assets', () => void navigate({ to: '/tools', search: { tab: 'refresh' } })),
      onMenu('menu-check-updates', () => void checkForUpdates({ manual: true })),
    ]
    return () => unsub.forEach((u) => u())
  }, [navigate])

  // UiConfigProvider memoizes per HANDLER — inline arrows here would hand it
  // three fresh functions every root re-render and defeat that memo, re-rendering
  // every useUiConfig consumer. Keep each handler referentially stable.
  // In-app links (InfoPopup) go through the router; external URLs open in
  // the OS browser (Tauri) — the seam that keeps @dth/ui native-free.
  const onNavigate = useCallback(
    (path: string) => void (navigate as (opts: { to: string }) => unknown)({ to: path }),
    [navigate],
  )
  const onOpenExternal = useCallback((url: string) => void openExternal(url), [])
  // Kit-internal errors (e.g. a failed EditableTitle save) surface as the
  // app's toast — the kit itself has no sonner dependency.
  const onError = useCallback((message: string) => void toast.error(message), [])

  return (
    <UiConfigProvider value={{ onNavigate, onOpenExternal, onError }}>
      <ConfirmProvider>
        <Outlet />
      </ConfirmProvider>
      <Toaster
        theme="light"
        position="top-center"
        closeButton
        // Light-orange toast with dark text and a dark-orange border — the app's
        // brand orange (#fe5c01) family, kept legible on a light surface.
        style={
          {
            '--normal-bg': '#ffe3cc',
            '--normal-border': '#c2410c',
            '--normal-text': '#2b1200',
            '--border-radius': 'var(--radius)',
          } as CSSProperties
        }
        toastOptions={{
          classNames: {
            description: '!text-[#7a4a2c]',
            actionButton: '!bg-[#c2410c] !text-white',
            cancelButton: '!bg-black/10 !text-[#2b1200]',
            closeButton: '!border-[#c2410c]/40 !bg-[#ffd5b5] !text-[#2b1200] hover:!bg-[#ffc99e]',
          },
        }}
      />
      {/* App-styled auto-update confirm (replaces the native OS dialog). */}
      <UpdatePromptHost />
      {/* Floating-UI tooltips for every title= attribute, app-wide. */}
      <TooltipHost />
      {/* Dev-only: never ship the devtools button to installed/end-user builds.
          The screenshot suite sets `window.__dthHideDevtools` before the bundle
          runs so the floating trigger stays out of the doc screenshots (a DOM/CSS
          hack loses to the widget re-mounting during Playwright's fullPage shot). */}
      {import.meta.env.DEV &&
        !(window as unknown as { __dthHideDevtools?: boolean }).__dthHideDevtools && (
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
      )}
    </UiConfigProvider>
  )
}
