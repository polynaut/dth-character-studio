import { useEffect, useState } from 'react'

import { resolveImageSrc, resolveScenePreview } from '#/lib/rom/api.ts'
import { isPreG9Tip } from '#/lib/tip-framing.ts'
import { cn } from '@dth/ui'

import type { GenesisVersion } from '@dth/rom'

/**
 * Resolve a portrait's source URL from EITHER a stored avatar `image` reference
 * (see lib/rom/image) OR a Daz `scenePath` (.duf), whose sibling `.tip.png` is
 * read as a data URL. `scenePath` wins when both are passed. Returns '' until it
 * resolves — or when nothing is available — so the caller can show a fallback.
 */
/**
 * Guard a resolved value before it reaches an `<img src>`. A stored avatar
 * reference can be an arbitrary user-pasted URL (`isExternalImage` lets `data:` and
 * `https://` through), so allow ONLY image URL schemes to the DOM — an
 * `https://`/`http://` image, a `data:image/…` inline image, or a `blob:` object
 * URL. Anything else (`data:text/html`, `javascript:`, …) becomes '' and the caller
 * renders the name-initial fallback instead.
 */
function safeImgSrc(src: string): string {
  return /^(https?:\/\/|data:image\/|blob:)/i.test(src) ? src : ''
}

export function usePortraitSrc({
  image = '',
  scenePath = '',
}: {
  image?: string
  scenePath?: string
}): string {
  const [src, setSrc] = useState('')
  // Scene previews change CONTENT under an unchanged path (Daz rewrites the
  // .tip.png on every scene save) — re-resolve on window focus so a card shows
  // the current preview after tabbing back from Daz, not the mount-time one.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('focus', bump)
    return () => window.removeEventListener('focus', bump)
  }, [])
  useEffect(() => {
    let active = true
    const resolve = scenePath
      ? resolveScenePreview(scenePath)
      : image
        ? resolveImageSrc(image)
        : Promise.resolve('')
    // Keep the previous image while re-resolving; only swap on a result (or
    // clear on failure) so focus refreshes don't flash the fallback initial.
    resolve.then((s) => active && setSrc(safeImgSrc(s))).catch(() => active && setSrc(''))
    return () => {
      active = false
    }
  }, [image, scenePath, tick])
  return src
}

/**
 * A portrait thumbnail. A fixed-aspect frame (its background fills any
 * transparency in the source) wraps an `<img>` that's cover-fit then — when
 * `zoom` — scaled up and nudged with translateY so the crop lands on the face /
 * upper body. The source is either a stored avatar `image` or a Daz `scenePath`
 * (its `.tip.png`) — see `usePortraitSrc`. Falls back to the name's initial.
 *
 * The transform lives on the inner image so it's cheap to tweak (e.g. the
 * translateY pan) without touching the frame. `className` sizes/rounds the
 * frame (e.g. `aspect-[3/4] w-16 rounded-md`); `imgClassName` overrides the
 * zoom/pan (twMerge wins on conflicts); `fallbackClassName` sizes the initial.
 */
/**
 * The LANDSCAPE scene-thumbnail framings, as name → (box, face lift per Daz
 * framing).
 *
 * A row's values are a PAIR and must never be mixed: the lift is a percentage of
 * the box height while the zoom (`scale-[2.3]`, anchored `origin-top`) is fixed,
 * so a taller box lands the crop higher and needs its own correction. Picking
 * `md`'s box with `sm`'s lift clips the head, which is exactly the bug this table
 * exists to make unrepresentable.
 *
 * THE INVARIANT that makes the px corrections derivable rather than guessed:
 * within a column every size resolves to the SAME painted lift, because where
 * the face sits in a tip has nothing to do with how big the tile is. The px term
 * exists only to cancel the differing `-50%` baselines — and that baseline is the
 * CONTENT box, so the frame's `border-2` is 4px of it (`sm` 32→28, `md` 40→36).
 * Measured: `g9` is −14px painted in both sizes (−50%·28, and −50%·36+4).
 * `preG9` is −6px (−50%·36+12, measured against a real G8.1 tip; `sm`'s +8
 * follows from the same −6). Add a size by choosing its px so BOTH columns keep
 * landing on their column's painted lift — the smoke spec asserts exactly that.
 */
export const SCENE_TILE_SIZES = {
  /** The compact chip — scene footer, inline scene labels. */
  sm: {
    frame: 'h-8 w-[56px]',
    g9: '-translate-y-1/2',
    preG9: 'translate-y-[calc(-50%_+_8px)]',
  },
  /** The roomier row tile — pickers and list rows. */
  md: {
    frame: 'h-10 w-[64px]',
    g9: 'translate-y-[calc(-50%_+_4px)]',
    preG9: 'translate-y-[calc(-50%_+_12px)]',
  },
} as const

export type SceneTileSize = keyof typeof SCENE_TILE_SIZES

/**
 * A Daz scene's preview as a small LANDSCAPE tile — the framing used wherever a
 * scene is shown compactly (the scene footer's chips, the Tools scan picker's
 * rows). Fixed h/w rather than an aspect ratio, so the tile is a stable box
 * whatever dimensions the source `.tip.png` has.
 *
 * Use THIS instead of reaching for {@link Portrait} with hand-written classes:
 * the box and its face lift are paired in {@link SCENE_TILE_SIZES}, and getting
 * that pairing wrong is the one way this framing breaks. {@link Portrait}'s
 * default 3/4 portrait frame stays right for the bigger media slot of a card
 * (asset grid, export rows, the scene cards on the character page).
 */
export function SceneTile({
  scenePath,
  name,
  genesis,
  size = 'sm',
  muted = false,
  className,
}: {
  scenePath: string
  /** Fallback initial when the scene has no preview yet. */
  name: string
  /** The generation of the character this scene renders — Daz frames a
   *  G3/G8/G8.1 figure higher in the tip, so the face lift differs. Omitted
   *  where the caller doesn't know it; that keeps the G9 lift. */
  genesis?: GenesisVersion
  size?: SceneTileSize
  /** Greyscale + the dimmed treatment (an inactive/primary-marked scene). */
  muted?: boolean
  className?: string
}) {
  const tile = SCENE_TILE_SIZES[size]
  return (
    <Portrait
      scenePath={scenePath}
      name={name}
      // NOT `genesis` — this tile owns its own lift (a landscape crop, its own
      // measured pairs above) and passes it as an override, so Portrait's
      // portrait-shaped crop must not also fire.
      // The lift MUST arrive as a quoted string through `cn(...)`, never built
      // in a template literal: Tailwind doesn't scan a leading arbitrary token,
      // so the rule wouldn't generate (see PR #468). Both columns above are
      // written out whole for that reason.
      imgClassName={cn(isPreG9Tip(genesis) ? tile.preG9 : tile.g9, muted && 'grayscale')}
      className={cn(tile.frame, 'shrink-0 rounded', muted && 'scene-label-tile', className)}
      fallbackClassName="text-[8px]"
    />
  )
}

export function Portrait({
  image,
  scenePath,
  name,
  genesis,
  zoom = true,
  className,
  imgClassName,
  fallbackClassName,
  src: srcOverride,
}: {
  image?: string
  scenePath?: string
  name: string
  /** The generation of the character this image is a Daz render OF, when it is
   *  one — it picks the face crop, because Daz frames G3/G8/G8.1 higher in the
   *  square than G9 (see lib/tip-framing).
   *
   *  Pass it ONLY for Daz imagery: a character's tip or one of its scene
   *  previews. Leave it off for anything Daz didn't compose — a Houdini
   *  project's thumbnail, a static placeholder, a photo the user uploaded. Those
   *  keep the default crop, and omitting the prop is what guarantees it. */
  genesis?: GenesisVersion
  zoom?: boolean
  className?: string
  imgClassName?: string
  fallbackClassName?: string
  /** A ready-to-use image URL (e.g. a static placeholder) — bypasses the
   *  image/scenePath resolution so a non-character avatar renders in the same
   *  frame (background, border, crop) as a real portrait. */
  src?: string
}) {
  const resolvedSrc = usePortraitSrc({ image, scenePath })
  const src = srcOverride ?? resolvedSrc
  // Border matches the main header avatar's rest border (#2d2d2d, see
  // .avatar-scroll-shrink) — one border language for every avatar tile.
  return (
    <div className={cn('overflow-hidden border-2 border-[#2d2d2d] bg-[#262626]', className)}>
      {src ? (
        <img
          src={src}
          alt=""
          className={cn(
            'size-full object-cover',
            // Two whole class strings, not a shared prefix plus a computed lift:
            // Tailwind scans SOURCE TEXT, and an arbitrary token it never sees
            // spelled out generates no rule (the leading-token trap in
            // SceneTile's comment above, PR #468). Both spell their lift out.
            zoom &&
              (isPreG9Tip(genesis)
                ? 'origin-top -translate-x-[2%] -translate-y-[5%] scale-[2.3] object-top'
                : 'origin-top -translate-x-[2%] -translate-y-[17%] scale-[2.3] object-top'),
            // Still last: a call site that hand-picks its own lift (SceneTile's
            // landscape tiles, the overview's list view) keeps winning through
            // twMerge — those framings are tuned separately and are NOT covered
            // by the generation crop.
            imgClassName,
          )}
        />
      ) : (
        <div
          className={cn(
            'flex size-full items-center justify-center bg-muted font-bold text-muted-foreground',
            fallbackClassName,
          )}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  )
}
