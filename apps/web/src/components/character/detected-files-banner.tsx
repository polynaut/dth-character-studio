import { X } from 'lucide-react'

import { Button } from '@dth/ui'

/**
 * The non-modal notice for new files found in the character's folder — never a
 * surprise modal: alt-tabbing back from Daz/Houdini must not steal a click.
 * Review opens the wizard; ✕ hides it for the session only (the files stay
 * unlinked and un-ignored, so the banner returns on the next visit — permanent
 * skipping lives in the wizard).
 */
export function DetectedFilesBanner({
  scenes,
  houdini,
  onReview,
  onDismiss,
}: {
  scenes: number
  houdini: number
  onReview: () => void
  onDismiss: () => void
}) {
  const parts = [
    scenes > 0 ? `${scenes} new Daz scene${scenes === 1 ? '' : 's'}` : '',
    houdini > 0 ? `${houdini} new Houdini project${houdini === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
      <span aria-hidden className="text-sky-500">
        ✦
      </span>
      <span className="flex-1">
        {parts.join(' and ')} found in this character&apos;s folder.
      </span>
      <Button size="sm" onClick={onReview}>
        Review
      </Button>
      <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
        <X className="size-4" />
      </Button>
    </div>
  )
}
