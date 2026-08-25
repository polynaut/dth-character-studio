import { useEffect, useState } from 'react'

import { avatarOffsetFrame, avatarOffsetZoomed } from '#/lib/avatar-offset.ts'
import { resolveImageSrc, resolveScenePreview } from '#/lib/rom/api.ts'
import { cn } from '@dth/ui'

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
export function safeImgSrc(src: string): string {
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
    // `tick` is the focus-refresh TRIGGER — a bumped counter whose only job is
    // to re-run the resolve; nothing in the body reads it (#960).
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
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
 * The LANDSCAPE scene-thumbnail framings, as name → (box, face lift).
 *
 * These two values are a PAIR and must never be mixed: the lift is a percentage
 * of the box height while the zoom (`scale-[2.3]`, anchored `origin-top`) is
 * fixed, so a taller box lands the crop higher and needs its own correction —
 * measured at +4px for `md`. Picking `md`'s box with `sm`'s lift clips the head,
 * which is exactly the bug this table exists to make unrepresentable. Add a size
 * here (measured against a real preview) rather than hand-rolling the classes at
 * a call site.
 *
 * This is the DEFAULT framing, one for every character. A character whose figure
 * sits high or low in the tips Daz renders corrects it with its own
 * `imageOffsetY` (see lib/avatar-offset), which rides on top of these — the two
 * live in different transform slots on purpose and never fight.
 */
const SCENE_TILE_SIZES = {
  /** The compact chip — scene footer, inline scene labels. */
  sm: { frame: 'h-8 w-[56px]', lift: '-translate-y-1/2' },
  /** The roomier row tile — pickers and list rows. */
  md: { frame: 'h-10 w-[64px]', lift: 'translate-y-[calc(-50%_+_4px)]' },
} as const

export type SceneTileSize = keyof typeof SCENE_TILE_SIZES

/**
 * The landscape face lift for a frame that positions in FIXED PIXELS instead of
 * `-50% + correction` — the project overview's list-view tile, whose 13/9 box
 * has no half-height baseline to cancel. It is the painted lift the sizes above
 * resolve to, which is the point: every landscape crop of a tip puts the face in
 * one place, whatever shape the frame is.
 */
export const LANDSCAPE_LIFT = '-translate-y-[14px]'

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
  offsetY,
  size = 'sm',
  muted = false,
  className,
}: {
  scenePath: string
  /** Fallback initial when the scene has no preview yet. */
  name: string
  /** The owning character's `imageOffsetY` — this scene is a Daz render of that
   *  figure, so it is framed by the same height and takes the same nudge. */
  offsetY?: number
  size?: SceneTileSize
  /** Greyscale + the dimmed treatment (an inactive/primary-marked scene). */
  muted?: boolean
  className?: string
}) {
  const { frame, lift } = SCENE_TILE_SIZES[size]
  return (
    <Portrait
      scenePath={scenePath}
      name={name}
      offsetY={offsetY}
      // The lift MUST be a quoted `cn(...)` util, not a leading
      // `-translate-y-[…]` in a template literal — Tailwind doesn't scan a
      // leading arbitrary token, so the rule wouldn't generate (see PR #468).
      imgClassName={cn(lift, muted && 'grayscale')}
      className={cn(frame, 'shrink-0 rounded', muted && 'scene-label-tile', className)}
      fallbackClassName="text-[8px]"
    />
  )
}

export function Portrait({
  image,
  scenePath,
  name,
  offsetY,
  zoom = true,
  className,
  imgClassName,
  fallbackClassName,
  src: srcOverride,
}: {
  image?: string
  scenePath?: string
  name: string
  /** The `imageOffsetY` of the character this image is a picture OF — a signed
   *  % of the picture, nudging the crop up or down (see lib/avatar-offset).
   *
   *  Pass it ONLY for that character's own imagery: its avatar, or one of its
   *  Daz scene previews. Leave it off for anything that is not a picture of it —
   *  a Houdini project's thumbnail, a static placeholder, an unrelated asset.
   *  Those keep the default crop, and omitting the prop is what guarantees it. */
  offsetY?: number
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
    <div
      // A size container ONLY when there is an offset to resolve — see
      // lib/avatar-offset. The frame must stay explicitly sized by `className`.
      style={avatarOffsetFrame(offsetY)}
      className={cn('overflow-hidden border-2 border-[#2d2d2d] bg-[#262626]', className)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          // The character's own framing nudge, in `cqmax` against the frame
          // above. The `transform` slot is free (Tailwind v4 spends `translate`
          // and `scale` on the crop) and sits INSIDE the zoom; `cqmax` is the
          // painted picture's height whatever shape the frame is. Together that
          // is what makes one stored % mean the same fraction of the picture in
          // a landscape chip and a portrait card alike (lib/avatar-offset).
          style={avatarOffsetZoomed(offsetY)}
          className={cn(
            'size-full object-cover',
            zoom && 'origin-top -translate-x-[2%] -translate-y-[17%] scale-[2.3] object-top',
            // Last: a call site that hand-picks its own lift (SceneTile's
            // landscape tiles, the overview's list view) keeps winning through
            // twMerge.
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
