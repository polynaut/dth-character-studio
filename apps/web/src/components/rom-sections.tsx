import { useEffect, useMemo, useState } from 'react'

import { ChevronRight, FolderOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { pickCsvPath, pickDufPath } from '#/lib/desktop.ts'
import { importPosesFromCsv } from '#/lib/rom/api.ts'

import { Button } from '#/components/ui/button.tsx'
import { CsvImportDialog } from '#/components/csv-import-dialog.tsx'
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
  GROUPED_SECTIONS,
  ROM_SECTIONS,
  SECTION_LABELS,
  SECTION_MODES,
  genAssetGender,
  genRomIncludes,
  genesisFigureNode,
  newId,
  presetFrameCount,
} from '@dth/rom'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
import type {
  Gender,
  GenesisVersion,
  PresetFrames,
  RomGroup,
  RomPose,
  RomSection,
  RomSectionConfig,
  RomSections as RomSectionsModel,
  SectionMode,
} from '@dth/rom'

import { ArtDirectionEditor } from './rom/art-direction.tsx'
import { EMPTY_MORPH_INDEX, FigureNodeContext, MorphIndexContext } from './rom/contexts.ts'
import type { IndexedMorphEntry } from './rom/contexts.ts'
import { ImportCsvButton } from './rom/import-csv-button.tsx'
import { PRESET_DESCRIPTIONS, PresetAssetPicker } from './rom/preset-asset-picker.tsx'
import { PoseGroupsEditor, flatGroup } from './rom/pose-groups-editor.tsx'

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
  onChange: (sections: RomSectionsModel) => void
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
  failedFrames,
  revealFrame,
  morphIndex,
  onChange,
}: RomSectionsProps) {
  const [open, setOpen] = useState<Partial<Record<RomSection, boolean>>>({})
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

  // Absolute timeline frame of each custom group's first pose: the measured
  // preset ROM blocks (base, GP/DK, Physics) come first, then the custom
  // sequence continues. Left empty when frames couldn't be measured — the
  // editor shows a notice and the group editors fall back to a relative count.
  const startFrames = new Map<string, number>()
  // Which section holds each absolute frame, for the "reveal a failed morph" jump.
  const sectionByFrame = new Map<number, RomSection>()
  if (presetFrames) {
    let frame = presetFrameCount(sections, gender, presetFrames)
    for (const section of ROM_SECTIONS) {
      const config = sections[section]
      if (!config.enabled || config.mode !== 'custom') continue
      for (const group of config.groups) {
        startFrames.set(group.id, frame)
        for (let i = 0; i < group.poses.length; i++) sectionByFrame.set(frame + i, section)
        frame += group.poses.length
      }
    }
  }

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
    <MorphIndexContext.Provider value={indexedMorphs}>
    <FigureNodeContext.Provider value={genesisFigureNode(genesis, gender)}>
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
        // Whether the installed DTH release ships this section's preset asset for
        // the character's generation (e.g. GP/DK and Physics don't exist for
        // G8/G8.1, FAC doesn't for G8). Unavailable → preset mode isn't offered:
        // enabling the section lands directly on the custom morph list, the Mode
        // select locks the preset option, and a legacy character that still HAS
        // it enabled in preset mode gets a red chip (generation fails loud).
        // FAC rides in a FAC-variant JCM base ROM, not a FAC-section asset.
        const presetAvailable = (() => {
          if (catalog.assets.length === 0) return true // catalog unknown — don't lock
          const forGen = catalog.assets.filter(
            (a) => a.genesis === null || a.genesis === genesis,
          )
          if (section === 'JCM') return forGen.some((a) => a.section === 'JCM')
          if (section === 'FAC')
            return forGen.some((a) => a.section === 'JCM' && a.includesFac)
          if (section === 'GEN') {
            const roms = genRomIncludes(gender, config.presetAssets)
            const has = (g: Gender) =>
              forGen.some((a) => a.section === 'GEN' && genAssetGender(a.name) === g)
            return (!roms.gp || has('female')) && (!roms.dk || has('male'))
          }
          if (section === 'PHY') return forGen.some((a) => a.section === 'PHY')
          return true
        })()
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
            <div
              className="sticky top-[128px] z-[5] flex cursor-pointer items-center gap-3 rounded-t-lg bg-background px-4 py-3 select-none"
              onClick={() => setOpen((o) => ({ ...o, [section]: !isOpen }))}
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
                  onCheckedChange={(enabled) =>
                    // No preset asset for this generation → enabling goes
                    // straight to the custom morph list (preset isn't offered).
                    patchSection(
                      section,
                      enabled &&
                        !presetAvailable &&
                        config.mode === 'preset' &&
                        modes.includes('custom')
                        ? { enabled, mode: 'custom' }
                        : { enabled },
                    )
                  }
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
                      failedFrames={failedFrames}
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
                      failedFrames={failedFrames}
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
    </FigureNodeContext.Provider>
    </MorphIndexContext.Provider>
  )
}
