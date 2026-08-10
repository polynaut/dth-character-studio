import { AlertTriangle, Check } from 'lucide-react'

import type { ReactNode } from 'react'

/**
 * One detected application install, offered for activation.
 *
 * Shared by the Daz and Houdini sections so the two read as the same kind of
 * thing — they are: "here is what is on this machine, pick the one your paths
 * should come from". The card is a BUTTON, and it says **Activate** rather than
 * relying on a hover tint: the section shipped hover-only once and two correct
 * cards read as a status display, so nobody clicked them.
 */
export function InstallCard({
  logo,
  title,
  path,
  active,
  /** false = the folder is gone; shown and refused rather than hidden, since
   *  the user knows whether it was uninstalled or lives on an unmounted drive. */
  exists,
  busy,
  /** Marks the one to pick while none is active. */
  recommended,
  /** A caveat that does not disable the card (e.g. no prefs folder paired). */
  warning,
  disabled,
  onActivate,
  /** `daz` paints the card in the Daz leaf-green of the linked-scene cards, so
   *  a detected Daz Studio reads as the same kind of object. Default keeps the
   *  neutral/primary look the Houdini section uses. */
  tone,
  footer,
}: {
  logo: string
  title: string
  path: string
  active: boolean
  exists: boolean
  busy: boolean
  recommended: boolean
  warning?: ReactNode
  disabled: boolean
  onActivate: () => void
  tone?: 'daz'
  /** An extra row INSIDE the card's box but OUTSIDE its button — a control that
   *  belongs to this install without being "activate it" (the Daz section's
   *  Export-only switch). Kept out of the button because nesting one
   *  interactive control in another is neither valid nor clickable: the switch
   *  would activate the card on its way to toggling. */
  footer?: ReactNode
}) {
  const daz = tone === 'daz'
  const card = (
    <button
      type="button"
      disabled={!exists || disabled}
      onClick={onActivate}
      data-active={active ? 'true' : 'false'}
      className={`flex ${
        // With a footer the wrapper does the sizing; without one the button IS
        // the card and keeps the flex behaviour the sections lay out with.
        footer ? 'w-full' : 'min-w-[16rem] flex-1'
      } items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        daz ? 'daz-install-card ' : ''
      }${
        active
          ? daz
            ? ''
            : 'border-primary bg-primary/10'
          : exists
            ? daz
              ? ''
              : 'hover:bg-accent/50'
            : 'cursor-not-allowed opacity-60'
      }`}
    >
      <img src={logo} alt="" aria-hidden className="size-8 shrink-0 object-contain" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          {!active && recommended && (
            <span className="text-xs text-muted-foreground">recommended</span>
          )}
          {/* State AND invitation, right-aligned so Active/Activate reads as a
              column down the card list. */}
          <span className="ml-auto shrink-0">
            {active ? (
              <span
                className={`flex items-center gap-1 text-xs font-medium ${
                  daz ? 'text-daz-green' : 'text-primary'
                }`}
              >
                <Check className="size-3.5" /> Active
              </span>
            ) : exists ? (
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                  daz ? 'border-daz-green/40 text-daz-green' : 'border-primary/40 text-primary'
                }`}
              >
                {busy ? 'Activating…' : 'Activate'}
              </span>
            ) : null}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={path}>
          {path}
        </span>
        {!exists && (
          <span className="mt-1 flex items-center gap-1 text-xs text-amber-500">
            <AlertTriangle className="size-3 shrink-0" /> folder not found
          </span>
        )}
        {exists && warning ? (
          <span className="mt-1 flex items-start gap-1 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{warning}</span>
          </span>
        ) : null}
      </span>
    </button>
  )
  // No footer → the card IS the button, exactly as before (the Houdini section
  // and every Daz card without the switch keep their existing box and flex
  // behaviour). With one, a wrapper carries the sizing and the two stack.
  if (!footer) return card
  return (
    <span className="flex min-w-[16rem] flex-1 flex-col">
      {card}
      {footer}
    </span>
  )
}
