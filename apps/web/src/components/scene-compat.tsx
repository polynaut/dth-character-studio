import { Link } from '@tanstack/react-router'
import { CircleCheck, CircleDashed, TriangleAlert } from 'lucide-react'

import { Label, Switch } from '@dth/ui'

import { sceneCompatFailed, sceneCompatHardFailed } from '#/lib/scene-compat.ts'

import type { SceneCheckRow, SceneCheckState } from '#/lib/scene-compat.ts'

/**
 * The "Validation" block of the add-scene / create-character dialogs: the
 * checks (see `lib/scene-compat.ts`) as a single-line checklist — state icon +
 * check name, with a detail after a dash only when it adds something (the
 * detected generation/geograft, or what a failed check actually found). A
 * FAILED row carries the what/why on its tooltip (`row.why`); passing rows
 * stay quiet — no permanent hint paragraph. When a check failed, the escape
 * switch appears (detection can't know every scene, so a definite fail blocks
 * the confirm but never bricks the flow).
 */
export function SceneValidationTable({
  rows,
  loading,
  force,
  onForceChange,
  forceLabel,
  projectId,
  currentCharacterId,
}: {
  rows: Array<SceneCheckRow>
  /** The scene reads are still in flight — every row shows "checking…". */
  loading: boolean
  /** The escape switch: proceed despite failed checks (the caller gates its confirm on it). */
  force: boolean
  onForceChange: (force: boolean) => void
  /** The escape switch's label, e.g. "Add anyway — …" / "Create anyway — …". */
  forceLabel: string
  /** When set, an "already linked" fail links the owning character's name
   *  straight to that character's page in this project. */
  projectId?: string
  /** The character whose page the dialog is open ON (the add-scene flow) — an
   *  "already linked" fail owned by this very character renders WITHOUT the
   *  link (it would just point at the page you're already on). */
  currentCharacterId?: string
}) {
  const failed = !loading && sceneCompatFailed(rows)
  // A failed HARD check (scene already linked) has no escape — the "anyway"
  // switch would flip without unblocking anything, so it isn't shown.
  const hardFailed = !loading && sceneCompatHardFailed(rows)
  const rowClass = (state: SceneCheckState) =>
    state === 'ok'
      ? 'text-emerald-600 dark:text-emerald-500'
      : state === 'fail'
        ? 'text-red-600 dark:text-red-500'
        : 'text-muted-foreground'
  return (
    <div>
      <Label className="mb-1 block">Validation</Label>
      <ul className="divide-y overflow-hidden rounded-lg border text-sm">
        {rows.map((row) => {
          const rowFailed = !loading && row.state === 'fail'
          const detail = loading ? 'checking…' : row.value
          return (
            // A failed row explains itself on hover — what the check demands
            // and why (no permanent hint paragraph under the list).
            <li
              key={row.key}
              title={rowFailed ? row.why : undefined}
              className={`flex items-start gap-1.5 px-3 py-1.5 font-medium ${
                loading ? 'text-muted-foreground' : rowClass(row.state)
              }${rowFailed ? ' cursor-help' : ''}`}
            >
              {!loading && row.state === 'ok' ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0" />
              ) : rowFailed ? (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0" />
              )}
              {/* A FAILED row reads as ONE short sentence (the "label — detail"
                  split read as two disjoint fragments); the "already linked"
                  fail links the owning character's name to its page. */}
              {rowFailed ? (
                row.ownerId && projectId && row.ownerId !== currentCharacterId ? (
                  <span>
                    This scene is already linked to{' '}
                    <Link
                      to="/projects/$projectId/characters/$characterId"
                      params={{ projectId, characterId: row.ownerId }}
                      className="font-medium underline underline-offset-2 hover:text-foreground"
                    >
                      “{row.ownerName}”
                    </Link>
                    .
                  </span>
                ) : (
                  <span>{row.problem ?? `${row.label} — ${row.value}`}</span>
                )
              ) : (
                <>
                  <span>{row.label}</span>
                  {detail && (
                    <span className="font-normal">
                      — <span>{detail}</span>
                    </span>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
      {failed && !hardFailed && (
        <label className="mt-2 flex items-center gap-2 text-sm text-destructive">
          <Switch checked={force} onCheckedChange={onForceChange} />
          {forceLabel}
        </label>
      )}
    </div>
  )
}
