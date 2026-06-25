import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight, Copy, FolderOpen, GripVertical, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { useNavigate } from '@tanstack/react-router'

import { pickCsvPath, pickDufPath, pickFbxPath } from '#/lib/desktop.ts'
import { importPosesFromCsv } from '#/lib/rom/api.ts'

import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import type { Row } from '@tanstack/react-table'

import { Button } from '#/components/ui/button.tsx'
import { ConfigError } from '#/components/config-error.tsx'
import { CsvImportDialog } from '#/components/csv-import-dialog.tsx'
import { InfoPopup } from '#/components/ui/info-popup.tsx'
import { Input } from '#/components/ui/input.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import {
  ART_DIRECTION_CATALOG,
  BONE_LABEL_SECTIONS,
  CALC_FROM_SECTIONS,
  GROUPED_SECTIONS,
  METHOD_SECTIONS,
  REFERENCE_FBX_SECTIONS,
  ROM_SECTIONS,
  SECTION_LABELS,
  SECTION_MODES,
  genAssetGender,
  genDefaultNode,
  genRomIncludes,
  genRomStartFrame,
  mirrorGroup,
  newId,
  presetFrameCount,
} from '@dth/rom'

import type { ColumnDef } from '@tanstack/react-table'
import type {
  ArtDirectionFrame,
  CalculateFrom,
  DthPoseAsset,
  Gender,
  GenerationMethod,
  GenesisVersion,
  GroupSuffix,
  Morph,
  PresetFrames,
  RomGroup,
  RomPose,
  RomSection,
  RomSectionConfig,
  RomSections as RomSectionsModel,
  SectionMode,
} from '@dth/rom'

/**
 * "Import from CSV" plus an info popup explaining where the CSV comes from:
 * DthScanFrames.dsa from the DazToHue-Scripts repo (installable in Tools), which
 * exports the full morph list of an open Daz scene as a CSV importable here.
 */
function ImportCsvButton({ onImport }: { onImport: () => void }) {
  const navigate = useNavigate()
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="outline" size="sm" onClick={onImport}>
        <Upload /> Import from CSV
      </Button>
      <InfoPopup label="Import from CSV — how to produce the CSV">
        Import a DAZ morph CSV — each row becomes a pose. Generate it with{' '}
        <strong>DthScanFrames.dsa</strong>, which exports the full morph list of an open Daz scene.
        Install it from{' '}
        <a
          href="/tools"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void navigate({ to: '/tools', search: { tab: 'daztohue' } })
          }}
        >
          Tools → DazToHue-Scripts
        </a>
        , run it in Daz Studio on your scene, then import the CSV here.
      </InfoPopup>
    </span>
  )
}

/**
 * Accordion over the eight pose asset categories — all collapsed initially
 * so the whole ROM can be scanned at a glance. Preset sections show a simple
 * form (they compile into the DthWorkflow include flags); custom sections
 * hold the group/pose grid (they compile into the extra-JSON frames and the
 * PoseAsset CSV).
 */

interface PoseAssetCatalog {
  folder: string
  assets: Array<DthPoseAsset>
  error: string | null
}

interface RomSectionsProps {
  sections: RomSectionsModel
  genesis: GenesisVersion
  gender: Gender
  skinning: 'linear' | 'dqs'
  catalog: PoseAssetCatalog
  /** Measured preset-block frame lengths; null while unmeasurable (assets unread). */
  presetFrames: PresetFrames | null
  onChange: (sections: RomSectionsModel) => void
}

const PRESET_DESCRIPTIONS: Partial<Record<RomSection, string>> = {
  RET: 'Covered by the pre-defined DTH base ROM (RestPose, UnrealPose, TPose, …). Loads together with the Joint Corrective base ROM.',
  JCM: 'Pre-defined DTH base ROM (DQS / linear).',
  FAC: 'Pre-defined DTH face ROM incl. the separate Mouth figure ROM.',
  GEN: 'Pre-defined genitalia ROM.',
  PHY: 'Pre-defined physics example ROM (43 frames). Map its poses in the PoseAsset node manually for now.',
}

function PresetAssetPicker({
  section,
  config,
  genesis,
  gender,
  skinning,
  facEnabled,
  catalog,
  onChange,
}: {
  section: RomSection
  config: RomSectionConfig
  genesis: GenesisVersion
  gender: Gender
  skinning: 'linear' | 'dqs'
  facEnabled: boolean
  catalog: PoseAssetCatalog
  onChange: (presetAssets: Array<string>) => void
}) {
  const available = catalog.assets.filter(
    (asset) =>
      asset.section === section &&
      (asset.genesis === null || asset.genesis === genesis) &&
      // GEN assets are gender-specific: female → Golden Palace, male → Dicktator.
      (section !== 'GEN' || (genAssetGender(asset.name) ?? gender) === gender),
  )

  if (catalog.error) {
    return <ConfigError message={catalog.error} />
  }
  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pre-defined {section} preset available for {genesis} in the Poses folder.
      </p>
    )
  }

  const fileNameOf = (asset: DthPoseAsset) => `${asset.name}.duf`
  const selectedFirst = config.presetAssets[0] ?? ''
  const selectedAsset = available.find((asset) => fileNameOf(asset) === selectedFirst)
  // The JCM asset IS the skinning choice (there is no separate skinning
  // setting), so without an explicit pick we preselect the DTH-recommended
  // DQS variant matching the FAC section state.
  const jcmDefault =
    section === 'JCM'
      ? (available.find((a) => a.skinning === 'dqs' && a.includesFac === facEnabled) ??
        available.find((a) => a.skinning === 'dqs') ??
        available[0])
      : undefined
  // With a single candidate there is nothing to choose — it IS the asset.
  const effectiveAsset =
    available.length === 1 ? available[0] : (selectedAsset ?? jcmDefault)

  const hints: Array<string> = []
  if (section === 'JCM' && effectiveAsset) {
    if (effectiveAsset.includesFac && !facEnabled) {
      hints.push('This asset bakes in the FAC poses but the FAC section is disabled.')
    }
    if (!effectiveAsset.includesFac && facEnabled) {
      hints.push('The FAC section is enabled but this asset has no FAC poses baked in.')
    }
  }

  // The FAC (mouth) ROM is not a choice: DthWorkflow resolves it from the
  // skinning, which the JCM asset defines — show the resolved file read-only.
  if (section === 'FAC') {
    const resolved = available.find((a) => a.skinning === skinning) ?? available[0]
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Asset:</span>
          <span
            className="cursor-default rounded-md border border-input bg-muted/40 px-2 py-1 text-sm text-muted-foreground"
            title="Follows the JCM asset — the workflow loads the mouth ROM matching its skinning variant"
          >
            {resolved.name}
          </span>
          <span className="text-xs text-muted-foreground">follows the JCM asset</span>
        </div>
        <p className="text-xs text-muted-foreground">{resolved.relPath}</p>
      </div>
    )
  }

  if (available.length === 1) {
    const only = available[0]
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Asset:</span>
          <span
            className="cursor-default rounded-md border border-input bg-muted/40 px-2 py-1 text-sm text-muted-foreground"
            title="The only available asset for this section and generation"
          >
            {only.name}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{only.relPath}</p>
        {hints.map((hint) => (
          <p key={hint} className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ {hint}
          </p>
        ))}
      </div>
    )
  }

  // GEN allows combining ROMs (e.g. Golden Palace + Dicktator) — multi-select.
  if (section === 'GEN') {
    return (
      <div className="space-y-2">
        {available.map((asset) => {
          const fileName = fileNameOf(asset)
          const checked = config.presetAssets.includes(fileName)
          return (
            <label key={asset.relPath} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...config.presetAssets, fileName]
                      : config.presetAssets.filter((name) => name !== fileName),
                  )
                }
              />
              <span>{asset.name}</span>
              <span className="text-xs text-muted-foreground">{asset.relPath}</span>
            </label>
          )
        })}
        {config.presetAssets.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing selected — defaults to Golden Palace at generation time.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Asset:</span>
        <Select
          value={
            section === 'JCM'
              ? selectedFirst || (jcmDefault ? fileNameOf(jcmDefault) : '')
              : selectedFirst || AUTO_ASSET
          }
          onValueChange={(value) => onChange(value && value !== AUTO_ASSET ? [value] : [])}
        >
          <SelectTrigger size="sm" className="w-fit max-w-[20rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {section !== 'JCM' && (
              <SelectItem value={AUTO_ASSET}>auto — matched to {genesis} at generation</SelectItem>
            )}
            {available.map((asset) => (
              <SelectItem key={asset.relPath} value={fileNameOf(asset)}>
                {asset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {effectiveAsset && (
        <p className="text-xs text-muted-foreground">{effectiveAsset.relPath}</p>
      )}
      {hints.map((hint) => (
        <p key={hint} className="text-xs text-amber-600 dark:text-amber-400">
          ⚠ {hint}
        </p>
      ))}
    </div>
  )
}

// No width here — Tailwind resolves conflicting width utilities by stylesheet
// order, so a base w-full would silently override per-cell widths like w-20.
const cellInputClass =
  'rounded-sm border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-input focus:border-ring focus:bg-background'

const headerSelectClass =
  'rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus:border-ring'

// Radix Select forbids an empty-string item value, so the "auto" asset choice
// (no explicit preset selected) uses a sentinel mapped back to [] on change.
const AUTO_ASSET = '__auto__'

function TextCell({
  value,
  onCommit,
  placeholder,
}: {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className={`${cellInputClass} w-full`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

// Morph values are stored 0–1 but shown/edited as Daz-style percentages
// (0–100%); toFixed trims the float noise of the *100 / /100 conversions.
function valueToPct(v: number): string {
  return String(+(v * 100).toFixed(4))
}
function pctToValue(pct: number): number {
  return +(pct / 100).toFixed(6)
}

/** A "%" suffix overlaid on the right of a cell input. */
function PercentSuffix() {
  return (
    <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-xs text-muted-foreground">
      %
    </span>
  )
}

function NumberCell({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(() => valueToPct(value))
  useEffect(() => setDraft(valueToPct(value)), [value])
  return (
    <div className="relative inline-block w-20">
      <input
        className={`${cellInputClass} w-full pr-5 text-right tabular-nums`}
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = Number(draft)
          const next = pctToValue(parsed)
          if (!Number.isNaN(parsed) && next !== value) onCommit(next)
          else setDraft(valueToPct(value))
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <PercentSuffix />
    </div>
  )
}

interface MorphPatch {
  node?: string
  prop?: string
  value?: number
  base?: number | undefined
  autoBase?: boolean | undefined
}

interface PoseTableMeta {
  startFrame: number
  showReferenceFbx: boolean
  expandedIds: Set<string>
  toggleExpanded: (poseId: string) => void
  update: (rowIndex: number, patch: Partial<RomPose>) => void
  updateMorphAt: (rowIndex: number, morphIndex: number, patch: MorphPatch) => void
  addMorph: (rowIndex: number) => void
  removeMorphAt: (rowIndex: number, morphIndex: number) => void
  remove: (rowIndex: number) => void
}

/** Number input that may be empty (= unset). */
function OptionalNumberCell({
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  value: number | undefined
  placeholder: string
  disabled?: boolean
  onCommit: (value: number | undefined) => void
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : valueToPct(value))
  useEffect(() => setDraft(value === undefined ? '' : valueToPct(value)), [value])
  return (
    <div className="relative inline-block w-16">
      <input
        className={`${cellInputClass} w-full pr-5 text-right tabular-nums disabled:opacity-40`}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() === '') {
            if (value !== undefined) onCommit(undefined)
            return
          }
          const parsed = Number(draft)
          const next = pctToValue(parsed)
          if (!Number.isNaN(parsed) && next !== value) onCommit(next)
          else setDraft(value === undefined ? '' : valueToPct(value))
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <PercentSuffix />
    </div>
  )
}

const columnHelper = createColumnHelper<RomPose>()

const poseColumns: Array<ColumnDef<RomPose, any>> = [
  columnHelper.display({
    id: 'frame',
    header: 'Frame',
    cell: ({ row, table }) => (
      <span className="px-2 text-sm text-muted-foreground tabular-nums">
        {(table.options.meta as PoseTableMeta).startFrame + row.index}
      </span>
    ),
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    cell: ({ getValue, row, table }) => (
      <TextCell
        value={getValue()}
        placeholder="e.g. BodyTone"
        onCommit={(name) => (table.options.meta as PoseTableMeta).update(row.index, { name })}
      />
    ),
  }),
  // The node a morph lives on (Genesis9, GoldenPalace_G9, bone nodes, …) is
  // edited in the morphs expansion — it is constant for typical pose lists.
  columnHelper.accessor((pose) => pose.morphs[0]?.prop ?? '', {
    id: 'prop',
    header: 'Morph name',
    cell: ({ getValue, row, table }) =>
      row.original.morphs.length > 1 ? (
        <span className="px-2 text-sm text-muted-foreground italic">
          {row.original.morphs.length} morphs combined
        </span>
      ) : (
        <TextCell
          value={getValue()}
          placeholder="body_bs_BodyTone"
          onCommit={(prop) =>
            (table.options.meta as PoseTableMeta).updateMorphAt(row.index, 0, { prop })
          }
        />
      ),
  }),
  columnHelper.accessor((pose) => pose.morphs[0]?.value ?? 1, {
    id: 'value',
    header: () => 'Value',
    cell: ({ getValue, row, table }) =>
      row.original.morphs.length > 1 ? null : (
        <NumberCell
          value={getValue()}
          onCommit={(value) =>
            (table.options.meta as PoseTableMeta).updateMorphAt(row.index, 0, { value })
          }
        />
      ),
  }),
  columnHelper.accessor('referenceFbx', {
    id: 'referenceFbx',
    header: 'Reference FBX',
    cell: ({ getValue, row, table }) => (
      <div className="flex items-center gap-1">
        <TextCell
          value={getValue()}
          placeholder="optional .fbx path"
          onCommit={(referenceFbx) =>
            (table.options.meta as PoseTableMeta).update(row.index, { referenceFbx })
          }
        />
        <button
          type="button"
          className="flex shrink-0 items-center px-1 text-muted-foreground/60 hover:text-foreground"
          title="Pick the reference FBX with a file dialog"
          onClick={async () => {
            const path = await pickFbxPath()
            if (path) (table.options.meta as PoseTableMeta).update(row.index, { referenceFbx: path })
          }}
        >
          <FolderOpen className="size-3.5" />
        </button>
      </div>
    ),
  }),
  columnHelper.display({
    id: 'expand',
    header: '',
    cell: ({ row, table }) => {
      const meta = table.options.meta as PoseTableMeta
      const expanded = meta.expandedIds.has(row.original.id)
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          title="Combine multiple Daz morphs into this single generated morph"
          onClick={() => meta.toggleExpanded(row.original.id)}
        >
          {row.original.morphs.length > 1 ? `${row.original.morphs.length} morphs` : 'morphs'}
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>
      )
    },
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: ({ row, table }) => (
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Remove pose"
        onClick={() => (table.options.meta as PoseTableMeta).remove(row.index)}
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    ),
  }),
]

function SortablePoseRow({
  row,
  expanded,
  meta,
}: {
  row: Row<RomPose>
  expanded: boolean
  meta: PoseTableMeta
}) {
  const pose = row.original
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pose.id,
  })
  const visibleCells = row.getVisibleCells()
  return (
    <>
      <tr
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`border-b last:border-b-0 hover:bg-muted/30 ${isDragging ? 'relative z-10 bg-muted/50 opacity-70' : ''}`}
      >
        <td className="px-1 py-0.5">
          <button
            type="button"
            className="flex cursor-grab items-center px-1 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            title="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
        </td>
        {visibleCells.map((cell) => (
          <td key={cell.id} className="px-1 py-0.5">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/20">
          <td />
          <td colSpan={visibleCells.length} className="px-2 py-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="w-5 text-right">#</span>
                <span className="w-44 px-2" title="The scene node the morph lives on (Genesis9, GoldenPalace_G9, a bone, …)">
                  Node
                </span>
                <span className="flex-1 px-2" title="The internal property name of the Daz morph">
                  Property
                </span>
                <span className="w-20 px-2 text-right" title="The value the pose dials the morph to">
                  Value
                </span>
                <span
                  className="w-16 px-2 text-right"
                  title="The value the sawtooth returns to on the frames around the pose (default 0) — for morphs already dialed in as part of the base shape"
                >
                  Base
                </span>
                <span
                  className="w-14 text-center"
                  title="Resolve the base from the morph's current scene value at apply time"
                >
                  Auto
                </span>
                <span className="w-6" />
              </div>
              {pose.morphs.map((morph, morphIndex) => (
                <div key={morphIndex} className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                    {morphIndex + 1}.
                  </span>
                  <div className="w-44">
                    <TextCell
                      value={morph.node}
                      placeholder="Genesis9"
                      onCommit={(node) => meta.updateMorphAt(row.index, morphIndex, { node })}
                    />
                  </div>
                  <div className="flex-1">
                    <TextCell
                      value={morph.prop}
                      placeholder="body_bs_BodyTone"
                      onCommit={(prop) => meta.updateMorphAt(row.index, morphIndex, { prop })}
                    />
                  </div>
                  <NumberCell
                    value={morph.value}
                    onCommit={(value) => meta.updateMorphAt(row.index, morphIndex, { value })}
                  />
                  <OptionalNumberCell
                    value={morph.base}
                    placeholder="0"
                    disabled={morph.autoBase === true}
                    onCommit={(base) => meta.updateMorphAt(row.index, morphIndex, { base })}
                  />
                  <span className="flex w-14 justify-center">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      title="Resolve the base from the morph's current scene value at apply time"
                      checked={morph.autoBase === true}
                      onChange={(e) =>
                        meta.updateMorphAt(row.index, morphIndex, {
                          autoBase: e.target.checked ? true : undefined,
                        })
                      }
                    />
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    title="Remove this morph"
                    disabled={pose.morphs.length <= 1}
                    onClick={() => meta.removeMorphAt(row.index, morphIndex)}
                  >
                    <Trash2 className="size-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-1 h-7 text-xs"
              onClick={() => meta.addMorph(row.index)}
            >
              <Plus className="size-3.5" /> Add morph
            </Button>
          </td>
        </tr>
      )}
    </>
  )
}

function GroupCard({
  section,
  group,
  gender,
  startFrame,
  removable = true,
  expandedIds,
  onToggleExpanded,
  onChange,
  onRemove,
  onMirror,
}: {
  section: RomSection
  group: RomGroup
  gender: Gender
  startFrame: number
  removable?: boolean
  expandedIds: Set<string>
  onToggleExpanded: (poseId: string) => void
  onChange: (group: RomGroup) => void
  onRemove: () => void
  onMirror: () => void
}) {
  const showReferenceFbx = REFERENCE_FBX_SECTIONS.includes(section)
  const showBoneLabel = BONE_LABEL_SECTIONS.includes(section)
  const showSuffix = GROUPED_SECTIONS.includes(section)
  const showMethod = METHOD_SECTIONS.includes(section)
  const showCalcFrom = CALC_FROM_SECTIONS.includes(section)
  // The group's own id is its container droppable, so a pose can be dropped onto
  // an empty group's body. The DndContext spanning all groups lives in the parent
  // (PoseGroupsEditor), enabling drags between groups, not just within one.
  const { setNodeRef: setDropRef } = useDroppable({ id: group.id })

  function patchPose(rowIndex: number, patch: Partial<RomPose>) {
    onChange({
      ...group,
      poses: group.poses.map((pose, i) => (i === rowIndex ? { ...pose, ...patch } : pose)),
    })
  }

  const meta: PoseTableMeta = {
    startFrame,
    showReferenceFbx,
    expandedIds,
    toggleExpanded: onToggleExpanded,
    update: patchPose,
    updateMorphAt: (rowIndex, morphIndex, patch) => {
      const pose = group.poses[rowIndex]
      const morphs = pose.morphs.length
        ? pose.morphs.map((m, mi) => (mi === morphIndex ? { ...m, ...patch } : m))
        : [{ node: '', prop: '', value: 1, ...patch }]
      patchPose(rowIndex, { morphs })
    },
    addMorph: (rowIndex) => {
      const pose = group.poses[rowIndex]
      patchPose(rowIndex, {
        morphs: [...pose.morphs, { node: pose.morphs[0]?.node ?? 'Genesis9', prop: '', value: 1 }],
      })
    },
    removeMorphAt: (rowIndex, morphIndex) => {
      const pose = group.poses[rowIndex]
      if (pose.morphs.length <= 1) return
      patchPose(rowIndex, { morphs: pose.morphs.filter((_, mi) => mi !== morphIndex) })
    },
    remove: (rowIndex) =>
      onChange({ ...group, poses: group.poses.filter((_, i) => i !== rowIndex) }),
  }

  const table = useReactTable({
    data: group.poses,
    columns: poseColumns,
    getCoreRowModel: getCoreRowModel(),
    meta,
    state: { columnVisibility: { referenceFbx: showReferenceFbx } },
  })

  function addPose() {
    // Inherit the node from the previous pose — pose lists usually target the
    // same node throughout. A GEN group starts on the gender's geograft node.
    const lastNode =
      group.poses[group.poses.length - 1]?.morphs[0]?.node ??
      (section === 'GEN' ? genDefaultNode(gender) : 'Genesis9')
    onChange({
      ...group,
      poses: [
        ...group.poses,
        {
          id: newId(),
          name: '',
          morphs: [{ node: lastNode, prop: '', value: 1 }],
          referenceFbx: '',
        },
      ],
    })
  }

  const endFrame = startFrame + group.poses.length - 1
  const frameRange =
    group.poses.length === 0
      ? 'empty'
      : group.poses.length === 1
        ? `frame ${startFrame}`
        : `frames ${startFrame}–${endFrame}`

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        {/* Field availability per section mirrors the PoseAsset node's CSV
            format (docs/poseasset-csv-spec.md). FBM/MISC groups show nothing. */}
        {showBoneLabel && (
          <input
            className={`${headerSelectClass} w-36`}
            value={group.label}
            placeholder="driver bone(s)"
            title="The bone(s) driving this group's poses (CSV bones column)"
            onChange={(e) => onChange({ ...group, label: e.target.value })}
          />
        )}
        {showMethod && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="How the group's morphs are calculated: default (the node's global setting) / individual (each in isolation) / additive (the rest are deltas on top of the first pose) / cumulative (each stacks on all previous poses) / advanced additive"
          >
            Generation
            <Select
              value={group.method}
              onValueChange={(value) => onChange({ ...group, method: value as GenerationMethod })}
            >
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="additive">Additive</SelectItem>
                <SelectItem value="cumulative">Cumulative</SelectItem>
                <SelectItem value="advancedAdditive">Advanced Additive</SelectItem>
              </SelectContent>
            </Select>
          </span>
        )}
        {showCalcFrom && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="What the group's morph deltas are calculated against: default (the node's global setting) / the rest pose / the animation frame"
          >
            Calculate from
            <Select
              value={group.calculateFrom}
              onValueChange={(value) =>
                onChange({ ...group, calculateFrom: value as CalculateFrom })
              }
            >
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="restPose">Rest Pose</SelectItem>
                <SelectItem value="animationFrame">Animation Frame</SelectItem>
              </SelectContent>
            </Select>
          </span>
        )}
        {showSuffix && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="Suffix — generated morphs get _l/_r appended automatically"
          >
            Suffix
            <Select
              value={group.suffix}
              onValueChange={(value) => onChange({ ...group, suffix: value as GroupSuffix })}
            >
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="centre">Centre</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{frameRange}</span>
        {group.suffix === 'left' && (
          <Button
            variant="ghost"
            size="sm"
            title="Append a mirrored right-side copy of this group"
            onClick={onMirror}
          >
            <Copy /> Mirror right
          </Button>
        )}
        {removable && (
          <Button variant="ghost" size="icon" className="size-7" title="Remove group" onClick={onRemove}>
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        )}
      </div>
      <div ref={setDropRef}>
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b">
                <th className="w-7" />
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <SortableContext
            items={group.poses.map((pose) => pose.id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <SortablePoseRow
                  key={row.original.id}
                  row={row}
                  expanded={expandedIds.has(row.original.id)}
                  meta={meta}
                />
              ))}
              {group.poses.length === 0 && (
                <tr>
                  <td colSpan={poseColumns.length + 1} className="px-4 py-4 text-center text-sm text-muted-foreground">
                    No poses in this group yet.
                  </td>
                </tr>
              )}
            </tbody>
          </SortableContext>
        </table>
      </div>
      <div className="border-t p-1.5">
        <Button variant="outline" size="sm" onClick={addPose}>
          <Plus /> Add morph
        </Button>
      </div>
    </div>
  )
}

/**
 * Cross-group drag-and-drop for a section's pose groups: one DndContext spans
 * every group so a morph (pose) can be dragged *between* groups, not just
 * reordered within one. The move resolves on drag end — dropped onto a pose it
 * inserts at that position; dropped on an empty group's body it appends. Also
 * used for the flat FBM/MISC list (a single group → reorder only).
 */
function PoseGroupsEditor({
  section,
  groups,
  gender,
  startFrames,
  removable,
  onGroupsChange,
}: {
  section: RomSection
  groups: Array<RomGroup>
  gender: Gender
  startFrames: Map<string, number>
  removable: boolean
  onGroupsChange: (groups: Array<RomGroup>) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [activePose, setActivePose] = useState<RomPose | null>(null)
  // While dragging we work on a local copy so the groups "make space" live as a
  // pose moves between them, without rewriting the character on every frame —
  // the result is committed once on drop.
  const [dragGroups, setDragGroups] = useState<Array<RomGroup> | null>(null)
  const display = dragGroups ?? groups
  // Hold the resolved drop target for the frame right after a pose hops into a
  // new group, so collision detection doesn't bounce it back at the boundary.
  const lastOverId = useRef<string | null>(null)
  const justMoved = useRef(false)
  useEffect(() => {
    requestAnimationFrame(() => {
      justMoved.current = false
    })
  }, [display])

  const toggleExpanded = (poseId: string) =>
    setExpandedIds((ids) => {
      const next = new Set(ids)
      if (next.has(poseId)) next.delete(poseId)
      else next.add(poseId)
      return next
    })

  // The group index owning a draggable id within `list`: a pose id (search each
  // group's poses) or a group's own id (its container droppable).
  function groupIndexOf(list: Array<RomGroup>, id: string): number {
    const asContainer = list.findIndex((g) => g.id === id)
    if (asContainer >= 0) return asContainer
    return list.findIndex((g) => g.poses.some((p) => p.id === id))
  }

  // Pointer-first detection that drills from a hovered group into its closest
  // pose, and holds the last target across the reflow after a cross-group hop —
  // the dnd-kit "multiple containers" recipe, which stops boundary flicker.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointer = pointerWithin(args)
      const hits = pointer.length > 0 ? pointer : rectIntersection(args)
      let overId = getFirstCollision(hits, 'id')
      if (overId != null) {
        const overGroup = display.find((g) => g.id === String(overId))
        if (overGroup && overGroup.poses.length > 0) {
          const ids = new Set(overGroup.poses.map((p) => p.id))
          const inner = closestCorners({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (c) => c.id !== overId && ids.has(String(c.id)),
            ),
          })
          overId = getFirstCollision(inner, 'id') ?? overId
        }
        lastOverId.current = String(overId)
        return [{ id: overId }]
      }
      if (justMoved.current && activePose) lastOverId.current = activePose.id
      return lastOverId.current ? [{ id: lastOverId.current }] : []
    },
    [display, activePose],
  )

  function handleDragStart(event: DragStartEvent) {
    setExpandedIds(new Set()) // a tall expanded row makes a clumsy drag
    const id = String(event.active.id)
    setActivePose(groups.flatMap((g) => g.poses).find((p) => p.id === id) ?? null)
    setDragGroups(groups)
  }

  // Live cross-group move: pull the dragged pose into the hovered group so both
  // groups animate (the source closes up, the target opens a slot). Same-group
  // hovering is left to the sortable strategy; the exact slot settles on drop.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    setDragGroups((prev) => {
      const list = prev ?? groups
      const from = groupIndexOf(list, activeId)
      const to = groupIndexOf(list, overId)
      if (from < 0 || to < 0 || from === to) return list
      const fromPoses = list[from].poses
      const toPoses = list[to].poses
      const activeIndex = fromPoses.findIndex((p) => p.id === activeId)
      if (activeIndex < 0) return list
      const moved = fromPoses[activeIndex]
      const overIndex =
        list[to].id === overId ? toPoses.length : toPoses.findIndex((p) => p.id === overId)
      const insertAt = overIndex < 0 ? toPoses.length : overIndex
      justMoved.current = true
      return list.map((g, i) => {
        if (i === from) return { ...g, poses: fromPoses.filter((_, idx) => idx !== activeIndex) }
        if (i === to) {
          const next = [...toPoses]
          next.splice(insertAt, 0, moved)
          return { ...g, poses: next }
        }
        return g
      })
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const list = dragGroups ?? groups
    let result = list
    if (over) {
      const activeId = String(active.id)
      const overId = String(over.id)
      const idx = groupIndexOf(list, activeId)
      // The cross-group hop already happened in onDragOver; settle the exact
      // position within the resolved group.
      if (idx >= 0 && groupIndexOf(list, overId) === idx && activeId !== overId) {
        const poses = list[idx].poses
        const oldIndex = poses.findIndex((p) => p.id === activeId)
        const newIndex = poses.findIndex((p) => p.id === overId)
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          result = list.map((g, i) =>
            i === idx ? { ...g, poses: arrayMove(poses, oldIndex, newIndex) } : g,
          )
        }
      }
    }
    onGroupsChange(result)
    setDragGroups(null)
    setActivePose(null)
  }

  function handleDragCancel() {
    setDragGroups(null)
    setActivePose(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-3">
        {display.map((group) => (
          <GroupCard
            key={group.id}
            section={section}
            group={group}
            gender={gender}
            startFrame={startFrames.get(group.id) ?? 1}
            removable={removable}
            expandedIds={expandedIds}
            onToggleExpanded={toggleExpanded}
            onChange={(updated) =>
              onGroupsChange(groups.map((g) => (g.id === group.id ? updated : g)))
            }
            onRemove={() => onGroupsChange(groups.filter((g) => g.id !== group.id))}
            onMirror={() => {
              const i = groups.findIndex((g) => g.id === group.id)
              onGroupsChange([...groups.slice(0, i + 1), mirrorGroup(group), ...groups.slice(i + 1)])
            }}
          />
        ))}
        {display.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
            No groups yet — e.g. one group per driver bone, or left/right/centre groups for
            mirrored poses.
          </p>
        )}
      </div>
      {createPortal(
        // Portalled to <body> so no transformed/clipping ancestor (the accordion,
        // the sticky header) can hide the position:fixed overlay.
        <DragOverlay dropAnimation={null}>
          {activePose ? (
            <div className="flex cursor-grabbing items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-xl ring-1 ring-primary/50">
              <GripVertical className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{activePose.name || '(unnamed morph)'}</span>
              <span className="text-xs text-muted-foreground">
                {activePose.morphs.length} morph{activePose.morphs.length === 1 ? '' : 's'}
              </span>
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}

/** The implicit single group of a flat FBM/MISC section (no group management). */
function flatGroup(section: RomSection): RomGroup {
  return {
    id: `flat-${section}`,
    label: '',
    suffix: 'centre',
    method: 'default',
    calculateFrom: 'default',
    poses: [],
  }
}

/**
 * Per-character art direction for the pre-made GP/DK ROM blocks: the
 * catalog's art-directable frames, each with an editable morph list.
 * Frames without morphs are not stored and not generated.
 */
function ArtDirectionEditor({
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
      <p className="text-sm font-medium">Art direction</p>
      <p className="text-xs text-muted-foreground">
        Morph values stamped onto frames inside the pre-made ROM after loading — generated as a
        per-character art direction JSON. Frames marked <em>required</em> ship empty in the
        preset: without morphs here their generated morph does nothing.
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
      <div
        className="flex cursor-pointer items-center gap-2 px-2 py-1.5 select-none"
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
      </div>
      {open && (
        <div className="space-y-1 border-t px-2 py-2">
          {entry.morphs.map((morph, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="w-44">
                <TextCell
                  value={morph.node}
                  placeholder="GoldenPalace_G9"
                  onCommit={(node) => patchMorph(index, { node })}
                />
              </div>
              <div className="flex-1">
                <TextCell
                  value={morph.prop}
                  placeholder="GP_Anus_Open"
                  onCommit={(prop) => patchMorph(index, { prop })}
                />
              </div>
              <NumberCell
                value={morph.value}
                onCommit={(value) => patchMorph(index, { value })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Remove this morph"
                onClick={() =>
                  onCommit({ ...entry, morphs: entry.morphs.filter((_, mi) => mi !== index) })
                }
              >
                <Trash2 className="size-3 text-destructive" />
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

function sectionSummary(config: RomSectionConfig): string {
  if (!config.enabled) return 'disabled'
  if (config.mode === 'preset') return 'enabled'
  const poses = config.groups.reduce((sum, group) => sum + group.poses.length, 0)
  return `custom · ${config.groups.length} ${config.groups.length === 1 ? 'group' : 'groups'} · ${poses} ${poses === 1 ? 'frame' : 'frames'}`
}

export function RomSections({
  sections,
  genesis,
  gender,
  skinning,
  catalog,
  presetFrames,
  onChange,
}: RomSectionsProps) {
  const [open, setOpen] = useState<Partial<Record<RomSection, boolean>>>({})
  // A picked CSV awaiting its frame-range dialog (null = no import in progress).
  const [pendingCsv, setPendingCsv] = useState<{
    section: RomSection
    poses: Awaited<ReturnType<typeof importPosesFromCsv>>
  } | null>(null)

  // Absolute timeline frame of each custom group's first pose: the measured
  // preset ROM blocks (base, GP/DK, Physics) come first, then the custom
  // sequence continues. Left empty when frames couldn't be measured — the
  // editor shows a notice and the group editors fall back to a relative count.
  const startFrames = new Map<string, number>()
  if (presetFrames) {
    let frame = presetFrameCount(sections, gender, presetFrames)
    for (const section of ROM_SECTIONS) {
      const config = sections[section]
      if (!config.enabled || config.mode !== 'custom') continue
      for (const group of config.groups) {
        startFrames.set(group.id, frame)
        frame += group.poses.length
      }
    }
  }

  function patchSection(section: RomSection, patch: Partial<RomSectionConfig>) {
    onChange({ ...sections, [section]: { ...sections[section], ...patch } })
  }

  // Bulk-import a DAZ morph CSV into a section. A full scene scan covers the whole
  // ROM, so after picking the file we open the frame-range dialog; applyCsvImport
  // commits the chosen slice.
  async function importCsv(section: RomSection) {
    const filePath = await pickCsvPath('Select a DAZ morph CSV')
    if (!filePath) return
    let imported: Awaited<ReturnType<typeof importPosesFromCsv>>
    try {
      imported = await importPosesFromCsv({ data: { filePath } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return
    }
    if (imported.length === 0) {
      toast.error('No morphs found in that CSV')
      return
    }
    setPendingCsv({ section, poses: imported })
  }

  // Commit the chosen frame range: each selected row becomes a pose (a cleaned
  // name + its morphs). Grouped sections get a new group; the flat FBM/MISC list
  // appends to its single group. The section is enabled + custom.
  function applyCsvImport(start: number, end: number) {
    if (!pendingCsv) return
    const { section, poses: source } = pendingCsv
    setPendingCsv(null)
    const inRange = source.filter((pose) => pose.frame >= start && pose.frame <= end)
    if (inRange.length === 0) {
      toast.error('No morphs in that frame range')
      return
    }
    const poses: Array<RomPose> = inRange.map((pose) => ({
      id: newId(),
      name: pose.name,
      morphs: pose.morphs,
      referenceFbx: '',
    }))
    const config = sections[section]
    const newGroup = (): RomGroup => ({
      id: newId(),
      label: '',
      suffix: 'centre',
      method: 'default',
      calculateFrom: 'default',
      poses,
    })
    const groups: Array<RomGroup> = GROUPED_SECTIONS.includes(section)
      ? [...config.groups, newGroup()]
      : [
          config.groups[0]
            ? { ...config.groups[0], poses: [...config.groups[0].poses, ...poses] }
            : newGroup(),
          ...config.groups.slice(1),
        ]
    patchSection(section, { enabled: true, mode: 'custom', groups })
    toast.success(
      `Imported ${inRange.length} morph${inRange.length === 1 ? '' : 's'} into ${SECTION_LABELS[section]}`,
    )
  }

  return (
    <div className="space-y-2">
      {!presetFrames && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Couldn't measure the preset ROM frame lengths from the pose assets, so absolute frame
          numbers are unavailable. Make sure the DTH release is scanned in Settings and reachable.
        </div>
      )}
      {ROM_SECTIONS.map((section) => {
        const config = sections[section]
        const modes = SECTION_MODES[section]
        const isOpen = open[section] ?? false
        // RET has no independent existence: the retargeting poses live inside
        // the JCM base ROM, so its state is derived from the JCM section.
        const tiedToJcm = section === 'RET'
        const effectiveEnabled = tiedToJcm
          ? sections.JCM.enabled && sections.JCM.mode === 'preset'
          : config.enabled
        return (
          <div key={section} className={`rounded-lg border ${effectiveEnabled ? '' : 'opacity-60'}`}>
            <div
              className="flex cursor-pointer items-center gap-3 px-4 py-3 select-none"
              onClick={() => setOpen((o) => ({ ...o, [section]: !isOpen }))}
            >
              <ChevronRight
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
              <span className="w-12 font-mono text-sm font-semibold">{section}</span>
              <span className="font-medium">{SECTION_LABELS[section]}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {tiedToJcm
                  ? effectiveEnabled
                    ? 'enabled with JCM'
                    : 'disabled with JCM'
                  : sectionSummary(config)}
              </span>
              <span onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={effectiveEnabled}
                  disabled={tiedToJcm}
                  title={
                    tiedToJcm
                      ? 'The retargeting poses are part of the JCM base ROM — controlled by the JCM section'
                      : effectiveEnabled
                        ? 'Disable this section'
                        : 'Enable this section'
                  }
                  onCheckedChange={(enabled) => patchSection(section, { enabled })}
                />
              </span>
            </div>

            {isOpen && (
              <div className="space-y-3 border-t px-4 py-4">
                {modes.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Mode:</span>
                    <Select
                      value={config.mode}
                      onValueChange={(value) =>
                        patchSection(section, { mode: value as SectionMode })
                      }
                    >
                      <SelectTrigger size="sm" className="w-fit min-w-[12rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="preset">Pre-defined DTH assets</SelectItem>
                        <SelectItem value="custom">
                          {section === 'JCM' ? 'Custom JCM asset' : 'Custom morph list'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {config.mode === 'preset' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {PRESET_DESCRIPTIONS[section] ?? 'Pre-defined DTH assets.'}
                    </p>
                    <PresetAssetPicker
                      section={section}
                      config={config}
                      genesis={genesis}
                      gender={gender}
                      skinning={skinning}
                      facEnabled={sections.FAC.enabled}
                      catalog={catalog}
                      onChange={(presetAssets) => patchSection(section, { presetAssets })}
                    />
                    {section === 'GEN' && (
                      <ArtDirectionEditor
                        config={config}
                        sections={sections}
                        gender={gender}
                        presetFrames={presetFrames}
                        onChange={(artDirection) => patchSection(section, { artDirection })}
                      />
                    )}
                  </div>
                ) : section === 'JCM' ? (
                  // Custom JCM asset: a user-supplied .duf path used as the base
                  // ROM, just like a pre-defined DTH asset.
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Point to a custom JCM pose preset (.duf). It's loaded as the base ROM exactly
                      like a pre-defined DTH asset.
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Path:</span>
                      <Input
                        className="max-w-xl"
                        value={config.customAssetPath}
                        placeholder="C:\…\My Custom JCM.duf"
                        onChange={(e) => patchSection(section, { customAssetPath: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={async () => {
                          const picked = await pickDufPath('Select a custom JCM pose preset (.duf)')
                          if (picked) patchSection(section, { customAssetPath: picked })
                        }}
                      >
                        <FolderOpen /> Browse
                      </Button>
                    </div>
                  </div>
                ) : !GROUPED_SECTIONS.includes(section) ? (
                  // FBM/MISC are flat lists in the PoseAsset node — exactly
                  // one implicit group, no group management.
                  <div className="space-y-3">
                    <PoseGroupsEditor
                      section={section}
                      groups={config.groups.length > 0 ? config.groups : [flatGroup(section)]}
                      gender={gender}
                      startFrames={startFrames}
                      removable={false}
                      onGroupsChange={(groups) => patchSection(section, { groups })}
                    />
                    <ImportCsvButton onImport={() => void importCsv(section)} />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <PoseGroupsEditor
                      section={section}
                      groups={config.groups}
                      gender={gender}
                      startFrames={startFrames}
                      removable
                      onGroupsChange={(groups) => patchSection(section, { groups })}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          patchSection(section, {
                            groups: [
                              ...config.groups,
                              {
                                id: newId(),
                                label: '',
                                suffix: 'centre',
                                method: 'default',
                                calculateFrom: 'default',
                                poses: [],
                              },
                            ],
                          })
                        }
                      >
                        <Plus /> Add group
                      </Button>
                      <ImportCsvButton onImport={() => void importCsv(section)} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {pendingCsv && (
        <CsvImportDialog
          sectionLabel={SECTION_LABELS[pendingCsv.section]}
          frames={pendingCsv.poses.map((pose) => pose.frame)}
          onConfirm={applyCsvImport}
          onClose={() => setPendingCsv(null)}
        />
      )}
    </div>
  )
}
