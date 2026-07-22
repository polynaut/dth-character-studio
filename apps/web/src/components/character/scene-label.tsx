import { Tag, cn } from '@dth/ui'

import { Portrait } from '#/components/portrait.tsx'

import type { ReactNode } from 'react'

/**
 * The Daz-green "linked-scene" pill: a small landscape render of the scene's
 * `.tip.png` followed by its (already-prettified) name — the same look the
 * linked-scene cards use. Shared by the editor header's scene tag AND every
 * per-scene override toggle, so the selected scene reads identically everywhere.
 *
 * `muted` gives the PRIMARY-scene look (greyscale render + a plain tile) for the
 * header, where the primary can be the active selection; the override toggles
 * always show a non-primary scene, so they leave it off.
 */
export function SceneLabel({
  scenePath,
  name,
  muted = false,
  fallbackName,
  eyebrow,
  trailing,
  end,
  showAvatar = true,
  className,
}: {
  /** The scene whose `.tip.png` renders in the pill. */
  scenePath: string
  /** The display label — already name-stripped + spaced (see prettySceneName). */
  name: string
  /** The primary-scene look: greyscale render + plain tile. */
  muted?: boolean
  /** Portrait initial shown when the scene has no tip (defaults to `name`). */
  fallbackName?: string
  /** A tiny UPPERCASE line stacked above the name (e.g. "Override" on the per-scene
   *  override toggles). Omitted → the name is a single line (the header tag). */
  eyebrow?: string
  /** Rendered inline right after the name (e.g. the override info "i" popup). */
  trailing?: ReactNode
  /** Rendered at the pill's RIGHT edge, its own column after the name (e.g. the
   *  override toggle switch, folded into the pill). Gets a left divider to set it
   *  off from the name. */
  end?: ReactNode
  /** Show the scene's mini render at the pill's start (default). `false` → a
   *  compact, avatar-less pill (e.g. the Genesis-9 override toggle). */
  showAvatar?: boolean
  className?: string
}) {
  return (
    <Tag
      // Always the Daz-green "linked-scene card" tint + border, a touch stronger
      // since this is a small pill.
      tone="green"
      className={cn(
        'inline-flex max-w-72 items-center gap-2 border-[color-mix(in_oklab,var(--color-daz-green)_55%,var(--border))] bg-[color-mix(in_oklab,#3fae6bcf_35%,var(--card))] py-1 pr-2 text-sm font-normal normal-case',
        showAvatar ? 'pl-1.5' : 'pl-3',
        className,
      )}
    >
      {/* Fixed h/w (not aspect-ratio) so the tile is a stable box; landscape
          face-zoom matches the list-view framing. Greyscaled for the primary.
          The lift MUST be a quoted `cn(...)` fraction util, not a leading
          `-translate-y-[…]` in a template literal — Tailwind doesn't scan a
          leading arbitrary token, so the rule wouldn't generate (see PR #468). */}
      {showAvatar && (
        <Portrait
          scenePath={scenePath}
          name={fallbackName ?? name}
          imgClassName={cn('-translate-y-1/2', muted && 'grayscale')}
          className={`h-8 w-[56px] shrink-0 rounded${muted ? ' scene-label-tile' : ''}`}
          fallbackClassName="text-[8px]"
        />
      )}
      {eyebrow ? (
        <span className="flex min-w-0 flex-col justify-center gap-0.5 leading-none">
          <span className="text-[10px] font-semibold tracking-wider uppercase opacity-70">
            {eyebrow}
          </span>
          {/* No name → the eyebrow IS the whole label (the compact "OVERRIDE"
              pill), so it keeps that small eyebrow text style with no empty row. */}
          {name && (
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate">{name}</span>
              {trailing}
            </span>
          )}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{name}</span>
          {trailing}
        </span>
      )}
      {end && (
        <span className="ml-0.5 flex items-center self-stretch border-l border-[color-mix(in_oklab,var(--color-daz-green)_40%,transparent)] pl-2">
          {end}
        </span>
      )}
    </Tag>
  )
}
