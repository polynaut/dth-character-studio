import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChevronRight, FolderOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { pickCsvPath, pickDufPath } from '#/lib/desktop.ts'
import { importPosesFromCsv } from '#/lib/rom/api.ts'

import { Button, Input, OverrideMark, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@dth/ui'
import { CsvImportDialog } from '#/components/csv-import-dialog.tsx'
import { ScanCsvPickerDialog } from '#/components/scan-csv-picker-dialog.tsx'
import {
  GROUPED_SECTIONS,
  ROM_SECTIONS,
  SECTION_LABELS,
  SECTION_MODES,
  applySceneOverride,
  flatSectionGroupId,
  genesisFigureNode,
  newId,
  presetFrameCount,
  romPoseEqual,
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
import { FigureNodeContext } from './rom/contexts.ts'
import { MorphIndexProvider } from './rom/morph-index-provider.tsx'
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
  /** A non-primary scene is selected but its ROM override isn't armed yet — the
   *  whole ROM is read-only (a dimmed base view) until the page's Override toggle
   *  arms it, exactly like the other per-scene panels. Sections still expand so
   *  the rows can be inspected. */
  locked?: boolean
  onChange: (sections: RomSectionsModel) => void
}

/** Shared empty-additions fallback — a stable identity (see overrideCtl). */
const EMPTY_POSES: Array<RomPose> = []

/** Stable per-section fallback for an EMPTY flat FBM/MISC section. flatGroup is
 *  deterministic per section (its id is the core's `flatSectionGroupId`), but a
 *  freshly built `[flatGroup(section)]` each render defeated the
 *  PoseGroupsEditor/GroupCard memo chain — so the singleton is cached here. */
const FLAT_GROUP_FALLBACKS = new Map<RomSection, Array<RomGroup>>()
function flatGroupFallback(section: RomSection): Array<RomGroup> {
  let groups = FLAT_GROUP_FALLBACKS.get(section)
  if (!groups) {
    groups = [flatGroup(section)]
    FLAT_GROUP_FALLBACKS.set(section, groups)
  }
  return groups
}

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
  locked = false,
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


  // Scene-override mode: everything frame-related displays the MERGED sections
  // (replaced rows in place, added rows at group ends, and a whole-owned section
  // verbatim) — exactly what the scene's own artifacts generate. The base `sections`
  // stay the editing model. Memoized so a section's `groups` keep a stable identity
  // across renders (they feed the memoized group tables' `data`).
  const overrideData = override?.data
  const displaySections = useMemo(
    () => (overrideData ? applySceneOverride(sections, overrideData) : sections),
    [sections, overrideData],
  )

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
  // Base (primary-scene) pose by id, across every section — so an override edited
  // back to match its base row can be dropped instead of lingering as a green no-op.
  const basePoseById = useMemo(() => {
    const map = new Map<string, RomPose>()
    for (const section of ROM_SECTIONS) {
      for (const group of sections[section].groups) {
        for (const pose of group.poses) map.set(pose.id, pose)
      }
    }
    return map
  }, [sections])
  const onOverrideChange = override?.onChange
  const overrideCtl = useMemo<SectionOverrideCtl | undefined>(
    () =>
      onOverrideChange && overrideData
        ? {
            overriddenById,
            additionsFor: (groupId) =>
              overrideData.additions.find((entry) => entry.groupId === groupId)?.poses ??
              EMPTY_POSES,
            // Arm-on-edit: editing a base row upserts its override copy (keyed by the
            // base pose id); the display substitutes it in place. There's no explicit
            // "check to override" — touching the row IS the override. But an edit that
            // lands back ON the base row (e.g. a bone-scale flag toggled off again)
            // drops the copy, so the row stops reading as overridden.
            upsertPose: (pose) => {
              const base = basePoseById.get(pose.id)
              const rest = overrideData.poses.filter((p) => p.id !== pose.id)
              onOverrideChange({
                ...overrideData,
                poses: base && romPoseEqual(pose, base) ? rest : [...rest, pose],
              })
            },
            // Reset a base row → drop its override copy so it falls back to the base.
            resetPose: (poseId) =>
              onOverrideChange({
                ...overrideData,
                poses: overrideData.poses.filter((p) => p.id !== poseId),
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
    [onOverrideChange, overrideData, overriddenById, basePoseById],
  )
  // On a non-primary scene the section STRUCTURE (enable/mode/groups) is locked —
  // whether the override is armed (overrideCtl) or not (locked). Mute the section
  // titles to match their disabled enable toggle, so the whole block reads as
  // "structure fixed for this scene, you're only overriding frame values".
  const structureLocked = !!overrideCtl || locked

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

  // ONE identity-stable groups handler shared by every section's (memoized) group
  // editor — the editor reports its section alongside the new groups, so no
  // per-section closure (which would defeat the memo) is needed. Latest-ref so the
  // stable callback always sees the current sections / override.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const overrideDataRef = useRef(overrideData)
  overrideDataRef.current = overrideData
  const onOverrideChangeRef = useRef(onOverrideChange)
  onOverrideChangeRef.current = onOverrideChange
  const onSectionGroupsChange = useCallback((section: RomSection, groups: Array<RomGroup>) => {
    const od = overrideDataRef.current
    const emitOverride = onOverrideChangeRef.current
    if (!od || !emitOverride) {
      // Primary scene → edit the base sections directly.
      onChangeRef.current({
        ...sectionsRef.current,
        [section]: { ...sectionsRef.current[section], groups },
      })
      return
    }
    if (od.sectionOverrides.some((s) => s.section === section)) {
      // The scene already OWNS this section (escalated) → update its stored groups.
      emitOverride({
        ...od,
        sectionOverrides: od.sectionOverrides.map((s) =>
          s.section === section ? { section, groups } : s,
        ),
      })
      return
    }
    // First structural edit on this section for this scene → ESCALATE. `groups` is the
    // merged section (base rows with their per-scene value edits + appended rows, now
    // reordered / inserted / with a row removed), so snapshot it whole and drop this
    // section's sparse entries — the whole-section override supersedes them.
    const base = sectionsRef.current[section]
    const basePoseIds = new Set(base.groups.flatMap((g) => g.poses.map((p) => p.id)))
    const sectionGroupIds = new Set([...base.groups.map((g) => g.id), flatSectionGroupId(section)])
    emitOverride({
      ...od,
      poses: od.poses.filter((p) => !basePoseIds.has(p.id)),
      additions: od.additions.filter((a) => !sectionGroupIds.has(a.groupId)),
      sectionOverrides: [...od.sectionOverrides, { section, groups }],
    })
  }, [])

  // Per-scene enable/disable of a whole section. Stored only when it DIFFERS from
  // the base (toggling back to the base value drops the entry, so the mark quiets).
  // The base section's mode/groups are untouched — a disabled section just stops
  // contributing frames for this scene; an enabled one uses the base config.
  const onSectionEnabledChange = useCallback((section: RomSection, enabled: boolean) => {
    const od = overrideDataRef.current
    const emit = onOverrideChangeRef.current
    if (!od || !emit) return
    const baseEnabled = sectionsRef.current[section].enabled
    const rest = od.sectionEnabled.filter((s) => s.section !== section)
    emit({
      ...od,
      sectionEnabled: enabled === baseEnabled ? rest : [...rest, { section, enabled }],
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
    <MorphIndexProvider morphIndex={morphIndex}>
    <FigureNodeContext.Provider value={figureNode}>
    <div className="space-y-2">
      {!presetFrames && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Couldn't measure the preset ROM frame lengths from the pose assets, so absolute frame
          numbers are unavailable. Make sure the DTH release is scanned in Settings and reachable.
        </div>
      )}
      {ROM_SECTIONS.map((section) => {
        const config = sections[section]
        // The MERGED section (base + this scene's overrides, incl. per-scene
        // enable/disable). On the primary scene displaySections === sections.
        const mergedConfig = displaySections[section]
        const modes = SECTION_MODES[section]
        const isOpen = open[section] ?? false
        // RET has no independent existence: the retargeting poses live inside
        // the JCM base ROM, so its state is derived from the JCM section.
        const tiedToJcm = section === 'RET'
        // The effective on/off state reads the MERGED sections, so a section a scene
        // has toggled shows (and the wrapper dims) for the override, not the base.
        const effectiveEnabled = tiedToJcm
          ? displaySections.JCM.enabled && displaySections.JCM.mode === 'preset'
          : mergedConfig.enabled
        // A scene has flipped THIS section's on/off state vs the primary — the section
        // is overridden even with no row edits (RET follows JCM, never toggled alone).
        const enabledOverridden =
          !!overrideData && !tiedToJcm && mergedConfig.enabled !== config.enabled
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
        // Scene-override editing model for THIS section. Not escalated → the sparse
        // ctl edits base rows/appends (green) over the merged display; once a
        // structural edit escalates it, the scene OWNS the section and it edits like
        // the primary (plain groups, no ctl) — just stored on its sectionOverride.
        const escalated = !!overrideData?.sectionOverrides.some((s) => s.section === section)
        const editorGroups = overrideData ? displaySections[section].groups : config.groups
        const editorOverride = overrideData && !escalated ? overrideCtl : undefined
        // The section-title override marker: shown for a custom, enabled section on a
        // non-primary scene. Green (with a reset-all that clears every override kind
        // for the section) whenever the section diverges from the primary scene's ROM
        // in ANY way — a sparse per-row value edit, an appended frame, or a whole-
        // section escalation. Base pose / group ids attribute the sparse `poses` and
        // `additions` back to their section; upsertPose already drops a per-row copy
        // that matches its base, so every entry counted here is a real divergence.
        // The mark shows on a non-primary scene for any toggleable section (never RET):
        // a custom+enabled section offers row overrides (its resting hint), and ANY
        // section can be enable/disable-overridden — so it also shows once that diverges,
        // even for a preset or a now-disabled section (which fails the first clause).
        const showSectionMark =
          !!overrideData &&
          !tiedToJcm &&
          ((effectiveEnabled && config.mode === 'custom') || enabledOverridden)
        const sectionPoseIds = new Set(config.groups.flatMap((g) => g.poses.map((p) => p.id)))
        const sectionGroupIds = new Set([
          ...config.groups.map((g) => g.id),
          flatSectionGroupId(section),
        ])
        const sectionOverridden =
          enabledOverridden ||
          escalated ||
          (overrideData?.poses.some((p) => sectionPoseIds.has(p.id)) ?? false) ||
          (overrideData?.additions.some((a) => sectionGroupIds.has(a.groupId)) ?? false)
        // Head-area text colour. A section carrying a scene override brightens its
        // whole title row to white so it reads as active; otherwise it dims to muted
        // in the locked/override view, or keeps the default foreground on the primary.
        const headText = sectionOverridden
          ? 'text-white'
          : structureLocked
            ? 'text-muted-foreground'
            : ''
        return (
          // Each section is its own wrapper on purpose: position:sticky constrains
          // the title to its parent, which is exactly what makes the NEXT section's
          // title push the previous one out (iOS-contacts style) instead of stacking.
          <div key={section} className={`rounded-lg border ${effectiveEnabled ? '' : 'opacity-60'}`}>
            {/* Sticky section title: pins right below the character page's collapsed
                sticky header via `--sticky-header-h` (published live by EditorHeader,
                since the header's collapsed height is dynamic — a hardcoded px drifts
                as the design changes). z below its z-10. Solid bg so rows can't show
                through; rounded-t so the bg doesn't square out the card's top corners
                at rest. NB: the ancestor `contain: layout paint` re-scopes
                position:fixed but NOT sticky (sticky binds to the scrollport, which
                containment doesn't create), and no ancestor up to the page scroller
                has overflow. */}
            <div
              className="sticky z-[5] flex items-center gap-3 rounded-t-lg bg-background px-4 py-3 select-none"
              style={{ top: 'calc(var(--sticky-header-h, 128px) + var(--override-bar-h, 0px))' }}
            >
              {/* A real accordion BUTTON (was a click-only div): the core editing
                  surface must be focusable and Enter/Space-operable, and announce
                  its state via aria-expanded. The Switch stays OUTSIDE it — a
                  nested interactive control would be invalid HTML. */}
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [section]: !isOpen }))}
                className="flex min-w-0 cursor-pointer items-center gap-3 text-left"
              >
                <ChevronRight
                  className={`size-4 shrink-0 transition-transform ${sectionOverridden ? 'text-white' : 'text-muted-foreground'} ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className={`w-12 font-mono text-sm font-semibold ${headText}`}>
                  {section}
                </span>
                <span className={`font-medium ${headText}`}>{SECTION_LABELS[section]}</span>
                {missingPresetAsset && (
                  <span
                    className="rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive"
                    title={`The installed DTH release ships no ${SECTION_LABELS[section]} preset for ${genesis} — generation will fail. Disable this section or switch it to a custom asset.`}
                  >
                    no {genesis} asset
                  </span>
                )}
              </button>
              {/* Per-scene section override marker — sits at the END of the section
                  TITLE (right after the label), and is a SIBLING of the accordion
                  button (never nested: a button inside a button is invalid HTML). It
                  goes green whenever the section diverges from the primary scene's ROM
                  — a per-row value edit, an added frame, or a whole-section escalation
                  — and its reset clears every override kind for the section at once,
                  restoring the primary scene's ROM. */}
              {showSectionMark && (
                <OverrideMark
                  overridden={sectionOverridden}
                  resetTitle="Reset this section to the primary scene's ROM"
                  onReset={() => {
                    if (!overrideData || !onOverrideChange) return
                    onOverrideChange({
                      ...overrideData,
                      poses: overrideData.poses.filter((p) => !sectionPoseIds.has(p.id)),
                      additions: overrideData.additions.filter(
                        (a) => !sectionGroupIds.has(a.groupId),
                      ),
                      sectionOverrides: overrideData.sectionOverrides.filter(
                        (s) => s.section !== section,
                      ),
                      // Restore the primary scene's on/off state too (drop the entry).
                      sectionEnabled: overrideData.sectionEnabled.filter(
                        (s) => s.section !== section,
                      ),
                    })
                  }}
                />
              )}
              {/* The section summary now floats right on its own (was inside the button)
                  so the override mark can hug the title. ml-auto pushes it + the Switch
                  to the right edge. */}
              <span
                className={`ml-auto text-xs ${sectionOverridden ? 'text-white' : 'text-muted-foreground'}`}
              >
                {tiedToJcm
                  ? effectiveEnabled
                    ? 'enabled with JCM'
                    : 'disabled with JCM'
                  : sectionSummary(displaySections[section])}
              </span>
              {/* A direct flex child of the items-center row so it centers on the
                  summary text's line. (Wrapped in a bare <span> it blockified as a
                  flex item, and the switch rode that span's text baseline — a hair
                  high.) It stays a SIBLING of the button, never nested — a control
                  inside a button is invalid HTML. */}
              <Switch
                checked={effectiveEnabled}
                // Once the scene flips this section's on/off state, the toggle wears
                // the override green like every other overridden boolean on the form
                // (a green track when on, a light-green knob when off-but-overridden).
                variant={enabledOverridden ? 'green' : 'default'}
                disabled={tiedToJcm || locked}
                title={
                  tiedToJcm
                    ? 'The retargeting poses are part of the JCM base ROM — controlled by the JCM section'
                    : overrideData
                      ? effectiveEnabled
                        ? 'Disable this section for this Daz scene'
                        : 'Enable this section for this Daz scene'
                      : effectiveEnabled
                        ? 'Disable this section'
                        : 'Enable this section'
                }
                onCheckedChange={(enabled) => {
                  // On a non-primary scene the toggle is a per-scene override: flip the
                  // MERGED on/off state (mode/groups stay the base's).
                  if (overrideData) {
                    onSectionEnabledChange(section, enabled)
                    return
                  }
                  // Base (primary) toggle. Enabling picks the sensible mode: no preset
                  // asset for this generation → straight to the custom morph list; preset
                  // available and the section untouched (no custom groups yet) → preset. A
                  // section the user already put groups into keeps its mode — a deliberate
                  // choice, not a default.
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
            </div>

            {isOpen && (
              // Locked (non-primary scene, override unarmed): the native fieldset
              // disable cascades to every editing control below, so the rows show
              // as a dimmed read-only base view. The accordion button + section
              // Switch sit in the header ABOVE, so expanding still works.
              <fieldset disabled={locked} className={`space-y-3 border-t px-4 py-4${locked ? ' opacity-60' : ''}`}>
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
                      groups={editorGroups.length > 0 ? editorGroups : flatGroupFallback(section)}
                      gender={gender}
                      startFrames={startFrames}
                      failedFrames={failedFrames}
                      removable={false}
                      override={editorOverride}
                      locked={locked}
                      onGroupsChange={onSectionGroupsChange}
                    />
                    {/* CSV import bulk-edits the base structure — primary scene only. */}
                    {!overrideData && <ImportCsvButton onImport={() => setPickerSection(section)} />}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <PoseGroupsEditor
                      section={section}
                      groups={editorGroups}
                      gender={gender}
                      startFrames={startFrames}
                      failedFrames={failedFrames}
                      removable
                      override={editorOverride}
                      locked={locked}
                      onGroupsChange={onSectionGroupsChange}
                    />
                    {/* Add group edits whatever the editor owns (base on the primary,
                        the scene's sectionOverride once escalated); hidden on a scene
                        that hasn't escalated this section yet (a row edit escalates
                        first). CSV import is a base-structure bulk op — primary only. */}
                    {!editorOverride && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            onSectionGroupsChange(section, [
                              ...editorGroups,
                              {
                                id: newId(),
                                label: '',
                                suffix: 'centre',
                                method: 'default',
                                calculateFrom: 'default',
                                poses: [],
                              },
                            ])
                          }
                        >
                          <Plus /> Add group
                        </Button>
                        {!overrideData && (
                          <ImportCsvButton onImport={() => setPickerSection(section)} />
                        )}
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
              </fieldset>
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
    </MorphIndexProvider>
  )
})
