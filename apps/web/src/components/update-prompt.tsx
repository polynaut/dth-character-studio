import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/ui/button.tsx'
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

function UpdatePromptDialog({ req, onClose }: { req: UpdatePromptRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function runInstall() {
    setBusy(true)
    setError('')
    try {
      // On success this downloads, installs and relaunches — the process exits, so
      // control never returns here. A thrown error means it failed; re-enable.
      await req.install()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-2xl space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Update available</h2>
        <p className="text-sm text-muted-foreground">
          Version {req.version} is ready to install
          {req.currentVersion ? <> — you have {req.currentVersion}</> : null}.{' '}
          {busy ? 'Downloading and installing…' : 'The app will restart to finish.'}
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
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Later
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
