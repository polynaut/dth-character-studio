import { useState } from 'react'

import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'

import { Button, InfoPopup } from '@dth/ui'
import {
  ART_DIRECTION_CATALOG,
  genRomIncludes,
  genRomStartFrame,
  newId,
} from '@dth/rom'

import type {
  ArtDirectionFrame,
  Gender,
  Morph,
  PresetFrames,
  RomSectionConfig,
  RomSections as RomSectionsModel,
} from '@dth/rom'

import { NumberCell, TextCell } from './cells.tsx'
import { MorphNameCell } from './morph-name-cell.tsx'

/**
 * Per-character art direction for the pre-made GP/DK ROM blocks: the
 * catalog's art-directable frames, each with an editable morph list.
 * Frames without morphs are not stored and not generated.
 */
export function ArtDirectionEditor({
  config,
  sections,
  gender,
  presetFrames,
  onChange,
}: {
  config: RomSectionConfig
  sections: RomSectionsModel
  gender: Gender
  presetFrames: PresetFrames | null
  onChange: (artDirection: Array<ArtDirectionFrame>) => void
}) {
  const roms = genRomIncludes(gender, config.presetAssets)
  const activeRoms = ([['gp', 'Golden Palace'], ['dk', 'Dicktator']] as const).filter(
    ([rom]) => roms[rom],
  )

  function entryFor(rom: 'gp' | 'dk', frame: number, name: string): ArtDirectionFrame {
    return (
      config.artDirection.find((e) => e.rom === rom && e.frame === frame) ?? {
        id: newId(),
        rom,
        frame,
        name,
        morphs: [],
      }
    )
  }

  function commit(entry: ArtDirectionFrame) {
    const rest = config.artDirection.filter(
      (e) => !(e.rom === entry.rom && e.frame === entry.frame),
    )
    // Frames without morphs are dropped — nothing to generate for them.
    onChange(entry.morphs.length > 0 ? [...rest, entry] : rest)
  }

  if (activeRoms.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="flex w-fit items-center gap-1 text-sm font-medium">
        Art direction
        <InfoPopup label="Art direction — more information">
          Morph values stamped onto frames inside the pre-made ROM after loading — generated as a
          per-character art direction JSON. Frames marked <em>required</em> ship empty in the
          preset: without morphs here their generated morph does nothing.
        </InfoPopup>
      </p>
      {activeRoms.map(([rom, label]) => {
        const romStart = presetFrames ? genRomStartFrame(sections, gender, rom, presetFrames) : null
        return (
        <div key={rom} className="space-y-1">
          {activeRoms.length > 1 && <p className="text-sm font-medium">{label}</p>}
          {ART_DIRECTION_CATALOG[rom].map((catalogFrame) => {
            const entry = entryFor(rom, catalogFrame.frame, catalogFrame.name)
            return (
              <ArtDirectionFrameRow
                key={`${rom}-${catalogFrame.frame}`}
                catalogFrame={catalogFrame}
                absoluteFrame={romStart === null ? null : romStart + catalogFrame.frame}
                entry={entry}
                onCommit={commit}
              />
            )
          })}
        </div>
        )
      })}
    </div>
  )
}

function ArtDirectionFrameRow({
  catalogFrame,
  absoluteFrame,
  entry,
  onCommit,
}: {
  catalogFrame: { frame: number; name: string; required: boolean; note?: string }
  /** Absolute timeline frame, or null when the preset lengths couldn't be measured. */
  absoluteFrame: number | null
  entry: ArtDirectionFrame
  onCommit: (entry: ArtDirectionFrame) => void
}) {
  const [open, setOpen] = useState(false)
  const hasMorphs = entry.morphs.length > 0

  function patchMorph(index: number, patch: Partial<Morph>) {
    onCommit({
      ...entry,
      morphs: entry.morphs.map((m, mi) => (mi === index ? { ...m, ...patch } : m)),
    })
  }

  return (
    <div className="rounded-md border">
      {/* A real accordion button (was a click-only div) — focusable and
          Enter/Space-operable, state announced via aria-expanded. Every child is
          a plain span, so there's no nested-interactive concern here. */}
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left select-none"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="w-12 text-right font-mono text-xs text-muted-foreground tabular-nums">
          {absoluteFrame ?? '—'}
        </span>
        <span className="text-sm">{catalogFrame.name}</span>
        {catalogFrame.required && !hasMorphs && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            required — empty in the preset ROM
          </span>
        )}
        {catalogFrame.note && !catalogFrame.required && (
          <span className="text-xs text-muted-foreground">{catalogFrame.note}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {hasMorphs ? `${entry.morphs.length} ${entry.morphs.length === 1 ? 'morph' : 'morphs'}` : 'preset default'}
        </span>
      </button>
      {open && (
        <div className="space-y-1 border-t px-2 py-2">
          {entry.morphs.map((morph, index) => (
            <div key={morph.id} className="flex items-center gap-2">
              <div className="w-44">
                <TextCell
                  value={morph.node}
                  placeholder="GoldenPalace_G9"
                  onCommit={(node) => patchMorph(index, { node })}
                />
              </div>
              <div className="flex-1">
                <MorphNameCell
                  value={morph.prop}
                  placeholder="GP_Anus_Open"
                  onCommit={(prop) => patchMorph(index, { prop })}
                  onPick={(e) => patchMorph(index, { prop: e.name, node: e.node })}
                />
              </div>
              <NumberCell
                value={morph.value}
                onCommit={(value) => patchMorph(index, { value })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 border border-input"
                title="Remove this morph"
                onClick={() =>
                  onCommit({ ...entry, morphs: entry.morphs.filter((_, mi) => mi !== index) })
                }
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              onCommit({
                ...entry,
                morphs: [
                  ...entry.morphs,
                  {
                    id: newId(),
                    node: entry.morphs[entry.morphs.length - 1]?.node ??
                      (entry.rom === 'gp' ? 'GoldenPalace_G9' : 'DicktatorG9'),
                    prop: '',
                    value: 1,
                  },
                ],
              })
            }
          >
            <Plus className="size-3.5" /> Add morph
          </Button>
        </div>
      )}
    </div>
  )
}
