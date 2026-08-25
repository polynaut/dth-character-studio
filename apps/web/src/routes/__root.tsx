import type { CSSProperties } from 'react'
import { useCallback, useEffect } from 'react'
import { Outlet, createRootRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Check, Info, X } from 'lucide-react'
import { Toaster, toast } from 'sonner'

import {
  consumeSettingsFileCorrupt,
  ensureNetworkDrives,
  fetchPoseAssets,
  fetchSettings,
} from '#/lib/rom/api.ts'
import { checkForUpdates } from '#/lib/updater.ts'
import { trackNavOrigin } from '#/lib/nav-origin.ts'
import { onMenu, openExternal } from '#/lib/desktop.ts'
import { ConfirmProvider } from '#/lib/use-confirm.tsx'
import { UpdatePromptHost } from '#/components/update-prompt.tsx'
import { ProjectDetectedFilesBanner } from '#/components/project-detected-files-banner.tsx'
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
  const router = useRouter()

  // Record the last non-utility page so Tools/Settings/About "Back" can hard-link
  // to it (see lib/nav-origin.ts).
  useEffect(() => trackNavOrigin(router), [router])

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
  // fresh functions every root re-render and defeat that memo, re-rendering
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
  // SidePanel sweeps stale toasts on open — a leftover toast (top-center,
  // above z-50) would float over the drawer as it slides in.
  const dismissToasts = useCallback(() => void toast.dismiss(), [])

  // Dev-only handle for AD-HOC harness use: it lets a spec fire demo toasts
  // through the app's OWN sonner instance (a spec-side `import('sonner')` gets
  // its own module copy, which the mounted <Toaster/> never sees). Nothing in
  // the suite reads it today (`playwright.config.ts`, `.ai/testing.md`), and it
  // is never shipped. An effect rather than a render-time global write: a
  // render React discards must not publish a global.
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as { __dthToast?: typeof toast }).__dthToast = toast
    }
  }, [])

  return (
    <UiConfigProvider value={{ onNavigate, onOpenExternal, onError, dismissToasts }}>
      <ConfirmProvider>
        {/* Above the page, not on one: a file saved into a character's folder
            should be noticed wherever the user comes back to — the character
            page's own banner only runs while that character is open (#740).
            Renders nothing in a window with no project, and never for the
            character already on screen. */}
        <ProjectDetectedFilesBanner />
        <Outlet />
      </ConfirmProvider>
      {/* Dark severity toasts: app-surface card, a colored accent bar on the
          left edge (with a soft glow of the same hue, via --glow), a solid
          round severity icon, bold title over a muted description, and the
          close X pinned to the RIGHT (sonner defaults it to the top-left).
          Plain toast() (no severity) keeps a neutral edge. */}
      <Toaster
        theme="dark"
        position="top-center"
        closeButton
        // WIDER than sonner's 356px default. This app's toasts are mostly
        // messages from the layers below it — an os error 32 with the locking
        // process named, a hython stderr line, a path that failed to write —
        // and at the default width those wrap into a seven-line paragraph the
        // eye has to read rather than scan. Clamped to the viewport so a narrow
        // window still gets a toast that fits inside it.
        style={
          {
            '--border-radius': 'var(--radius)',
            '--width': 'min(34rem, calc(100vw - 2rem))',
          } as CSSProperties
        }
        icons={{
          success: (
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check className="size-4" strokeWidth={3.5} />
            </span>
          ),
          warning: (
            <span className="flex size-7 items-center justify-center rounded-full bg-amber-400 text-lg font-black text-amber-950">
              !
            </span>
          ),
          error: (
            <span className="flex size-7 items-center justify-center rounded-full bg-red-500 text-white">
              <X className="size-4" strokeWidth={3.5} />
            </span>
          ),
          info: (
            <span className="flex size-7 items-center justify-center rounded-full bg-sky-500 text-white">
              <Info className="size-4" strokeWidth={3} />
            </span>
          ),
        }}
        toastOptions={{
          classNames: {
            toast:
              '!items-center !gap-3 !rounded-lg !border !border-border !border-l-4 !bg-card !pr-10 !text-foreground !shadow-[0_10px_30px_rgb(0_0_0/0.45),-4px_0_14px_-6px_var(--glow,transparent)]',
            title: '!text-[0.95rem] !font-semibold',
            // `whitespace-pre-line` because descriptions are BUILT as lines —
            // the export finish report is one per leg. Sonner renders the
            // description as plain text, so without it every newline collapsed
            // and a six-line report arrived as one run-on paragraph: the Daz
            // line, the warnings and the Unreal line welded together
            // mid-sentence.
            description: '!text-[0.85rem] !text-muted-foreground whitespace-pre-line',
            // No `default` key: sonner applies it to EVERY toast, so it would
            // fight the per-type accent/glow below. Plain toast() stays neutral.
            success: '!border-l-emerald-500 [--glow:#10b981]',
            warning: '!border-l-amber-400 [--glow:#fbbf24]',
            error: '!border-l-red-500 [--glow:#ef4444]',
            info: '!border-l-sky-500 [--glow:#0ea5e9]',
            actionButton: '!bg-primary !text-primary-foreground',
            cancelButton: '!bg-secondary !text-secondary-foreground',
            closeButton:
              '!absolute !top-1/2 !right-2 !left-auto !size-7 !-translate-y-1/2 !transform-none !rounded-md !border-0 !bg-transparent !text-muted-foreground hover:!bg-accent hover:!text-foreground [&>svg]:!size-4',
          },
        }}
      />
      {/* App-styled auto-update confirm (replaces the native OS dialog). */}
      <UpdatePromptHost />
      {/* Floating-UI tooltips for every title= attribute, app-wide. */}
      <TooltipHost />
      {/* Dev-only: never ship the devtools button to installed/end-user builds.
          The smoke harness sets `window.__dthHideDevtools` before the bundle runs
          — `installTauriMock` for every spec, `prime()` for the docs suites — and
          it earns its keep twice. It keeps the floating trigger out of the doc
          screenshots (a DOM/CSS hack loses to the widget re-mounting during
          Playwright's fullPage shot), and it stops the trigger swallowing clicks
          aimed at anything else anchored BOTTOM-RIGHT — where a SidePanel's
          pinned footer puts its primary action. CI sees neither problem: a
          production bundle never renders this. See `.ai/testing.md`. */}
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
