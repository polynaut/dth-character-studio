import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/ui/button.tsx'
import {
  clearUpdatePrompt,
  getUpdatePrompt,
  subscribeUpdatePrompt,
  type UpdatePromptRequest,
} from '#/lib/update-prompt.ts'

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
        className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Update available</h2>
        <p className="text-sm text-muted-foreground">
          Version {req.version} is ready to install.{' '}
          {busy ? 'Downloading and installing…' : 'The app will restart to finish.'}
        </p>
        {req.notes ? (
          <div className="max-h-40 overflow-y-auto rounded-md border bg-card p-3 text-sm whitespace-pre-wrap text-muted-foreground">
            {req.notes}
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
