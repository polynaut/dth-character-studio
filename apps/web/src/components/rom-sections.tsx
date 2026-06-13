import { useEffect, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
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
import { ChevronDown, ChevronRight, Copy, FolderOpen, GripVertical, Plus, Trash2 } from 'lucide-react'

import { pickFbxPath } from '#/lib/desktop.ts'

import type { DragEndEvent } from '@dnd-kit/core'
import type { Row } from '@tanstack/react-table'

import { Button } from '#/components/ui/button.tsx'
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
  mirrorGroup,
  newId,
  presetFrameCount,
} from '#/lib/rom/types.ts'

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
  RomGroup,
  RomPose,
  RomSection,
  RomSectionConfig,
  RomSections as RomSectionsModel,
  SectionMode,
} from '#/lib/rom/types.ts'

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
    return <p className="text-sm text-destructive">{catalog.error}</p>
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
        <select
          className={headerSelectClass}
          value={section === 'JCM' ? (selectedFirst || (jcmDefault ? fileNameOf(jcmDefault) : '')) : selectedFirst}
          onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        >
          {section !== 'JCM' && (
            <option value="">auto — matched to {genesis} at generation</option>
          )}
          {available.map((asset) => (
            <option key={asset.relPath} value={fileNameOf(asset)}>
              {asset.name}
            </option>
          ))}
        </select>
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

function NumberCell({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      className={`${cellInputClass} w-20 text-right tabular-nums`}
      value={draft}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft)
        if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed)
        else setDraft(String(value))
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
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
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value])
  return (
    <input
      className={`${cellInputClass} w-16 text-right tabular-nums disabled:opacity-40`}
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
        if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed)
        else setDraft(value === undefined ? '' : String(value))
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
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
    header: () => <div className="text-right">Value</div>,
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
              variant="ghost"
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
  onChange,
  onRemove,
  onMirror,
}: {
  section: RomSection
  group: RomGroup
  gender: Gender
  startFrame: number
  removable?: boolean
  onChange: (group: RomGroup) => void
  onRemove: () => void
  onMirror: () => void
}) {
  const showReferenceFbx = REFERENCE_FBX_SECTIONS.includes(section)
  const showBoneLabel = BONE_LABEL_SECTIONS.includes(section)
  const showSuffix = GROUPED_SECTIONS.includes(section)
  const showMethod = METHOD_SECTIONS.includes(section)
  const showCalcFrom = CALC_FROM_SECTIONS.includes(section)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

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
    toggleExpanded: (poseId) =>
      setExpandedIds((ids) => {
        const next = new Set(ids)
        if (next.has(poseId)) next.delete(poseId)
        else next.add(poseId)
        return next
      }),
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = group.poses.findIndex((pose) => pose.id === active.id)
    const newIndex = group.poses.findIndex((pose) => pose.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onChange({ ...group, poses: arrayMove(group.poses, oldIndex, newIndex) })
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
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="How the group's morphs are calculated: default (the node's global setting) / individual (each in isolation) / additive (the rest are deltas on top of the first pose) / cumulative (each stacks on all previous poses) / advanced additive"
          >
            Generation
            <select
              className={`${headerSelectClass} text-sm text-foreground`}
              value={group.method}
              onChange={(e) => onChange({ ...group, method: e.target.value as GenerationMethod })}
            >
              <option value="default">Default</option>
              <option value="individual">Individual</option>
              <option value="additive">Additive</option>
              <option value="cumulative">Cumulative</option>
              <option value="advancedAdditive">Advanced Additive</option>
            </select>
          </label>
        )}
        {showCalcFrom && (
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="What the group's morph deltas are calculated against: default (the node's global setting) / the rest pose / the animation frame"
          >
            Calculate from
            <select
              className={`${headerSelectClass} text-sm text-foreground`}
              value={group.calculateFrom}
              onChange={(e) =>
                onChange({ ...group, calculateFrom: e.target.value as CalculateFrom })
              }
            >
              <option value="default">Default</option>
              <option value="restPose">Rest Pose</option>
              <option value="animationFrame">Animation Frame</option>
            </select>
          </label>
        )}
        {showSuffix && (
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="Suffix — generated morphs get _l/_r appended automatically"
          >
            Suffix
            <select
              className={`${headerSelectClass} text-sm text-foreground`}
              value={group.suffix}
              onChange={(e) => onChange({ ...group, suffix: e.target.value as GroupSuffix })}
            >
              <option value="left">Left</option>
              <option value="centre">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setExpandedIds(new Set())}
        onDragEnd={handleDragEnd}
      >
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
      </DndContext>
      <div className="border-t p-1.5">
        <Button variant="ghost" size="sm" onClick={addPose}>
          <Plus /> Add morph
        </Button>
      </div>
    </div>
  )
}

/**
 * Per-character art direction for the pre-made GP/DK ROM blocks: the
 * catalog's art-directable frames, each with an editable morph list.
 * Frames without morphs are not stored and not generated.
 */
function ArtDirectionEditor({
  config,
  gender,
  onChange,
}: {
  config: RomSectionConfig
  gender: Gender
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
      {activeRoms.map(([rom, label]) => (
        <div key={rom} className="space-y-1">
          {activeRoms.length > 1 && <p className="text-sm font-medium">{label}</p>}
          {ART_DIRECTION_CATALOG[rom].map((catalogFrame) => {
            const entry = entryFor(rom, catalogFrame.frame, catalogFrame.name)
            return (
              <ArtDirectionFrameRow
                key={`${rom}-${catalogFrame.frame}`}
                catalogFrame={catalogFrame}
                entry={entry}
                onCommit={commit}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ArtDirectionFrameRow({
  catalogFrame,
  entry,
  onCommit,
}: {
  catalogFrame: { frame: number; name: string; required: boolean; note?: string }
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
        <span className="w-10 text-right font-mono text-xs text-muted-foreground tabular-nums">
          +{catalogFrame.frame}
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
            variant="ghost"
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
  onChange,
}: RomSectionsProps) {
  const [open, setOpen] = useState<Partial<Record<RomSection, boolean>>>({})

  // Absolute timeline frame of each custom group's first pose: the preset ROM
  // blocks (base, GP/DK, Physics) come first, then the custom sequence continues.
  const startFrames = new Map<string, number>()
  let frame = presetFrameCount(sections, gender, skinning)
  for (const section of ROM_SECTIONS) {
    const config = sections[section]
    if (!config.enabled || config.mode !== 'custom') continue
    for (const group of config.groups) {
      startFrames.set(group.id, frame)
      frame += group.poses.length
    }
  }

  function patchSection(section: RomSection, patch: Partial<RomSectionConfig>) {
    onChange({ ...sections, [section]: { ...sections[section], ...patch } })
  }

  return (
    <div className="space-y-2">
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
                    <select
                      className={headerSelectClass}
                      value={config.mode}
                      onChange={(e) =>
                        patchSection(section, { mode: e.target.value as SectionMode })
                      }
                    >
                      <option value="preset">Pre-defined DTH assets</option>
                      <option value="custom">Custom morph list</option>
                    </select>
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
                        gender={gender}
                        onChange={(artDirection) => patchSection(section, { artDirection })}
                      />
                    )}
                  </div>
                ) : !GROUPED_SECTIONS.includes(section) ? (
                  // FBM/MISC are flat lists in the PoseAsset node — exactly
                  // one implicit group, no group management.
                  <GroupCard
                    section={section}
                    group={
                      config.groups[0] ?? {
                        id: `flat-${section}`,
                        label: '',
                        suffix: 'centre',
                        method: 'default',
                        calculateFrom: 'default',
                        poses: [],
                      }
                    }
                    gender={gender}
                    startFrame={startFrames.get(config.groups[0]?.id ?? '') ?? 1}
                    removable={false}
                    onChange={(updated) =>
                      patchSection(section, { groups: [updated, ...config.groups.slice(1)] })
                    }
                    onRemove={() => {}}
                    onMirror={() => {}}
                  />
                ) : (
                  <div className="space-y-3">
                    {config.groups.map((group, index) => (
                      <GroupCard
                        key={group.id}
                        section={section}
                        group={group}
                        gender={gender}
                        startFrame={startFrames.get(group.id) ?? 1}
                        onChange={(updated) =>
                          patchSection(section, {
                            groups: config.groups.map((g, i) => (i === index ? updated : g)),
                          })
                        }
                        onRemove={() =>
                          patchSection(section, {
                            groups: config.groups.filter((_, i) => i !== index),
                          })
                        }
                        onMirror={() =>
                          patchSection(section, {
                            groups: [
                              ...config.groups.slice(0, index + 1),
                              mirrorGroup(group),
                              ...config.groups.slice(index + 1),
                            ],
                          })
                        }
                      />
                    ))}
                    {config.groups.length === 0 && (
                      <p className="rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
                        No groups yet — e.g. one group per driver bone, or left/right/centre
                        groups for mirrored poses.
                      </p>
                    )}
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
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
