import type { ReactNode } from 'react'

import { useFileDrop } from '#/lib/file-drop.ts'
import { cn } from '#/lib/utils.ts'

/**
 * Wraps a pane so a supported OS file dropped anywhere over it is accepted (no
 * need to target a button). While such a file hovers, a dashed overlay with
 * `label` appears. `accept` is lower-case extensions without the dot, e.g.
 * `['duf']` or `['hip', 'hipnc', 'hiplc']`; `onDrop` receives the matching paths.
 */
export function FileDropZone({
  accept,
  onDrop,
  label = 'Drop to add',
  className,
  overlayClassName,
  children,
}: {
  accept: Array<string>
  onDrop: (paths: Array<string>) => void
  label?: string
  className?: string
  overlayClassName?: string
  children: ReactNode
}) {
  const { id, isOver } = useFileDrop({ accept, onDrop })
  return (
    <div data-filedrop-id={id} className={cn('relative', className)}>
      {children}
      {isOver && (
        // Floats just outside the content (negative inset) so the dashed border
        // has breathing room without nudging the wrapped layout. Parents have
        // their own padding, so it stays clear of neighbours.
        <div
          className={cn(
            'pointer-events-none absolute -inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary',
            overlayClassName,
          )}
        >
          {label}
        </div>
      )}
    </div>
  )
}
