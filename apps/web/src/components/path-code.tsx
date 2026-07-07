import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, Pencil } from 'lucide-react'

import { cn } from '#/lib/utils.ts'
import { revealPath } from '#/lib/rom/api.ts'

/**
 * Renders a filesystem path as an inline code chip (the app's "backtick" style).
 * Clicking the chip copies its full text to the clipboard, and a copy icon
 * overlaps the top-right corner on hover.
 *
 * `path` is both shown and copied. For a two-tone display (e.g. a dimmed
 * library root + an emphasized tail) pass custom `children` — `path` is still
 * what gets copied.
 */
/**
 * Surface classes for a path chip, shared by `PathCode` and non-interactive
 * chips (e.g. inside a button, where `PathCode`'s click can't be nested).
 * `secondary` reads on a light / coloured background — it overrides the global
 * (unlayered) `code` rule's muted fill with `!`.
 */
export function pathChipClass(variant: 'default' | 'secondary' = 'default'): string {
  return variant === 'secondary'
    ? 'rounded bg-foreground/10! px-1.5 py-0.5 text-foreground/80'
    : 'rounded bg-muted px-1.5 py-0.5 text-foreground'
}

export function PathCode({
  path,
  children,
  className,
  variant = 'default',
  onEdit,
}: {
  path: string
  children?: ReactNode
  className?: string
  variant?: 'default' | 'secondary'
  /** When set, a small edit (pencil) button renders in front of the chip. */
  onEdit?: () => void
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

  function reveal() {
    // Ctrl+click: jump to the path in the OS file manager instead of copying
    // (a file path opens its parent folder). Errors surface as a toast-less
    // no-op — the path may be gone; copying still works either way.
    void revealPath({ data: { path } }).catch(() => {})
  }

  return (
    <span
      role="button"
      tabIndex={0}
      title={copied ? 'Copied!' : 'Click to copy — Ctrl+click to show in Explorer'}
      onClick={(e) => (e.ctrlKey || e.metaKey ? reveal() : void copy())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (e.ctrlKey || e.metaKey) reveal()
          else void copy()
        }
      }}
      className="group/path relative inline-flex max-w-full cursor-pointer align-middle"
    >
      {onEdit && (
        <button
          type="button"
          title="Edit"
          aria-label="Edit path"
          className="mr-1 inline-flex shrink-0 items-center self-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          // The chip's own click copies — editing must not also copy.
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Pencil className="size-3" />
        </button>
      )}
      <code
        className={cn(
          pathChipClass(variant),
          'break-all transition-colors',
          variant === 'secondary' ? 'group-hover/path:bg-foreground/20!' : 'group-hover/path:bg-accent',
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
