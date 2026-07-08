import { ArrowLeft, Save, Undo2 } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'

/**
 * Sticky page header for the form pages (Settings / Tools) — the same trick as
 * the character editor: the title and back navigation stay visible while the
 * form scrolls, and Discard/Save ride the header (top right) so pending changes
 * are always one click away. `dirty` drives both buttons; Save reads
 * Saving… / Save / Saved.
 */
export function FormHeader({
  title,
  onBack,
  dirty,
  busy,
  onDiscard,
  onSave,
}: {
  title: string
  onBack: () => void
  dirty: boolean
  busy: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    // -mx-8/px-8 span the page's p-8 gutter so scrolling content can't peek
    // past the header's background at the edges.
    <header className="sticky top-0 z-10 -mx-8 mb-8 bg-background px-8 pt-3 pb-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </button>
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-bold">{title}</h1>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button variant="outline" onClick={onDiscard} disabled={busy || !dirty}>
            <Undo2 /> Discard
          </Button>
          <Button onClick={onSave} disabled={busy || !dirty}>
            <Save /> {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </div>
    </header>
  )
}
