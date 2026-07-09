import { ExternalLink, FolderOpen, Trash2 } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

import { cn } from '../cn.ts'
import { Button } from '../primitives/button.tsx'

/**
 * A linked-asset card shell — the shared anatomy of the Daz-scene and Houdini
 * cards (and any future "linked file" card): a media thumbnail, a title, an
 * optional path chip + extra badges, a whole-card open button, and a hover
 * remove button. The reveal-icon in the corner previews the Alt+click
 * "show in Explorer" action.
 *
 * It's deliberately presentational: the app injects the native pieces as
 * slots — `media` (its own Portrait/logo), `chip` (its PathCode), `badge`
 * (a brand mark), `extra` (tags) — and the open/remove behaviour as callbacks.
 * The card itself imports nothing from Tauri, the router, or the filesystem, so
 * it is reusable by a future online build.
 */
export function LinkedAssetCard({
  title,
  media,
  badge,
  chip,
  extra,
  altHeld,
  openTitle,
  accentClass,
  cardClass,
  width = 'w-80',
  onOpen,
  onRemove,
  removeTitle = 'Remove',
}: {
  title: string
  /** Thumbnail slot — the app's Portrait or a logo, sized by the caller. */
  media: ReactNode
  /** Brand mark floated bottom-left over the media. */
  badge?: ReactNode
  /** Path chip shown under the title. */
  chip?: ReactNode
  /** Extra content under the chip (e.g. a "primary" tag). */
  extra?: ReactNode
  /** Alt is held → the corner icon previews "show in Explorer". */
  altHeld: boolean
  openTitle: string
  /** Hover accent for the corner icon, e.g. `group-hover:text-daz-green`. */
  accentClass?: string
  /** Extra class on the open button, e.g. `daz-card` / `houdini-card`. */
  cardClass?: string
  width?: string
  onOpen: (e: MouseEvent) => void
  /** When set, a hover ✕ appears (unlink — never a file delete). */
  onRemove?: () => void
  removeTitle?: string
}) {
  const CornerIcon = altHeld ? FolderOpen : ExternalLink
  return (
    <div className={cn('group/card relative', width)}>
      <button
        type="button"
        onClick={onOpen}
        data-alt-reveal=""
        title={openTitle}
        className={cn(
          'group relative flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
          cardClass,
        )}
      >
        <div className="relative shrink-0">
          {media}
          {badge}
        </div>
        <div className="min-w-0 text-xs">
          <div className="truncate text-sm font-medium">{title}</div>
          {chip && <div className="mt-1">{chip}</div>}
          {extra && <div className="mt-1">{extra}</div>}
        </div>
        <CornerIcon
          className={cn(
            'absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors',
            accentClass,
          )}
        />
      </button>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 size-7 opacity-0 transition-opacity group-hover/card:opacity-100"
          title={removeTitle}
          aria-label={removeTitle}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      )}
    </div>
  )
}
