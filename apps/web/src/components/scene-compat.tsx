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
}: {
  rows: Array<SceneCheckRow>
  /** The scene reads are still in flight — every row shows "checking…". */
  loading: boolean
  /** The escape switch: proceed despite failed checks (the caller gates its confirm on it). */
  force: boolean
  onForceChange: (force: boolean) => void
  /** The escape switch's label, e.g. "Add anyway — …" / "Create anyway — …". */
  forceLabel: string
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
              <span>{row.label}</span>
              {detail && (
                <span className="font-normal">
                  — <span>{detail}</span>
                </span>
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
