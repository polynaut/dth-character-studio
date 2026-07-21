import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChevronRight, FolderOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { pickCsvPath, pickDufPath } from '#/lib/desktop.ts'
import { importPosesFromCsv } from '#/lib/rom/api.ts'

import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@dth/ui'
import { CsvImportDialog } from '#/components/csv-import-dialog.tsx'
import { ScanCsvPickerDialog } from '#/components/scan-csv-picker-dialog.tsx'
import {
  GROUPED_SECTIONS,
  ROM_SECTIONS,
  SECTION_LABELS,
  SECTION_MODES,
  applySceneOverride,
  clonePose,
  genesisFigureNode,
  newId,
  presetFrameCount,
  sectionPresetAvailable,
} from '@dth/rom'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
import type {
  Gender,
  GenesisVersion,
  JcmMorphMod,
  PresetFrames,
  RomGroup,
  RomPose,
  RomSection,
  RomSectionConfig,
  RomSections as RomSectionsModel,
  SceneOverride,
  SectionMode,
} from '@dth/rom'

import { ArtDirectionEditor } from './rom/art-direction.tsx'
import { JcmModsGrid } from './rom/jcm-mods-grid.tsx'
import { EMPTY_MORPH_INDEX, FigureNodeContext, MorphIndexContext } from './rom/contexts.ts'
import type { IndexedMorphEntry } from './rom/contexts.ts'
import { ImportCsvButton } from './rom/import-csv-button.tsx'
import { PRESET_DESCRIPTIONS, PresetAssetPicker } from './rom/preset-asset-picker.tsx'
import { PoseGroupsEditor, flatGroup } from './rom/pose-groups-editor.tsx'

import type { SectionOverrideCtl } from './rom/pose-groups-editor.tsx'
import type { PoseAssetCatalog } from './rom/preset-asset-picker.tsx'

/**
 * Accordion over the eight pose asset categories — all collapsed initially
 * so the whole ROM can be scanned at a glance. Preset sections show a simple
 * form (they compile into the DthWorkflow include flags); custom sections
 * hold the group/pose grid (they compile into the extra-JSON frames and the
 * PoseAsset CSV).
 */

interface RomSectionsProps {
  sections: RomSectionsModel
  genesis: GenesisVersion
  gender: Gender
  skinning: 'linear' | 'dqs'
  catalog: PoseAssetCatalog
  /** Measured preset-block frame lengths; null while unmeasurable (assets unread). */
  presetFrames: PresetFrames | null
  /** Scanned morphs for this character's generation — enables the Morph-name
   *  autocomplete when a Scan_Morphs_<Genesis> run has produced an index. */
  morphIndex?: Array<MorphIndexEntry>
  /** Absolute frames whose morphs failed in the last ROM run (from the run log) —
   *  matching pose rows are marked red. */
  failedFrames?: Set<number>
  /** Set (with a fresh nonce) to open the section holding `frame` and scroll its
   *  pose row into view — driven by clicking a failed morph in the run report. */
  revealFrame?: { frame: number; nonce: number } | null
  /** A blocked-save validation error: open its section, scroll the pose row into
   *  view and focus its first empty field. */
  revealPose?: { section: RomSection; poseId: string; nonce: number } | null
  /** Bone-rotation morph drives along the JCM ROM (character.jcmMorphMods) —
   *  both must be passed for the JCM section's "Modify JCM frames" grid. */
  jcmMorphMods?: Array<JcmMorphMod>
  onJcmMorphModsChange?: (mods: Array<JcmMorphMod>) => void
  /**
   * Scene-override mode (the page's Override toggle, one entry per extra Daz
   * scene): the base setup locks, base rows dim until their Override checkbox
   * marks them replaced for that scene, and new frames append at group ends
   * only. Frame numbers shown come from the MERGED sections — exactly what the
   * scene's own script + CSV generate.
   */
  override?: { data: SceneOverride; onChange: (next: SceneOverride) => void }
  onChange: (sections: RomSectionsModel) => void
}

/** Shared empty-additions fallback — a stable identity (see overrideCtl). */
const EMPTY_POSES: Array<RomPose> = []

function sectionSummary(config: RomSectionConfig): string {
  if (!config.enabled) return 'disabled'
  if (config.mode === 'preset') return 'enabled'
  const poses = config.groups.reduce((sum, group) => sum + group.poses.length, 0)
  return `custom · ${config.groups.length} ${config.groups.length === 1 ? 'group' : 'groups'} · ${poses} ${poses === 1 ? 'frame' : 'frames'}`
}

/**
 * Memoized: the ROM subtree is the page's heavy part (every open pose table),
 * so page-level renders that don't change any of its props (modifier keys,
 * polling, focus refetches) must stop here. The character page passes
 * identity-stable callbacks/objects to make that hold.
 */
export const RomSections = memo(function RomSections({
  sections,
  genesis,
  gender,
  skinning,
  catalog,
  presetFrames,
  failedFrames,
  revealFrame,
  revealPose,
  morphIndex,
  jcmMorphMods,
  onJcmMorphModsChange,
  override,
  onChange,
}: RomSectionsProps) {
  const [open, setOpen] = useState<Partial<Record<RomSection, boolean>>>({})
  // The section whose scan-CSV picker is open (null = no import in progress).
  const [pickerSection, setPickerSection] = useState<RomSection | null>(null)
  // A picked CSV awaiting its frame-range dialog (null = no import in progress).
  const [pendingCsv, setPendingCsv] = useState<{
    section: RomSection
    poses: Awaited<ReturnType<typeof importPosesFromCsv>>
  } | null>(null)

  // Lowercase the autocomplete search keys ONCE per index (it can hold thousands
  // of scanned morphs) — the per-keystroke filter in MorphNameCell then compares
  // against these instead of re-lowercasing every entry on every character typed.
  const indexedMorphs = useMemo<Array<IndexedMorphEntry>>(
    () =>
      morphIndex && morphIndex.length > 0
        ? morphIndex.map((e) => ({
            ...e,
            nameLower: e.name.toLowerCase(),
            labelLower: e.label.toLowerCase(),
          }))
        : EMPTY_MORPH_INDEX,
    [morphIndex],
  )

  // Scene-override mode: everything frame-related displays the MERGED sections
  // (replaced rows in place, added rows at group ends) — exactly what the
  // scene's own artifacts generate. The base `sections` stay the editing model.
  const overrideData = override?.data
  const displaySections = overrideData ? applySceneOverride(sections, overrideData) : sections

  // The scene override's grid controller, shared by every section's group
  // editor: replaced rows keyed by base pose id, additions keyed by group id.
  // Checking a row seeds its override with a copy of the base pose. The map and
  // the empty-additions fallback keep STABLE identities across re-renders —
  // they end up in GroupCard's memoized table `data`, which must not churn.
  // The controller itself is memoized too: it's a prop of the memoized group
  // editors, so its identity may only change when the override data does.
  const overriddenById = useMemo(
    () => new Map((overrideData?.poses ?? []).map((pose) => [pose.id, pose])),
    [overrideData?.poses],
  )
  const onOverrideChange = override?.onChange
  const overrideCtl = useMemo<SectionOverrideCtl | undefined>(
    () =>
      onOverrideChange && overrideData
        ? {
            overriddenById,
            additionsFor: (groupId) =>
              overrideData.additions.find((entry) => entry.groupId === groupId)?.poses ??
              EMPTY_POSES,
            onToggleRow: (pose, on) =>
              onOverrideChange({
                ...overrideData,
                poses: on
                  ? [...overrideData.poses.filter((p) => p.id !== pose.id), clonePose(pose)]
                  : overrideData.poses.filter((p) => p.id !== pose.id),
              }),
            onReplacePose: (pose) =>
              onOverrideChange({
                ...overrideData,
                poses: overrideData.poses.map((p) => (p.id === pose.id ? pose : p)),
              }),
            onAdditionsChange: (groupId, poses) => {
              const rest = overrideData.additions.filter((entry) => entry.groupId !== groupId)
              onOverrideChange({
                ...overrideData,
                additions: poses.length > 0 ? [...rest, { groupId, poses }] : rest,
              })
            },
          }
        : undefined,
    [onOverrideChange, overrideData, overriddenById],
  )

  // Absolute timeline frame of each custom group's first pose: the measured
  // preset ROM blocks (base, GP/DK, Physics) come first, then the custom
  // sequence continues. Left empty when frames couldn't be measured — the
  // editor shows a notice and the group editors fall back to a relative count.
  // Memoized on the real inputs — these maps were rebuilt on EVERY page render
  // (and startFrames feeds the memoized group editors, so identity matters).
  const { startFrames, sectionByFrame } = useMemo(() => {
    const starts = new Map<string, number>()
    // Which section holds each absolute frame, for the "reveal a failed morph" jump.
    const byFrame = new Map<number, RomSection>()
    if (presetFrames) {
      let frame = presetFrameCount(displaySections, gender, presetFrames)
      for (const section of ROM_SECTIONS) {
        const config = displaySections[section]
        if (!config.enabled || config.mode !== 'custom') continue
        for (const group of config.groups) {
          starts.set(group.id, frame)
          for (let i = 0; i < group.poses.length; i++) byFrame.set(frame + i, section)
          frame += group.poses.length
        }
      }
    }
    return { startFrames: starts, sectionByFrame: byFrame }
  }, [displaySections, gender, presetFrames])

  // A failed morph clicked in the run report: open its section and scroll the row
  // (which carries id `dth-rom-frame-<abs>`) into view. Two rAFs so the section
  // body has mounted before we scroll.
  useEffect(() => {
    if (!revealFrame) return
    const section = sectionByFrame.get(revealFrame.frame)
    if (!section) return
    setOpen((o) => ({ ...o, [section]: true }))
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .getElementById(`dth-rom-frame-${revealFrame.frame}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealFrame?.nonce])

  // A blocked-save validation error: open the section, scroll the offending pose
  // row into view and focus the field that's actually wrong, so the fix is one
  // keystroke away. Prefer the red-bordered input (aria-invalid — a filled-but-
  // invalid name), then fall back to the first empty input (an empty required
  // field is flagged by emptiness, not aria-invalid).
  useEffect(() => {
    if (!revealPose) return
    setOpen((o) => ({ ...o, [revealPose.section]: true }))
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-pose-id="${revealPose.poseId}"]`)
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        if (!row) return
        const inputs = Array.from(row.querySelectorAll('input'))
        const target =
          inputs.find((i) => i.getAttribute('aria-invalid') === 'true') ??
          inputs.find((i) => i.value.trim() === '')
        target?.focus()
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealPose?.nonce])

  function patchSection(section: RomSection, patch: Partial<RomSectionConfig>) {
    onChange({ ...sections, [section]: { ...sections[section], ...patch } })
  }

  // ONE identity-stable groups handler shared by every section's (memoized)
  // group editor — the editor reports its section alongside the new groups, so
  // no per-section closure (which would defeat the memo) is needed.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSectionGroupsChange = useCallback((section: RomSection, groups: Array<RomGroup>) => {
    onChangeRef.current({
      ...sectionsRef.current,
      [section]: { ...sectionsRef.current[section], groups },
    })
  }, [])

  // Bulk-import a DAZ morph CSV into a section: the picker dialog lists the
  // Scan_Frames scans (plus Browse for hand-curated files); a full scene scan
  // covers the whole ROM, so the chosen file then opens the frame-range dialog
  // and applyCsvImport commits the slice.
  async function loadCsv(section: RomSection, filePath: string) {
    setPickerSection(null)
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

  async function browseCsv(section: RomSection) {
    const filePath = await pickCsvPath('Select a DAZ morph CSV')
    if (!filePath) return
    await loadCsv(section, filePath)
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
      boneScaleRef: false,
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
            : // A flat FBM/MISC section's implicit group must carry the STABLE
              // `flatSectionGroupId` (via flatGroup), NOT a random newGroup() id —
              // scene-override additions key on it, and applySceneOverride only
              // materializes flat-id additions when the base group matches. A random
              // id silently drops those overridden frames from the editor and the
              // scene's generated artifacts.
              { ...flatGroup(section), poses },
          ...config.groups.slice(1),
        ]
    patchSection(section, { enabled: true, mode: 'custom', groups })
    toast.success(
      `Imported ${inRange.length} morph${inRange.length === 1 ? '' : 's'} into ${SECTION_LABELS[section]}`,
    )
  }

  // Memoize the context value so it's referentially stable across renders —
  // constructing it inline re-renders every FigureNodeContext consumer each time.
  const figureNode = useMemo(() => genesisFigureNode(genesis, gender), [genesis, gender])

  return (
    <MorphIndexContext.Provider value={indexedMorphs}>
    <FigureNodeContext.Provider value={figureNode}>
    <div className="space-y-2">
      {!presetFrames && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Couldn't measure the preset ROM frame lengths from the pose assets, so absolute frame
          numbers are unavailable. Make sure the DTH release is scanned in Settings and reachable.
        </div>
      )}
      {overrideCtl && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          Scene override active — the base setup is locked. Check <strong>Override</strong> on a
          row to replace it for this scene, or add frames at the end of a group; everything left
          transparent stays exactly as the base ROM.
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
        // Whether the installed DTH release ships this section's preset asset for
        // the character's generation (e.g. GP/DK and Physics don't exist for
        // G8/G8.1, FAC doesn't for G8). Unavailable → preset mode isn't offered:
        // enabling the section lands directly on the custom morph list, the Mode
        // select locks the preset option, and a legacy character that still HAS
        // it enabled in preset mode gets a red chip (generation fails loud).
        // The rules live in @dth/rom next to the path resolution they gate.
        const presetAvailable = sectionPresetAvailable(
          section,
          catalog,
          genesis,
          gender,
          config.presetAssets,
        )
        const missingPresetAsset =
          effectiveEnabled && config.mode === 'preset' && !presetAvailable
        return (
          // Each section is its own wrapper on purpose: position:sticky constrains
          // the title to its parent, which is exactly what makes the NEXT section's
          // title push the previous one out (iOS-contacts style) instead of stacking.
          <div key={section} className={`rounded-lg border ${effectiveEnabled ? '' : 'opacity-60'}`}>
            {/* Sticky section title: pins below the character page's collapsed
                sticky header (collapsed header = 90px avatar box + my-5 = 130px; pinned at 128px - a 2px tuck under the solid header hides any subpixel seam), z below
                its z-10. Solid bg so rows can't show through; rounded-t so the
                bg doesn't square out the card's top corners at rest. NB: the
                ancestor `contain: layout paint` re-scopes position:fixed but NOT
                sticky (sticky binds to the scrollport, which containment doesn't
                create), and no ancestor up to the page scroller has overflow. */}
            <div className="sticky top-[128px] z-[5] flex items-center gap-3 rounded-t-lg bg-background px-4 py-3 select-none">
              {/* A real accordion BUTTON (was a click-only div): the core editing
                  surface must be focusable and Enter/Space-operable, and announce
                  its state via aria-expanded. The Switch stays OUTSIDE it — a
                  nested interactive control would be invalid HTML. */}
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [section]: !isOpen }))}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
              >
                <ChevronRight
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className="w-12 font-mono text-sm font-semibold">{section}</span>
                <span className="font-medium">{SECTION_LABELS[section]}</span>
                {missingPresetAsset && (
                  <span
                    className="rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive"
                    title={`The installed DTH release ships no ${SECTION_LABELS[section]} preset for ${genesis} — generation will fail. Disable this section or switch it to a custom asset.`}
                  >
                    no {genesis} asset
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {tiedToJcm
                    ? effectiveEnabled
                      ? 'enabled with JCM'
                      : 'disabled with JCM'
                    : sectionSummary(displaySections[section])}
                </span>
              </button>
              <span>
                <Switch
                  checked={effectiveEnabled}
                  disabled={tiedToJcm || !!overrideCtl}
                  title={
                    overrideCtl
                      ? 'Sections are part of the base setup — locked while a scene override is active'
                      : tiedToJcm
                        ? 'The retargeting poses are part of the JCM base ROM — controlled by the JCM section'
                        : effectiveEnabled
                          ? 'Disable this section'
                          : 'Enable this section'
                  }
                  onCheckedChange={(enabled) => {
                    // Enabling picks the sensible mode: no preset asset for this
                    // generation → straight to the custom morph list; preset
                    // available and the section untouched (no custom groups yet)
                    // → preset. A section the user already put groups into keeps
                    // its mode — that's a deliberate choice, not a default.
                    if (enabled && !presetAvailable && config.mode === 'preset' && modes.includes('custom')) {
                      patchSection(section, { enabled, mode: 'custom' })
                    } else if (
                      enabled &&
                      presetAvailable &&
                      config.mode === 'custom' &&
                      config.groups.length === 0 &&
                      modes.includes('preset')
                    ) {
                      patchSection(section, { enabled, mode: 'preset' })
                    } else {
                      patchSection(section, { enabled })
                    }
                  }}
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
                      <SelectTrigger size="sm" className="w-fit min-w-[12rem]" disabled={!!overrideCtl}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="preset" disabled={!presetAvailable}>
                          {presetAvailable
                            ? 'Pre-defined DTH assets'
                            : `Pre-defined DTH assets — none for ${genesis}`}
                        </SelectItem>
                        <SelectItem value="custom">
                          {section === 'JCM' ? 'Custom JCM asset' : 'Custom morph list'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {config.mode === 'preset' ? (
                  // The preset setup is base-only — inert while a scene
                  // override is active (presets aren't overridable per scene).
                  <div className={`space-y-3 ${overrideCtl ? 'pointer-events-none opacity-60' : ''}`}>
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
                        disabled={!!overrideCtl}
                        onChange={(e) => patchSection(section, { customAssetPath: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={!!overrideCtl}
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
                      failedFrames={failedFrames}
                      removable={false}
                      override={overrideCtl}
                      onGroupsChange={onSectionGroupsChange}
                    />
                    {!overrideCtl && <ImportCsvButton onImport={() => setPickerSection(section)} />}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <PoseGroupsEditor
                      section={section}
                      groups={config.groups}
                      gender={gender}
                      startFrames={startFrames}
                      failedFrames={failedFrames}
                      removable
                      override={overrideCtl}
                      onGroupsChange={onSectionGroupsChange}
                    />
                    {/* Group management + CSV import change the base structure —
                        hidden while a scene override is active. */}
                    {!overrideCtl && (
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
                        <ImportCsvButton onImport={() => setPickerSection(section)} />
                      </div>
                    )}
                  </div>
                )}

                {/* Optional bone-rotation morph drives along the JCM ROM — the
                    grid UI over character.jcmMorphMods (works with a preset OR
                    a custom base ROM; the runtime applies it after either). Set
                    off from the base-ROM fields above with a divider + spacing. */}
                {section === 'JCM' && jcmMorphMods && onJcmMorphModsChange && (
                  // Part of the base setup too — inert in override mode.
                  <div
                    className={`mt-5 border-t pt-5 ${overrideCtl ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    <JcmModsGrid mods={jcmMorphMods} onChange={onJcmMorphModsChange} />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {pickerSection && (
        <ScanCsvPickerDialog
          sectionLabel={SECTION_LABELS[pickerSection]}
          onPick={(path) => void loadCsv(pickerSection, path)}
          onBrowse={() => void browseCsv(pickerSection)}
          onClose={() => setPickerSection(null)}
        />
      )}
      {pendingCsv && (
        <CsvImportDialog
          sectionLabel={SECTION_LABELS[pendingCsv.section]}
          frames={pendingCsv.poses.map((pose) => pose.frame)}
          onConfirm={applyCsvImport}
          onClose={() => setPendingCsv(null)}
        />
      )}
    </div>
    </FigureNodeContext.Provider>
    </MorphIndexContext.Provider>
  )
})
