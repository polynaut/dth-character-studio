import type { GenesisVersion } from '@dth/rom'

/**
 * How Daz frames the figure in the `.tip.png` it renders, per generation.
 *
 * G3/G8/G8.1 come out sitting noticeably HIGHER in the square than G9 does, so
 * anything that crops a tip to land on the face needs a different offset for
 * them: the G9-tuned crop takes the top off their head and leaves empty tile
 * under the chin. Two consumers, deliberately sharing ONE table — the character
 * header's scroll pan (`styles.css`, `data-tip-framing` on the wrapper) and the
 * small portrait tiles (`components/portrait.tsx`). The offsets themselves live
 * with each consumer; only the question "which framing is this?" lives here.
 *
 * A `Record<GenesisVersion, …>` on purpose: adding a generation to the enum must
 * fail to compile until someone has actually LOOKED at a tip for it, rather than
 * inheriting whichever framing happened to be the fallback. Same reasoning as
 * `GENERATIONS` in the core — a new generation is a table row, not a guess.
 */
export const TIP_FRAMING: Record<GenesisVersion, 'g9' | 'pre-g9'> = {
  G9: 'g9',
  'G8.1': 'pre-g9',
  G8: 'pre-g9',
  G3: 'pre-g9',
}

/**
 * Whether a portrait of this character needs the pre-G9 crop.
 *
 * `undefined` answers false — the caller doesn't know the generation, or the
 * image is not a Daz tip at all (a Houdini project's thumbnail, an uploaded
 * photo, a static placeholder). Those must keep the default framing: nothing
 * about them is affected by how Daz composes a Genesis render, and shifting them
 * would be a crop applied for a reason that doesn't hold.
 */
export function isPreG9Tip(genesis: GenesisVersion | undefined): boolean {
  return genesis != null && TIP_FRAMING[genesis] === 'pre-g9'
}
