import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Markdown from 'react-markdown'

import { Button } from '#/components/ui/button.tsx'
import { openExternal } from '#/lib/desktop.ts'
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

/**
 * The release notes (changesets CHANGELOG markdown) rendered as real markdown.
 * react-markdown renders to React elements (no innerHTML) and fetches nothing,
 * so it stays within the strict CSP. Links open EXTERNALLY via openExternal —
 * never navigating the webview.
 */
export function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-2 [overflow-wrap:anywhere]">
      <Markdown
        components={{
          h1: ({ children }) => (
            <h3 className="pt-1 text-sm font-semibold text-foreground">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="pt-1 text-sm font-semibold text-foreground">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="pt-1 text-sm font-semibold text-foreground">{children}</h4>
          ),
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary underline underline-offset-2"
              onClick={(e) => {
                // Never navigate the webview — release notes link to GitHub.
                e.preventDefault()
                if (href) void openExternal(href)
              }}
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-2 border-border" />,
        }}
      >
        {markdown}
      </Markdown>
    </div>
  )
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
          Version {req.version} is ready to install.{' '}
          {busy ? 'Downloading and installing…' : 'The app will restart to finish.'}
        </p>
        {req.notes ? (
          <div className="max-h-[55vh] overflow-y-auto rounded-md border bg-card p-4 text-sm text-muted-foreground">
            <ReleaseNotes markdown={req.notes} />
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
