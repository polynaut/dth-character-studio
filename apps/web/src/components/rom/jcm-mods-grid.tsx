import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, FlipHorizontal2, Plus, Trash2 } from 'lucide-react'

import { Button, InfoPopup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dth/ui'

import { cellInputClass, pctToValue, valueToPct } from './cells.tsx'
import { MorphNameCell } from './morph-name-cell.tsx'

import { newId } from '@dth/rom'
import type { JcmMorphMod } from '@dth/rom'

type Drive = JcmMorphMod['drives'][number]

const AXES = ['XRotate', 'YRotate', 'ZRotate'] as const

/** A JCM drive corrects a bone bending from rest in ONE direction, so its angle
 *  range must have a definite sign — flag a zero range (no direction) or one that
 *  crosses zero (ambiguous). Direction is otherwise read from the range's sign. */
function angleRangeInvalid(angle: { start: number; end: number }): boolean {
  const { start, end } = angle
  if (start === 0 && end === 0) return true
  return start !== 0 && end !== 0 && Math.sign(start) !== Math.sign(end)
}

function emptyDrive(): Drive {
  return { id: newId(), morphName: '', range: { angle: { start: 0, end: 90 }, value: { start: 0, end: 1 } } }
}

/** Flip a case-preserving Left/Right word. */
function flipWord(word: string): string {
  const lower = word.toLowerCase()
  const to = lower === 'left' ? 'right' : lower === 'right' ? 'left' : ''
  if (!to) return word
  if (word === word.toUpperCase()) return to.toUpperCase()
  if (word[0] === word[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1)
  return to
}

/**
 * Swap the left/right side token in a bone label or morph name, for the Mirror
 * feature — e.g. "Left Thigh Bend" → "Right Thigh Bend", "Hip Adjuster L" →
 * "Hip Adjuster R", "body_l_calf" → "body_r_calf". A side-less name (a shared
 * centre controller like "!Hip Bend Controller") is returned unchanged. Both
 * `.replace` passes target disjoint forms (Left/Right words vs a separator-led
 * single L/R), so a mixed name can't cancel itself out. No angle/value change.
 */
export function mirrorSide(name: string): string {
  return name
    .replace(/left|right/gi, flipWord)
    // A single side letter after a separator: "_l", "-r", ".L", " R" — but not
    // the start of a longer word ("_lower"), guarded by the trailing lookahead.
    .replace(/([_\-. ])([lr])(?![a-z])/gi, (_m, sep: string, side: string) =>
      sep + (side.toLowerCase() === 'l' ? (side === 'l' ? 'r' : 'R') : side === 'r' ? 'l' : 'L'),
    )
}

function mirrorDrive(drive: Drive): Drive {
  return {
    // A fresh id — the mirrored copy is a NEW row, so it must not reuse the
    // source's id (that would collide as a React key and swap focused inputs).
    id: newId(),
    morphName: mirrorSide(drive.morphName),
    range: {
      angle: { start: drive.range.angle.start, end: drive.range.angle.end },
      value: { start: drive.range.value.start, end: drive.range.value.end },
    },
  }
}

/** A deep copy of a rule with every side token flipped — the "other side". */
export function mirrorMod(mod: JcmMorphMod): JcmMorphMod {
  return {
    ...mod,
    id: newId(), // new row → new id (see mirrorDrive)
    boneLabel: mirrorSide(mod.boneLabel),
    drives: mod.drives.map(mirrorDrive),
  }
}

/** A plain-number cell (commit on blur/Enter) — morph values and angles are RAW
 *  numbers here, unlike the pose grid's percent-scaled NumberCell. */
function RawNumberCell({
  value,
  title,
  onCommit,
  percent,
  invalid,
}: {
  value: number
  title: string
  onCommit: (value: number) => void
  /** Show/edit the 0–1 morph value as a Daz-style percentage (0–100%), like the
   *  ROM pose value cells. Angle cells (degrees) stay raw. */
  percent?: boolean
  /** Flag the field (red border) — used for an ambiguous angle range. */
  invalid?: boolean
}) {
  const format = useCallback((v: number) => (percent ? valueToPct(v) : String(v)), [percent])
  const [draft, setDraft] = useState(() => format(value))
  useEffect(() => setDraft(format(value)), [value, format])
  const input = (
    <input
      className={`${cellInputClass} w-16 text-right tabular-nums ${percent ? 'pr-5' : ''} ${
        invalid ? 'border-destructive bg-destructive/10 hover:border-destructive' : ''
      }`}
      value={draft}
      title={title}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft)
        if (!Number.isFinite(parsed)) {
          setDraft(format(value))
          return
        }
        onCommit(percent ? pctToValue(parsed) : parsed)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
  if (!percent) return input
  return (
    <span className="relative inline-block">
      {input}
      <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-xs text-muted-foreground">
        %
      </span>
    </span>
  )
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
  function patchDrive(i: number, di: number, patch: Partial<Drive>) {
    patchMod(i, {
      drives: mods[i].drives.map((drive, idx) => (idx === di ? { ...drive, ...patch } : drive)),
    })
  }
  function patchRange(
    i: number,
    di: number,
    key: 'angle' | 'value',
    bound: 'start' | 'end',
    num: number,
  ) {
    const range = mods[i].drives[di].range
    patchDrive(i, di, { range: { ...range, [key]: { ...range[key], [bound]: num } } })
  }

  const driveCount = mods.reduce((sum, m) => sum + m.drives.length, 0)

  return (
    <div className="rounded-md border">
      {/* A div, not a <button>: the InfoPopup inside is itself a button, and
          button-in-button is invalid HTML (React warns, assistive tech
          misreads it). Same pattern as the section title rows above. */}
      <div
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm select-none"
        onClick={() => setOpenGrid((o) => !o)}
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${openGrid ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">Modify JCM frames</span>
        <span onClick={(e) => e.stopPropagation()}>
          <InfoPopup label="Modify JCM frames — more information" className="-my-1">
            Drive <strong>additional morphs</strong> along the pre-defined JCM poses: a rule
            watches one bone's rotation axis across the JCM ROM and sets its morphs
            proportionally to the keyed angle — the angle range maps linearly onto the value
            range. The <strong>direction</strong> a drive corrects is read from its angle
            range's sign (e.g. <em>Angle to</em> −115 = the negative bend), so a rule can hold
            drives for both bend directions at once. Example: add a custom calf-flex morph on
            top of the shipped knee-bend poses.
          </InfoPopup>
        </span>
        {mods.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {mods.length} rule{mods.length === 1 ? '' : 's'} · {driveCount} morph
            {driveCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">optional</span>
      </div>

      {openGrid && (
        <div className="space-y-3 border-t px-3 py-3">
          {mods.map((mod, i) => (
            <div key={mod.id} className="rounded-md border">
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
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  title="Mirror to the other side — copies this rule, swapping Left/Right and L/R side tokens in the bone and morph names"
                  aria-label={`Mirror rule ${i + 1} to the other side`}
                  onClick={() =>
                    onChange([...mods.slice(0, i + 1), mirrorMod(mod), ...mods.slice(i + 1)])
                  }
                >
                  <FlipHorizontal2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove this rule"
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() => onChange(mods.filter((_, mi) => mi !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <div className="p-2">
                {mod.drives.length > 0 && (
                  <table className="w-full border-separate border-spacing-y-1 text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="font-medium">Morph name</th>
                        <th className="text-right font-medium">Angle from</th>
                        <th className="text-right font-medium">Angle to</th>
                        <th className="text-right font-medium">Value from</th>
                        <th className="text-right font-medium">Value to</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {mod.drives.map((drive, index) => {
                        const angleBad = angleRangeInvalid(drive.range.angle)
                        return (
                          <tr key={drive.id}>
                            <td className="w-full pr-2">
                              <MorphNameCell
                                value={drive.morphName}
                                placeholder="body_bs_CalfFlex"
                                onCommit={(morphName) => patchDrive(i, index, { morphName })}
                                // The runtime resolves these on the figure root — only
                                // the internal name matters, the node tag is informative.
                                onPick={(e) => patchDrive(i, index, { morphName: e.name })}
                              />
                            </td>
                            <td className="pr-1 text-right">
                              <RawNumberCell
                                value={drive.range.angle.start}
                                invalid={angleBad}
                                title="Bone angle (degrees) where the morph starts ramping"
                                onCommit={(n) => patchRange(i, index, 'angle', 'start', n)}
                              />
                            </td>
                            <td className="pr-2 text-right">
                              <RawNumberCell
                                value={drive.range.angle.end}
                                invalid={angleBad}
                                title={
                                  angleBad
                                    ? 'The angle range needs one direction — it must not be zero or cross zero (its sign picks the bend direction)'
                                    : 'Bone angle (degrees) where the morph reaches its end value — its sign is the bend direction'
                                }
                                onCommit={(n) => patchRange(i, index, 'angle', 'end', n)}
                              />
                            </td>
                            <td className="pr-1 text-right">
                              <RawNumberCell
                                value={drive.range.value.start}
                                percent
                                title="Morph value at the start angle (100% = full)"
                                onCommit={(n) => patchRange(i, index, 'value', 'start', n)}
                              />
                            </td>
                            <td className="pr-2 text-right">
                              <RawNumberCell
                                value={drive.range.value.end}
                                percent
                                title="Morph value at the end angle (100% = full)"
                                onCommit={(n) => patchRange(i, index, 'value', 'end', n)}
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
                                  patchMod(i, { drives: mod.drives.filter((_, idx) => idx !== index) })
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => patchMod(i, { drives: [...mod.drives, emptyDrive()] })}
                >
                  <Plus /> Add morph drive
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange([...mods, { id: newId(), boneLabel: '', axis: 'XRotate', drives: [] }])}
          >
            <Plus /> Add rule
          </Button>
        </div>
      )}
    </div>
  )
}
