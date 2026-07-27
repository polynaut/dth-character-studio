import { genesisFromFigureNode } from '@dth/rom'

import type { SceneWearables } from '#/lib/rom/api/native-types.ts'
import type { Character, Gender } from '@dth/rom'

/**
 * Scene-compatibility checks over `scene_wearables` reads — pure logic only
 * (the "Validation" table rendering them lives in
 * `components/scene-compat.tsx`). Two consumers:
 *
 * - **Add-scene dialog** ({@link sceneCompatRows}): every extra scene of a
 *   character generates against the same ROM timeline and must produce the
 *   primary scene's skeleton — so a candidate has to match the character's
 *   Genesis generation, hold exactly one character, keep its animation
 *   timeline empty (the generated ROM script fills it), and carry the same
 *   genital geograft (GP/DK) as the primary scene. Gender itself can't be read
 *   from a G9 scene (the figure is gender-neutral) — the geograft compare is
 *   its closest proxy. Hair, clothing and props may differ freely: outfit
 *   variants are exactly what extra scenes are for.
 * - **Create-character dialog** ({@link sceneCreateRows}): only the checks
 *   that need no existing character — exactly one character and an empty
 *   timeline. Generation/gender are auto-SELECTED from the same read there
 *   (not validated), and there's no primary scene to compare geografts with.
 *
 * The primary scene also DRIVES two character fields via
 * {@link primarySceneDerivation} (applied by `createCharacter` and the primary
 * link/relink flow):
 *
 * - the **GEN ROM section's enabled state** ({@link genEnabledForScan}) — on
 *   exactly when the scene carries a GP/DK geograft; the editor's GEN toggle
 *   is not user-operable.
 * - the **gender** ({@link genderForScan}) — the figure id for the gendered
 *   generations (Genesis8Female, Genesis3Male, …), the geograft for the
 *   gender-neutral G9 figure (DK → male, GP → female). Gender's only real
 *   jobs are picking the GP-vs-DK ROM blocks and the gendered figure node, so
 *   with both readable from the scene there is nothing left to ask the user —
 *   the manual Gender fields are gone (the Identity row is read-only).
 */

/** ok = validated, fail = definitively violated, unchecked = couldn't tell
 *  (unreadable scene / not in the desktop app) — never blocks. */
export type SceneCheckState = 'ok' | 'fail' | 'unchecked'

export interface SceneCheckRow {
  key: string
  label: string
  /** State text next to the icon (e.g. "G9", "2 characters", "—"). */
  value: string
  state: SceneCheckState
  /** What the check demands and why — shown as the row's tooltip when it FAILS. */
  why: string
}

const GEOGRAFT_LABELS = { gp: 'Golden Palace', dk: 'Dicktator' } as const
export type GeograftKind = keyof typeof GEOGRAFT_LABELS

/** The GP/DK geografts present among a scene's conformed items, matched on the
 *  node id AND label with separators dropped — "GoldenPalace_G9" (G9),
 *  "GoldenPalace" (G8) and a "Golden Palace…" label all count. Anything that
 *  isn't one of the two known geografts is deliberately ignored: other grafts
 *  don't change the exported skeleton the way the genital ROM blocks expect. */
export function geograftKinds(scan: Pick<SceneWearables, 'items'>): Set<GeograftKind> {
  const kinds = new Set<GeograftKind>()
  for (const item of scan.items) {
    const hay = `${item.id} ${item.label}`.toLowerCase().replace(/[\s_-]/g, '')
    if (hay.includes('goldenpalace')) kinds.add('gp')
    if (hay.includes('dicktator')) kinds.add('dk')
  }
  return kinds
}

/** THE GEN-section gate: enabled exactly when the (primary) scene carries a
 *  GP/DK geograft — the user never toggles GEN by hand. Evaluated when the
 *  primary scene is chosen (character create, primary link/relink). Returns
 *  null for an unreadable scene (browser mode / missing file): the caller
 *  keeps the stored value rather than guessing. */
export function genEnabledForScan(scan: SceneWearables): boolean | null {
  if (scan.error !== '') return null
  return geograftKinds(scan).size > 0
}

/** Best-effort gender from a scene read: the figure id for the gendered
 *  generations (Genesis8Female, Genesis3Male, …), else the geograft — DK →
 *  male, GP (or GP + DK) → female — since the G9 figure id is gender-neutral.
 *  Null when neither tells (bare neutral figure / unreadable scene): the
 *  caller keeps the stored value. */
export function genderForScan(scan: SceneWearables): Gender | null {
  if (scan.error !== '') return null
  const figure = scan.figures[0]
  const detected = figure ? genesisFromFigureNode(figure.id) : null
  if (detected?.gender) return detected.gender
  const kinds = geograftKinds(scan)
  if (kinds.has('dk') && !kinds.has('gp')) return 'male'
  if (kinds.has('gp')) return 'female'
  return null
}

/** The canonical G9 GEN preset assets (the same names `migrate.ts` uses) — set
 *  explicitly only for a BOTH-grafts scene, where the gender-based "auto"
 *  default (empty presetAssets) would include just one of the two blocks. */
const G9_BOTH_GEN_ASSETS = ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf']

/**
 * The scene-driven character fields, derived from a primary-scene read: the
 * GEN section's enabled state (+ the explicit GP+DK preset selection for a
 * both-grafts G9 scene) and the gender. Returns ONLY the fields the scan can
 * decide AND that differ from `character` — an unreadable scan decides
 * nothing, and an empty patch means nothing changed. ONE rule, applied
 * everywhere a primary scene is chosen (`createCharacter`, the editor's
 * primary link/relink).
 */
export function primarySceneDerivation(
  scan: SceneWearables,
  character: Pick<Character, 'genesis' | 'gender' | 'sections'>,
): Partial<Pick<Character, 'gender' | 'sections'>> {
  if (scan.error !== '') return {}
  const patch: Partial<Pick<Character, 'gender' | 'sections'>> = {}
  const gender = genderForScan(scan)
  if (gender !== null && gender !== character.gender) patch.gender = gender
  const kinds = geograftKinds(scan)
  const gen = character.sections.GEN
  const enabled = kinds.size > 0
  const presetAssets =
    kinds.has('gp') && kinds.has('dk') && character.genesis === 'G9'
      ? G9_BOTH_GEN_ASSETS
      : gen.presetAssets
  if (enabled !== gen.enabled || presetAssets !== gen.presetAssets) {
    patch.sections = { ...character.sections, GEN: { ...gen, enabled, presetAssets } }
  }
  return patch
}

function geograftName(kinds: Set<GeograftKind>): string {
  if (kinds.size === 0) return 'none'
  return [...kinds].map((kind) => GEOGRAFT_LABELS[kind]).join(' + ')
}

function readable(scan: SceneWearables | null): scan is SceneWearables {
  return scan !== null && scan.error === ''
}

/** Same Genesis generation as the character. The figure id also carries the
 *  gender for the gendered generations (Genesis8Female, …) — compared too when
 *  present; the G9 id is gender-neutral, which is what the geograft check is
 *  for. */
function generationRow(
  scan: SceneWearables | null,
  character: Pick<Character, 'genesis' | 'gender'>,
): SceneCheckRow {
  const figure = readable(scan) ? (scan.figures[0] ?? null) : null
  const detected = figure ? genesisFromFigureNode(figure.id) : null
  return {
    key: 'generation',
    label: 'Same generation',
    why:
      'Every scene of a character must use the same Genesis figure — the ROM and its artifacts ' +
      "are generated for the character's generation and can't apply to another skeleton.",
    ...(!readable(scan)
      ? { value: '—', state: 'unchecked' as const }
      : !detected
        ? { value: 'no Genesis figure found', state: 'unchecked' as const }
        : detected.genesis !== character.genesis
          ? {
              value: `${detected.genesis} — the character is ${character.genesis}`,
              state: 'fail' as const,
            }
          : detected.gender && detected.gender !== character.gender
            ? {
                value: `${detected.genesis} ${detected.gender} — the character is ${character.gender}`,
                state: 'fail' as const,
              }
            : { value: detected.genesis, state: 'ok' as const }),
  }
}

/** Exactly one character (one Genesis figure root). Zero recognizable figures
 *  = not a character scene — that's a fail, not an unknown. */
function figuresRow(scan: SceneWearables | null): SceneCheckRow {
  const count = readable(scan) ? scan.figures.length : 0
  return {
    key: 'figures',
    label: 'One character',
    why:
      'The studio generates one character per definition — the scene must hold exactly ONE ' +
      'Genesis figure. Hair, clothing and props are fine.',
    ...(!readable(scan)
      ? { value: '—', state: 'unchecked' as const }
      : count === 1
        ? { value: '1 character', state: 'ok' as const }
        : count === 0
          ? { value: 'no Genesis figure found', state: 'fail' as const }
          : { value: `${count} characters`, state: 'fail' as const }),
  }
}

/** Empty animation timeline: the generated ROM script fills the timeline
 *  itself, so existing keys past frame 0 collide with the ROM. Rest-pose keys
 *  at frame 0 (≤ 1 frame) are the normal saved-scene state. */
function timelineRow(scan: SceneWearables | null): SceneCheckRow {
  return {
    key: 'timeline',
    label: 'Empty timeline',
    why:
      'The generated ROM script fills the animation timeline itself — existing animation on ' +
      'the character would blend into the exported ROM frames. Save the scene without ' +
      'animation, then pick it again.',
    ...(!readable(scan)
      ? { value: '—', state: 'unchecked' as const }
      : scan.animationFrames <= 1
        ? { value: 'empty', state: 'ok' as const }
        : { value: `${scan.animationFrames} frames of animation`, state: 'fail' as const }),
  }
}

/** Same genital geograft (GP/DK) as the primary scene — a different graft set
 *  changes the figure's bones, and every scene must produce the primary's
 *  skeleton. Everything that isn't GP/DK is considered fine. */
function geograftRow(
  scan: SceneWearables | null,
  primaryScan: SceneWearables | null,
): SceneCheckRow {
  const mine = readable(scan) ? geograftKinds(scan) : null
  const reference = readable(primaryScan) ? geograftKinds(primaryScan) : null
  const sameGrafts =
    mine !== null &&
    reference !== null &&
    mine.size === reference.size &&
    [...mine].every((kind) => reference.has(kind))
  return {
    key: 'geograft',
    label: 'Same geograft (GP/DK)',
    why:
      'The GP/DK geografts add bones, and every scene must produce the primary scene’s ' +
      'skeleton. Gender can’t be read from a G9 scene directly — the geograft compare is ' +
      'its closest proxy. Different hair, clothing and props are exactly what extra scenes ' +
      'are for.',
    ...(mine === null
      ? { value: '—', state: 'unchecked' as const }
      : reference === null
        ? { value: "couldn't read the primary scene", state: 'unchecked' as const }
        : sameGrafts
          ? { value: `${geograftName(mine)} — same as the primary scene`, state: 'ok' as const }
          : {
              value: `${geograftName(mine)} — the primary scene has ${geograftName(reference)}`,
              state: 'fail' as const,
            }),
  }
}

/** The ADD-scene checks. `scan` is the candidate scene's read, `primaryScan`
 *  the primary scene's (the geograft reference) — pass null for either while
 *  it's still loading (rows read `unchecked`). */
export function sceneCompatRows({
  scan,
  primaryScan,
  character,
}: {
  scan: SceneWearables | null
  primaryScan: SceneWearables | null
  character: Pick<Character, 'genesis' | 'gender'>
}): Array<SceneCheckRow> {
  return [
    generationRow(scan, character),
    figuresRow(scan),
    timelineRow(scan),
    geograftRow(scan, primaryScan),
  ]
}

/** The CREATE-character checks — the subset needing no existing character:
 *  exactly one character in the scene, and an empty animation timeline. */
export function sceneCreateRows(scan: SceneWearables | null): Array<SceneCheckRow> {
  return [figuresRow(scan), timelineRow(scan)]
}

/** Any definitively failed check — gates the dialog's confirm actions
 *  (behind the "Add/Create anyway" escape). `unchecked` rows never block. */
export function sceneCompatFailed(rows: Array<SceneCheckRow>): boolean {
  return rows.some((row) => row.state === 'fail')
}
