/**
 * Where a scene's saved ROM animation lives — the folder name, the legacy name
 * the migration renames from, and the path rule itself.
 *
 * Its own module, with NO imports, on purpose: `dsa.ts` (which re-exports all
 * three, so every existing consumer is unchanged) pulls in `csv.ts` and its
 * Vite-only `?raw` template imports, which node-side tooling cannot resolve —
 * so the smoke suite could not reach this rule and had to restate it as a
 * literal. A seeded fixture that lands anywhere but where the app stats reads
 * as "no saved ROM animation", which looks like a broken menu a long way from
 * its cause. Leaf module ⇒ `apps/web/smoke/fixtures.ts` imports the real thing.
 */

/**
 * The folder beside a Daz scene holding its saved ROM animation. ONE constant
 * for the whole product: the host stats paths built from it and the generated
 * `.dsa` embeds it — because a drift between the two means the studio stats a
 * file Daz never wrote.
 *
 * Renamed from the hidden `.ROM_Animations` in runtime v48: a folder the user
 * is meant to open scenes from should be visible, and the name now matches the
 * lowercase-hyphenated convention of the other studio folders (`daz-export`).
 */
export const ROM_ANIMATIONS_FOLDER = 'rom-animations'

/** The pre-v48 name of the folder above — hidden, and underscore-cased. Kept
 *  ONLY so the host can rename an existing one on the next generation; nothing
 *  writes it any more. It must NEVER equal {@link ROM_ANIMATIONS_FOLDER}: the
 *  migration renames `from` → `to`, so identical values make it a silent no-op
 *  and strand every already-saved ROM animation in the old folder. */
export const LEGACY_ROM_ANIMATIONS_FOLDER = '.ROM_Animations'

/**
 * Where a scene's saved ROM animation lives:
 * `<sceneDir>/rom-animations/<stem>_ROM.duf` — the copy every ROM-building
 * script writes after a clean build (runtime v40). THE one rule: generation
 * embeds it (so an export-only run can map the open ROM animation back to its
 * source scene) and the host stats it, from this same function.
 *
 * Stems on the LAST dot, so a dotted scene name keeps its dots
 * ("Kira.v2.duf" → "Kira.v2_ROM.duf").
 */
export function romAnimationPath(scenePath: string): string {
  const norm = scenePath.replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  const dir = slash >= 0 ? norm.slice(0, slash) : '.'
  const file = norm.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  return `${dir}/${ROM_ANIMATIONS_FOLDER}/${stem}_ROM.duf`
}
