import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, FolderOpen, Pencil } from 'lucide-react'

import { cn } from '../cn.ts'
import { useUiConfig } from '../config.tsx'
import { useModifierHeld } from '../hooks/use-modifier-held.ts'

/**
 * Surface classes for a path chip, shared by `PathChip` and non-interactive
 * chips (e.g. inside a button, where `PathChip`'s click can't be nested).
 * `secondary` reads on a light / coloured background — it overrides the global
 * (unlayered) `code` rule's muted fill with `!`.
 */
export function pathChipClass(variant: 'default' | 'secondary' = 'default'): string {
  return variant === 'secondary'
    ? 'rounded bg-foreground/10! px-1.5 py-0.5 text-foreground/80'
    : 'rounded bg-muted px-1.5 py-0.5 text-foreground'
}

/** The TALL chip variant, for a chip sitting beside h-9 buttons: min-h (not a
 *  fixed h-9) plus real padding, so a long path that wraps to a second line
 *  grows the box with breathing room instead of pressing against its edges.
 *  The paddings need `!` — the global unlayered `code` rule (styles.css) sets
 *  `padding: 2px 6px` and beats layered utilities. */
export const tallPathChipClass = 'flex min-h-9 items-center px-2.5! py-1.5!'

/**
 * A filesystem path as an inline code chip. Click copies `path`; Alt+click
 * reveals it in the OS file manager (via `UiConfig.onRevealPath`).
 */
export function PathChip({
  path,
  display,
  roots,
  children,
  className,
  variant = 'default',
  onEdit,
}: {
  /** What a click copies. */
  path: string
  /** Shown text; defaults to `path`. */
  display?: string
  /** Two-tone display: the first of these that prefixes `display` (case-insensitive) is dimmed. Most specific first. */
  roots?: string[]
  /** Custom display; wins over `display` and `roots`. */
  children?: ReactNode
  className?: string
  variant?: 'default' | 'secondary'
  /** When set, a small edit (pencil) button renders in front of the chip. */
  onEdit?: () => void
}) {
  const { onRevealPath } = useUiConfig()
  const [copied, setCopied] = useState(false)
  // Alt held → the hover overlay previews the alternate action (open folder).
  const altHeld = useModifierHeld('Alt')

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
    onRevealPath(path)
  }

  return (
    <span
      role="button"
      tabIndex={0}
      data-alt-reveal=""
      // No tooltip by design: the guide documents click and Alt+click; the check overlay confirms a copy.
      aria-label={copied ? 'Copied' : 'Copy path'}
      onClick={(e) => (e.altKey ? reveal() : void copy())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (e.altKey) reveal()
          else void copy()
        }
      }}
      className="group/path relative inline-flex max-w-full cursor-pointer align-middle"
    >
      {onEdit && (
        // Fixed size-5, not padding-driven: a taller button would stretch every editable chip 2px past the pencil-less ones.
        <button
          type="button"
          aria-label="Edit path"
          className="mr-1 inline-flex size-5 shrink-0 items-center justify-center self-center rounded border border-transparent text-muted-foreground transition-colors hover:border-white/20 hover:bg-(--chip-adornment) hover:text-foreground hover:shadow-sm"
          // The chip's own click copies; editing must not also copy.
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
        {children ?? (roots ? <TwoTone text={display ?? path} roots={roots} /> : (display ?? path))}
      </code>
      <span
        aria-hidden
        className="pointer-events-none absolute -top-2 -right-2 hidden size-5 items-center justify-center rounded border border-white/20 bg-(--chip-adornment) shadow-sm group-hover/path:flex"
      >
        {copied ? (
          <Check className="size-3 text-primary" />
        ) : altHeld ? (
          // Alt is down: the click will OPEN the folder, not copy - preview it.
          <FolderOpen className="size-3 text-primary" />
        ) : (
          <Copy className="size-3 text-muted-foreground" />
        )}
      </span>
    </span>
  )
}

function TwoTone({ text, roots }: { text: string; roots: string[] }) {
  const lower = text.toLowerCase()
  const rootLen =
    roots
      .map((root) => (root && lower.startsWith(root.toLowerCase()) ? root.length : 0))
      .find((len) => len > 0) ?? 0
  return (
    <>
      {rootLen > 0 && <span className="text-muted-foreground/60">{text.slice(0, rootLen)}</span>}
      <span className="text-foreground/80">{text.slice(rootLen)}</span>
    </>
  )
}
