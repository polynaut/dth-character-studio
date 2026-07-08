import { useEffect, useState } from 'react'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { InfoPopup } from '#/components/ui/info-popup.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'

import { cellInputClass } from './cells.tsx'
import { MorphNameCell } from './morph-name-cell.tsx'

import type { JcmMorphMod } from '@dth/rom'

type Drive = JcmMorphMod['positive'][number]
type Direction = 'positive' | 'negative'

const AXES = ['XRotate', 'YRotate', 'ZRotate'] as const

function emptyDrive(): Drive {
  return { morphName: '', range: { angle: { start: 0, end: 90 }, value: { start: 0, end: 1 } } }
}

/** A plain-number cell (commit on blur/Enter) — morph values and angles are RAW
 *  numbers here, unlike the pose grid's percent-scaled NumberCell. */
function RawNumberCell({
  value,
  title,
  onCommit,
}: {
  value: number
  title: string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      className={`${cellInputClass} w-16 text-right tabular-nums`}
      value={draft}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft)
        if (Number.isFinite(parsed)) onCommit(parsed)
        else setDraft(String(value))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** One rule's drives flattened for the grid: the model keeps two arrays
 *  (positive/negative rotation), the grid shows one list with a direction. */
function flatDrives(mod: JcmMorphMod): Array<{ dir: Direction; index: number; drive: Drive }> {
  return [
    ...mod.positive.map((drive, index) => ({ dir: 'positive' as const, index, drive })),
    ...mod.negative.map((drive, index) => ({ dir: 'negative' as const, index, drive })),
  ]
}

/**
 * "Modify JCM frames" — a grid UI over `character.jcmMorphMods` (formerly a raw
 * JSON textarea in Advanced Options). Each RULE watches one bone rotation axis
 * across the JCM ROM; its DRIVES set extra morphs proportionally to the keyed
 * angle: the angle range maps linearly onto the value range, split by rotation
 * direction. Collapsed by default — this is an optional power feature.
 */
export function JcmModsGrid({
  mods,
  onChange,
}: {
  mods: Array<JcmMorphMod>
  onChange: (mods: Array<JcmMorphMod>) => void
}) {
  const [openGrid, setOpenGrid] = useState(false)

  function patchMod(i: number, patch: Partial<JcmMorphMod>) {
    onChange(mods.map((mod, mi) => (mi === i ? { ...mod, ...patch } : mod)))
  }
  function patchDrive(i: number, dir: Direction, di: number, patch: Partial<Drive>) {
    const mod = mods[i]
    patchMod(i, {
      [dir]: mod[dir].map((drive, idx) => (idx === di ? { ...drive, ...patch } : drive)),
    })
  }
  function patchRange(
    i: number,
    dir: Direction,
    di: number,
    key: 'angle' | 'value',
    bound: 'start' | 'end',
    num: number,
  ) {
    const range = mods[i][dir][di].range
    patchDrive(i, dir, di, { range: { ...range, [key]: { ...range[key], [bound]: num } } })
  }
  function moveDrive(i: number, from: Direction, di: number, to: Direction) {
    if (from === to) return
    const mod = mods[i]
    const drive = mod[from][di]
    patchMod(i, {
      [from]: mod[from].filter((_, idx) => idx !== di),
      [to]: [...mod[to], drive],
    } as Partial<JcmMorphMod>)
  }

  const driveCount = mods.reduce((sum, m) => sum + m.positive.length + m.negative.length, 0)

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm select-none"
        onClick={() => setOpenGrid((o) => !o)}
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${openGrid ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">Modify JCM frames</span>
        <InfoPopup label="Modify JCM frames — more information" className="-my-1">
          Drive <strong>additional morphs</strong> along the pre-defined JCM poses: a rule
          watches one bone's rotation axis across the JCM ROM and sets its morphs
          proportionally to the keyed angle — the angle range maps linearly onto the value
          range, separately for positive and negative rotation. Example: add a custom
          calf-flex morph on top of the shipped knee-bend poses.
        </InfoPopup>
        {mods.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {mods.length} rule{mods.length === 1 ? '' : 's'} · {driveCount} morph
            {driveCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">optional</span>
      </button>

      {openGrid && (
        <div className="space-y-3 border-t px-3 py-3">
          {mods.map((mod, i) => (
            <div key={i} className="rounded-md border">
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
                <input
                  className={`${cellInputClass} w-44`}
                  value={mod.boneLabel}
                  placeholder="bone, e.g. Left Thigh Bend"
                  title="The bone whose rotation keys drive this rule (label or internal name)"
                  onChange={(e) => patchMod(i, { boneLabel: e.target.value })}
                />
                <Select value={mod.axis} onValueChange={(axis) => patchMod(i, { axis })}>
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AXES.map((axis) => (
                      <SelectItem key={axis} value={axis}>
                        {axis}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  title="Remove this rule"
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() => onChange(mods.filter((_, mi) => mi !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <div className="p-2">
                {flatDrives(mod).length > 0 && (
                  <table className="w-full border-separate border-spacing-y-1 text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="font-medium">Rotation</th>
                        <th className="font-medium">Morph name</th>
                        <th className="text-right font-medium">Angle from</th>
                        <th className="text-right font-medium">Angle to</th>
                        <th className="text-right font-medium">Value from</th>
                        <th className="text-right font-medium">Value to</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {flatDrives(mod).map(({ dir, index, drive }) => (
                        <tr key={`${dir}-${index}`}>
                          <td className="pr-2">
                            <Select
                              value={dir}
                              onValueChange={(to) => moveDrive(i, dir, index, to as Direction)}
                            >
                              <SelectTrigger size="sm" className="w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="positive">positive</SelectItem>
                                <SelectItem value="negative">negative</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="w-full pr-2">
                            <MorphNameCell
                              value={drive.morphName}
                              placeholder="body_bs_CalfFlex"
                              onCommit={(morphName) => patchDrive(i, dir, index, { morphName })}
                              // The runtime resolves these on the figure root — only
                              // the internal name matters, the node tag is informative.
                              onPick={(e) => patchDrive(i, dir, index, { morphName: e.name })}
                            />
                          </td>
                          <td className="pr-1 text-right">
                            <RawNumberCell
                              value={drive.range.angle.start}
                              title="Bone angle (degrees) where the morph starts ramping"
                              onCommit={(n) => patchRange(i, dir, index, 'angle', 'start', n)}
                            />
                          </td>
                          <td className="pr-2 text-right">
                            <RawNumberCell
                              value={drive.range.angle.end}
                              title="Bone angle (degrees) where the morph reaches its end value"
                              onCommit={(n) => patchRange(i, dir, index, 'angle', 'end', n)}
                            />
                          </td>
                          <td className="pr-1 text-right">
                            <RawNumberCell
                              value={drive.range.value.start}
                              title="Morph value at the start angle (raw, 1 = 100%)"
                              onCommit={(n) => patchRange(i, dir, index, 'value', 'start', n)}
                            />
                          </td>
                          <td className="pr-2 text-right">
                            <RawNumberCell
                              value={drive.range.value.end}
                              title="Morph value at the end angle (raw, 1 = 100%)"
                              onCommit={(n) => patchRange(i, dir, index, 'value', 'end', n)}
                            />
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              title="Remove this morph drive"
                              aria-label={`Remove drive ${drive.morphName || index + 1}`}
                              onClick={() =>
                                patchMod(i, {
                                  [dir]: mod[dir].filter((_, idx) => idx !== index),
                                } as Partial<JcmMorphMod>)
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => patchMod(i, { positive: [...mod.positive, emptyDrive()] })}
                >
                  <Plus /> Add morph drive
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([...mods, { boneLabel: '', axis: 'XRotate', positive: [], negative: [] }])
            }
          >
            <Plus /> Add rule
          </Button>
        </div>
      )}
    </div>
  )
}
