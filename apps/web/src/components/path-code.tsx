import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

import { cn } from '#/lib/utils.ts'

/**
 * Renders a filesystem path as an inline code chip (the app's "backtick" style).
 * Clicking the chip copies its full text to the clipboard, and a copy icon
 * overlaps the top-right corner on hover.
 *
 * `path` is both shown and copied. For a two-tone display (e.g. a dimmed
 * library root + an emphasized tail) pass custom `children` — `path` is still
 * what gets copied.
 */
export function PathCode({
  path,
  children,
  className,
}: {
  path: string
  children?: ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard may be unavailable (denied permissions / no secure context) —
      // fail quietly rather than throwing on a click.
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      title={copied ? 'Copied!' : 'Click to copy'}
      onClick={() => void copy()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void copy()
        }
      }}
      className="group/path relative inline-flex max-w-full cursor-pointer align-middle"
    >
      <code
        className={cn(
          'rounded bg-muted px-1.5 py-0.5 break-all transition-colors group-hover/path:bg-accent',
          className,
        )}
      >
        {children ?? path}
      </code>
      <span
        aria-hidden
        className="pointer-events-none absolute -top-2 -right-2 hidden items-center justify-center rounded border bg-card p-1 shadow-sm group-hover/path:flex"
      >
        {copied ? (
          <Check className="size-3 text-primary" />
        ) : (
          <Copy className="size-3 text-muted-foreground" />
        )}
      </span>
    </span>
  )
}
