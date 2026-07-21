import { Tag, cn } from '@dth/ui'

import { Portrait } from '#/components/portrait.tsx'

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
  className?: string
}) {
  return (
    <Tag
      // Always the Daz-green "linked-scene card" tint + border, a touch stronger
      // since this is a small pill.
      tone="green"
      className={cn(
        'inline-flex max-w-72 items-center gap-2 border-[color-mix(in_oklab,var(--color-daz-green)_55%,var(--border))] bg-[color-mix(in_oklab,#3fae6bcf_35%,var(--card))] py-1 pr-2 pl-1.5 text-sm font-normal normal-case',
        className,
      )}
    >
      {/* Fixed h/w (not aspect-ratio) so the tile is a stable box; landscape
          face-zoom matches the list-view framing. Greyscaled for the primary. */}
      <Portrait
        scenePath={scenePath}
        name={fallbackName ?? name}
        imgClassName={`-translate-y-[16px]${muted ? ' grayscale' : ''}`}
        className={`h-8 w-[56px] shrink-0 rounded${muted ? ' scene-label-tile' : ''}`}
        fallbackClassName="text-[8px]"
      />
      <span className="truncate">{name}</span>
    </Tag>
  )
}
