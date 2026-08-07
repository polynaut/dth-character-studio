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
}) {
  return (
    <button
      type="button"
      disabled={!exists || disabled}
      onClick={onActivate}
      className={`flex min-w-[16rem] flex-1 items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        active
          ? 'border-primary bg-primary/10'
          : exists
            ? 'hover:bg-accent/50'
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
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                <Check className="size-3.5" /> Active
              </span>
            ) : exists ? (
              <span className="rounded-md border border-primary/40 px-2 py-0.5 text-xs font-medium text-primary">
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
}
