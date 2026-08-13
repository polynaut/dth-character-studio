import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { Button, closeFloatingLayers } from '@dth/ui'
import { openExternal } from '#/lib/desktop.ts'
import {
  clearUpdatePrompt,
  getUpdatePrompt,
  subscribeUpdatePrompt,
  type UpdatePromptRequest,
} from '#/lib/update-prompt.ts'

// The markdown renderer is the app's heaviest dependency (remark/micromark) and
// this host is mounted in the app shell — lazy-load it so it only downloads when
// an update prompt actually shows notes, not in the startup chunk. Until the
// chunk lands (or if it never can — e.g. offline) the raw markdown text shows.
const ReleaseNotes = lazy(() => import('#/components/release-notes.tsx'))

/**
 * Renders the auto-update confirm as an app-styled React dialog, replacing the
 * native Tauri `ask()`. Mounted once in the app shell next to `<Toaster/>`.
 * Renders nothing until `checkForUpdates()` calls `requestUpdatePrompt()`; the
 * dialog then drives the download/install + relaunch itself. Portaled to <body>
 * so a CSS-contained ancestor can't capture its positioning (matches the other
 * dialogs — see bulk-delete-dialog.tsx).
 */
export function UpdatePromptHost() {
  const req = useSyncExternalStore(subscribeUpdatePrompt, getUpdatePrompt, getUpdatePrompt)
  if (!req) return null
  return <UpdatePromptDialog req={req} onClose={clearUpdatePrompt} />
}

// ONE install at a time, app-wide. A dialog hidden mid-download unmounts, and a
// manual "Check for updates" can then mount a FRESH prompt for the same version
// — its Update button must not start a second downloadAndInstall under the one
// still running. Module-level because the running install's closure outlives
// the dialog that started it.
let installInFlight = false

function UpdatePromptDialog({ req, onClose }: { req: UpdatePromptRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Whether the user HID the dialog while the download/install ran. Read by the
  // install continuation — which OUTLIVES the then-unmounted dialog — to pick
  // the outcome surface: a hidden run must toast ("restart to apply" / the
  // error) instead of relaunching the app out from under whatever the user
  // switched to, or setting state on an unmounted component.
  const hiddenRef = useRef(false)

  // Idle: Later/Escape/backdrop dismiss the prompt outright. BUSY: the same
  // gestures HIDE it — a stalled download must never leave a permanent modal
  // over the whole app. The download keeps running either way; only who
  // reports its outcome changes (see hiddenRef).
  function dismiss(isBusy: boolean) {
    if (isBusy) hiddenRef.current = true
    onClose()
  }

  // This dialog is the ONE overlay in the app that appears with no user gesture
  // — an update check finishing puts it on screen. Every other z-50 overlay is
  // opened by a click, so the tooltip host's own `pointerdown` hide has already
  // cleared the layers above it; here nothing has. Without this sweep a tooltip
  // the user happened to be hovering (or one whose delay was still counting
  // down) floats over the update dialog, because tooltips are z-[100] and
  // InfoPopups z-[60] against this layer's z-50. Modal/SidePanel do this
  // themselves — this dialog is hand-rolled, so it must ask.
  useLayoutEffect(() => {
    closeFloatingLayers()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(busy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // dismiss only reads its argument + stable refs — busy is the real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, onClose])

  async function runInstall() {
    if (installInFlight) {
      setError('An update is already downloading — it will announce itself when done.')
      return
    }
    installInFlight = true
    setBusy(true)
    setError('')
    try {
      await req.install()
      if (hiddenRef.current) {
        // The dialog was hidden mid-download — never restart unannounced. The
        // toast stays until acted on (the update applies on any next start
        // anyway, so dismissing it loses nothing).
        toast.success('Update ready — restart to apply', {
          duration: Number.POSITIVE_INFINITY,
          action: { label: 'Restart', onClick: () => void req.relaunch() },
        })
        return
      }
      // Visible flow, unchanged from before the hide existed: restart right
      // away — the process exits, so control never returns here.
      await req.relaunch()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (hiddenRef.current) {
        toast.error(`Update failed — ${message}`)
        return
      }
      setError(message)
      setBusy(false)
    } finally {
      installInFlight = false
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => dismiss(busy)}
    >
      <div
        className="w-full max-w-2xl space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Update available</h2>
        <p className="text-sm text-muted-foreground">
          Version {req.version} is ready to install
          {req.currentVersion ? <> — you have {req.currentVersion}</> : null}.{' '}
          {busy
            ? 'Downloading and installing… You can hide this window — a notification appears when it is ready.'
            : 'The app will restart to finish.'}
        </p>
        {req.notes ? (
          <div className="max-h-[55vh] overflow-y-auto rounded-md border bg-card p-4 text-sm text-muted-foreground">
            <Suspense
              fallback={<div className="whitespace-pre-wrap">{req.notes}</div>}
            >
              <ReleaseNotes markdown={req.notes} />
            </Suspense>
          </div>
        ) : null}
        {req.skipped && req.skipped.length > 0 ? (
          // Catching up across several versions: the releases between the
          // installed one and the latest (newest first, max 3), as links to
          // their GitHub release pages — opened externally, never in the app.
          <div className="text-sm text-muted-foreground">
            <p className="mb-1">Also included since your version:</p>
            <ul className="space-y-0.5">
              {req.skipped.map((s) => (
                <li key={s.version}>
                  <a
                    href={s.url}
                    className="text-primary underline underline-offset-2"
                    onClick={(e) => {
                      e.preventDefault()
                      void openExternal(s.url)
                    }}
                  >
                    v{s.version} — release notes
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          {/* One button, two meanings: dismiss while idle, HIDE while busy —
              the download keeps running and its outcome arrives as a toast. */}
          <Button variant="outline" onClick={() => dismiss(busy)}>
            {busy ? 'Hide' : 'Later'}
          </Button>
          <Button disabled={busy} onClick={() => void runInstall()}>
            {busy ? 'Updating…' : 'Update now'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
