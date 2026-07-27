import { CircleCheck, TriangleAlert } from 'lucide-react'

import { Label, Switch } from '@dth/ui'
import { genesisFromFigureNode } from '@dth/rom'

import type { SceneWearables } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

/**
 * Compatibility checks for ADDING an extra Daz scene to an existing character.
 * Every scene of a character generates against the SAME ROM timeline and must
 * produce the primary scene's skeleton — so a candidate scene has to match the
 * character's Genesis generation, hold exactly one character, keep its
 * animation timeline empty (the generated ROM script fills it), and carry the
 * same genital geograft (GP/DK) as the primary scene. Gender itself can't be
 * read from a G9 scene (the figure is gender-neutral) — the geograft compare is
 * its closest proxy. Hair, clothing and props may differ freely: outfit
 * variants are exactly what extra scenes are for.
 *
 * The checks are pure functions over `scene_wearables` reads so they're
 * unit-testable; {@link SceneValidationTable} renders them in the add dialog,
 * styled like the Tools → Refresh assets version table.
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

function geograftName(kinds: Set<GeograftKind>): string {
  if (kinds.size === 0) return 'none'
  return [...kinds].map((kind) => GEOGRAFT_LABELS[kind]).join(' + ')
}

/** Evaluate the add-scene checks. `scan` is the candidate scene's read,
 *  `primaryScan` the primary scene's (the geograft reference) — pass null for
 *  either while it's still loading (rows read `unchecked`). */
export function sceneCompatRows({
  scan,
  primaryScan,
  character,
}: {
  scan: SceneWearables | null
  primaryScan: SceneWearables | null
  character: Pick<Character, 'genesis' | 'gender'>
}): Array<SceneCheckRow> {
  const readable = scan !== null && scan.error === ''
  const rows: Array<SceneCheckRow> = []

  // 1) Same Genesis generation. The figure id also carries the gender for the
  // gendered generations (Genesis8Female, …) — compare that too when present;
  // the G9 id is gender-neutral, which is what the geograft check is for.
  const figure = readable ? (scan.figures[0] ?? null) : null
  const detected = figure ? genesisFromFigureNode(figure.id) : null
  rows.push({
    key: 'generation',
    label: 'Same generation',
    ...(!readable
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
  })

  // 2) Exactly one character (one Genesis figure root). Zero recognizable
  // figures = not a character scene — that's a fail, not an unknown.
  const count = readable ? scan.figures.length : 0
  rows.push({
    key: 'figures',
    label: 'One character',
    ...(!readable
      ? { value: '—', state: 'unchecked' as const }
      : count === 1
        ? { value: '1 character', state: 'ok' as const }
        : count === 0
          ? { value: 'no Genesis figure found', state: 'fail' as const }
          : { value: `${count} characters`, state: 'fail' as const }),
  })

  // 3) Empty animation timeline: the generated ROM script fills the timeline
  // itself, so existing keys past frame 0 collide with the ROM. Rest-pose keys
  // at frame 0 (≤ 1 frame) are the normal saved-scene state.
  rows.push({
    key: 'timeline',
    label: 'Empty timeline',
    ...(!readable
      ? { value: '—', state: 'unchecked' as const }
      : scan.animationFrames <= 1
        ? { value: 'empty', state: 'ok' as const }
        : { value: `${scan.animationFrames} frames of animation`, state: 'fail' as const }),
  })

  // 4) Same genital geograft (GP/DK) as the primary scene — a different graft
  // set changes the figure's bones, and every scene must produce the primary's
  // skeleton. Everything that isn't GP/DK is considered fine.
  const primaryReadable = primaryScan !== null && primaryScan.error === ''
  const mine = readable ? geograftKinds(scan) : null
  const reference = primaryReadable ? geograftKinds(primaryScan) : null
  const sameGrafts =
    mine !== null &&
    reference !== null &&
    mine.size === reference.size &&
    [...mine].every((kind) => reference.has(kind))
  rows.push({
    key: 'geograft',
    label: 'Same geograft (GP/DK)',
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
  })

  return rows
}

/** Any definitively failed check — gates the add dialog's confirm actions
 *  (behind the "Add anyway" escape). `unchecked` rows never block. */
export function sceneCompatFailed(rows: Array<SceneCheckRow>): boolean {
  return rows.some((row) => row.state === 'fail')
}

/**
 * The "Validation" block of the add-scene dialog: the checks as a compact
 * label/state table (same look as the Tools → Refresh assets version table),
 * the not-checkable rules as a footnote, and — only when a check failed — the
 * "Add anyway" escape switch (detection can't know every scene, so a definite
 * fail blocks the confirm but never bricks the flow).
 */
export function SceneValidationTable({
  rows,
  loading,
  force,
  onForceChange,
}: {
  rows: Array<SceneCheckRow>
  /** The scene reads are still in flight — every row shows "checking…". */
  loading: boolean
  /** "Add anyway": proceed despite failed checks (the caller gates its confirm on it). */
  force: boolean
  onForceChange: (force: boolean) => void
}) {
  const failed = !loading && sceneCompatFailed(rows)
  const valueClass = (state: SceneCheckState) =>
    state === 'ok'
      ? 'text-emerald-600 dark:text-emerald-500'
      : state === 'fail'
        ? 'text-red-600 dark:text-red-500'
        : 'text-muted-foreground'
  return (
    <div>
      <Label className="mb-1 block">Validation</Label>
      <table className="w-full overflow-hidden rounded-lg border text-sm">
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.key}>
              <th className="w-2/5 px-3 py-1.5 text-left font-normal whitespace-nowrap text-muted-foreground">
                {row.label}
              </th>
              <td className="px-3 py-1.5">
                <span
                  className={`inline-flex items-start gap-1.5 font-medium ${
                    loading ? 'text-muted-foreground' : valueClass(row.state)
                  }`}
                >
                  {!loading && row.state === 'ok' && (
                    <CircleCheck className="mt-0.5 size-4 shrink-0" />
                  )}
                  {!loading && row.state === 'fail' && (
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  )}
                  {loading ? 'checking…' : row.value}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-xs text-muted-foreground">
        The scene must contain the same character — gender can't be checked directly, the geograft
        compare is its closest proxy. Different hair, clothing and props are exactly what extra
        scenes are for.
      </p>
      {failed && (
        <label className="mt-2 flex items-center gap-2 text-sm text-destructive">
          <Switch checked={force} onCheckedChange={onForceChange} />
          Add anyway — a failed check usually means the scene's ROM won't match
        </label>
      )}
    </div>
  )
}
