import { CircleCheck, TriangleAlert } from 'lucide-react'

import type { ReactNode } from 'react'

import { Label, Switch } from '@dth/ui'

import { sceneCompatFailed } from '#/lib/scene-compat.ts'

import type { SceneCheckRow, SceneCheckState } from '#/lib/scene-compat.ts'

/**
 * The "Validation" block of the add-scene / create-character dialogs: the
 * checks (see `lib/scene-compat.ts`) as a compact label/state table — same
 * look as the Tools → Refresh assets version table — plus an optional footnote
 * for the not-checkable rules, and, only when a check failed, an escape switch
 * (detection can't know every scene, so a definite fail blocks the confirm but
 * never bricks the flow).
 */
export function SceneValidationTable({
  rows,
  loading,
  force,
  onForceChange,
  forceLabel,
  footnote,
}: {
  rows: Array<SceneCheckRow>
  /** The scene reads are still in flight — every row shows "checking…". */
  loading: boolean
  /** The escape switch: proceed despite failed checks (the caller gates its confirm on it). */
  force: boolean
  onForceChange: (force: boolean) => void
  /** The escape switch's label, e.g. "Add anyway — …" / "Create anyway — …". */
  forceLabel: string
  /** Muted line under the table for the rules the checks can't cover. */
  footnote?: ReactNode
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
      {footnote ? <p className="mt-1.5 text-xs text-muted-foreground">{footnote}</p> : null}
      {failed && (
        <label className="mt-2 flex items-center gap-2 text-sm text-destructive">
          <Switch checked={force} onCheckedChange={onForceChange} />
          {forceLabel}
        </label>
      )}
    </div>
  )
}
