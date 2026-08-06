import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FolderOpen, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { toast } from 'sonner'

import {
  Button,
  InfoPopup,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SidePanel,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@dth/ui'
import {
  MATERIAL_SECTIONS,
  scanHoudiniMaterials,
  transferHoudiniMaterials,
} from '#/lib/rom/api.ts'
import type {
  CharacterWithProject,
  MaterialNodeInfo,
  MaterialScanProject,
  MaterialSection,
  MaterialUtilReport,
} from '#/lib/rom/api.ts'
import { fetchAllCharacters } from '#/lib/rom/api.ts'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { pickHipPath } from '#/lib/desktop.ts'
import { displayPath, normalizePath, parentDir } from '#/lib/path.ts'
import type { Character } from '@dth/rom'

/**
 * The Houdini card's "Utils" drawer — per-project tools that need Houdini itself
 * to answer, so each one runs hython behind `lib/rom/api/houdini-material.ts`.
 *
 * Tab 1 ("Copy from") is the texture-baker transfer: pick ONE source material
 * node (from another character's project, or any `.hip` on disk) and copy its
 * bakers onto one or more of THIS character's material nodes. The tab shape is
 * deliberate — the same drawer is where the next material utility lands.
 *
 * Why a transfer is worth a feature: a skin setup measured on a real project is
 * 4 bakers of 30 layers, each layer naming a texture, a group, a blend mode and
 * seven adjustments. Reproducing that by hand for every character is the tedium
 * this replaces.
 */

/** Label + rationale for each transferable part of a material setup. */
const SECTION_LABELS: Record<MaterialSection, { label: string; hint: string }> = {
  materials: {
    label: 'Material slots',
    hint: 'Which Daz surfaces merge into each material — the list a baker names.',
  },
  uvChannels: {
    label: 'UV channels',
    hint: 'The channels baker layers read (uv_original, uv_geoshell) and their operations.',
  },
  bakers: { label: 'Texture bakers', hint: 'The bakers themselves and all their layers.' },
}

/** A material node identified across files — the selection key everywhere here. */
function nodeKey(hipPath: string, nodePath: string): string {
  return `${normalizePath(hipPath).toLowerCase()}|${nodePath}`
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * How much a section will actually copy — shown beside each checkbox and in the
 * confirm dialog. Honours the picked materials: with `Skin` ticked this must
 * say "1 slot, 4 bakers", not the node's totals, or the dialog would promise
 * something the run doesn't do. UV channels are node-wide (they are anonymous
 * and positional), so they never narrow.
 */
function sectionCountOf(
  node: MaterialNodeInfo,
  key: MaterialSection,
  picked: ReadonlySet<string>,
): string {
  const slots = picked.size === 0 ? node.slots : node.slots.filter((s) => picked.has(s.name))
  const n =
    key === 'materials'
      ? picked.size === 0
        ? node.materials
        : slots.length
      : key === 'uvChannels'
        ? node.uvChannels
        : picked.size === 0
          ? node.bakers
          : slots.reduce((sum, s) => sum + s.bakers, 0)
  const unit = key === 'materials' ? 'slot' : key === 'uvChannels' ? 'channel' : 'baker'
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/**
 * How a material node is labelled in the picker.
 *
 * A project with several DTH networks names them with a NETWORK BOX around each
 * (`KiraDefault`, `KiraYoga`, `KiraNaked`); the nodes inside are only ever
 * `DazToHueMaterial`, `…1`, `…2`, which tells the user nothing about which
 * network they're picking. So the box title leads when there is one, with the
 * node name kept beside it — the node name is still what the report and any
 * Houdini-side lookup use.
 */
function nodeLabel(node: MaterialNodeInfo): { primary: string; secondary: string } {
  return node.networkBox
    ? { primary: node.networkBox, secondary: node.name }
    : { primary: node.name, secondary: '' }
}

/** A scan result plus the request that produced it, so a stale list is never
 *  shown against a changed selection. */
interface ScanState {
  loading: boolean
  error: string
  projects: Array<MaterialScanProject>
}

const EMPTY_SCAN: ScanState = { loading: false, error: '', projects: [] }

export function HoudiniUtilsPanel({
  open,
  onClose,
  character,
  /** The card the panel was opened from — its nodes start selected. */
  initialHipPath,
}: {
  open: boolean
  onClose: () => void
  character: Character
  initialHipPath?: string
}) {
  // --- target side: this character's own projects ---------------------------
  const targets = character.houdiniProjects
  const [targetScan, setTargetScan] = useState<ScanState>(EMPTY_SCAN)
  const [selectedTargets, setSelectedTargets] = useState<ReadonlySet<string>>(new Set())

  // --- source side ---------------------------------------------------------
  const [sourceMode, setSourceMode] = useState<'studio' | 'browse'>('studio')
  const [others, setOthers] = useState<Array<CharacterWithProject>>([])
  const [sourceCharacterId, setSourceCharacterId] = useState('')
  const [sourceHip, setSourceHip] = useState('')
  const [browsedHip, setBrowsedHip] = useState('')
  const [sourceScan, setSourceScan] = useState<ScanState>(EMPTY_SCAN)
  const [selectedSource, setSelectedSource] = useState('')

  // --- what to copy --------------------------------------------------------
  // All three by default: the parts are one setup, and bakers alone reference
  // material and UV-channel names that would not exist at the target.
  const [sections, setSections] = useState<ReadonlySet<MaterialSection>>(
    new Set(MATERIAL_SECTIONS),
  )
  // Which of the source's material slots to copy. Empty = all; reset whenever
  // the source node changes, since slot names belong to that node.
  const [pickedMaterials, setPickedMaterials] = useState<ReadonlySet<string>>(new Set())

  // --- the confirm modal ---------------------------------------------------
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [replace, setReplace] = useState(false)
  // WHICH action is running, not merely that one is: with a shared flag both
  // buttons spin, so a dry run looks exactly like the destructive one.
  const [running, setRunning] = useState<'' | 'dry' | 'run'>('')
  const busy = running !== ''
  const [report, setReport] = useState<MaterialUtilReport | null>(null)

  const targetsKey = targets.join('|')

  async function runScan(
    hipPaths: Array<string>,
    set: (next: ScanState) => void,
  ): Promise<Array<MaterialScanProject>> {
    if (hipPaths.length === 0) {
      set(EMPTY_SCAN)
      return []
    }
    set({ loading: true, error: '', projects: [] })
    try {
      const projects = await scanHoudiniMaterials({ data: { hipPaths } })
      set({ loading: false, error: '', projects })
      return projects
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ loading: false, error: message, projects: [] })
      return []
    }
  }

  // Scan the character's projects when the drawer opens. Opening a `.hip` costs
  // real seconds, so this deliberately does NOT re-run on every render — only on
  // open, on an explicit rescan, and when the linked set changes.
  useEffect(() => {
    if (!open) return
    void (async () => {
      const projects = await runScan(targets, setTargetScan)
      // Preselect the card's own nodes — the panel was opened FROM that project.
      const from = initialHipPath
      if (!from) return
      const match = projects.find(
        (p) => normalizePath(p.hipPath).toLowerCase() === normalizePath(from).toLowerCase(),
      )
      if (match) {
        setSelectedTargets(new Set(match.nodes.map((n) => nodeKey(match.hipPath, n.path))))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetsKey, initialHipPath])

  // Candidate source characters: everything the studio can reach that actually
  // HAS a Houdini project, minus this character (copying onto itself is refused
  // by the api anyway, and offering it invites the mistake).
  useEffect(() => {
    if (!open) return
    void fetchAllCharacters()
      .then((all) =>
        setOthers(all.filter((c) => c.id !== character.id && c.houdiniProjects.length > 0)),
      )
      .catch(() => setOthers([]))
  }, [open, character.id])

  // Reset everything when the drawer closes, so the next open starts clean.
  useEffect(() => {
    if (open) return
    setSelectedTargets(new Set())
    setSelectedSource('')
    setSourceHip('')
    setBrowsedHip('')
    setSourceScan(EMPTY_SCAN)
    setReport(null)
    setReplace(false)
  }, [open])

  const sourceCharacter = others.find((c) => c.id === sourceCharacterId)
  const activeSourceHip = sourceMode === 'browse' ? browsedHip : sourceHip

  // Scanning the chosen source project is a separate (and equally slow) trip —
  // only ever for the ONE file the user picked.
  // Slot names belong to a node, so a new source starts with none picked.
  useEffect(() => {
    setPickedMaterials(new Set())
  }, [selectedSource])

  useEffect(() => {
    setSelectedSource('')
    if (!open || !activeSourceHip) {
      setSourceScan(EMPTY_SCAN)
      return
    }
    void runScan([activeSourceHip], setSourceScan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSourceHip])

  async function onBrowse() {
    const picked = await pickHipPath(
      'Select a Houdini project (.hip) to copy from',
      parentDir(activeSourceHip || targets[0] || ''),
    )
    if (picked) {
      setSourceMode('browse')
      setBrowsedHip(picked)
    }
  }

  function toggleTarget(hipPath: string, nodePath: string) {
    const key = nodeKey(hipPath, nodePath)
    setSelectedTargets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // The selected source node, resolved back to its scan entry.
  const sourceNode = useMemo(() => {
    for (const project of sourceScan.projects) {
      for (const node of project.nodes) {
        if (nodeKey(project.hipPath, node.path) === selectedSource) {
          return { project, node }
        }
      }
    }
    return null
  }, [sourceScan, selectedSource])

  // Target refs for the transfer, minus the source node itself.
  const targetRefs = useMemo(() => {
    const refs: Array<{ hipPath: string; nodePath: string }> = []
    for (const project of targetScan.projects) {
      for (const node of project.nodes) {
        const key = nodeKey(project.hipPath, node.path)
        if (!selectedTargets.has(key)) continue
        if (key === selectedSource) continue
        refs.push({ hipPath: project.hipPath, nodePath: node.path })
      }
    }
    return refs
  }, [targetScan, selectedTargets, selectedSource])

  // Friendly name for any node the panel has scanned — the confirm dialog and
  // the report both name nodes, and a bare `/obj/DazToHue/DazToHueMaterial1`
  // reads as noise next to "KiraYoga".
  const labelFor = useMemo(() => {
    const byKey = new Map<string, MaterialNodeInfo>()
    for (const scan of [targetScan, sourceScan]) {
      for (const project of scan.projects) {
        for (const node of project.nodes) byKey.set(nodeKey(project.hipPath, node.path), node)
      }
    }
    return (hipPath: string, nodePath: string): string => {
      const node = byKey.get(nodeKey(hipPath, nodePath))
      if (!node) return nodePath
      const { primary, secondary } = nodeLabel(node)
      return secondary ? `${primary} (${secondary})` : primary
    }
  }, [targetScan, sourceScan])

  const canTransfer =
    sourceNode !== null && targetRefs.length > 0 && sections.size > 0 && !busy
  const sourceHasBakers = (sourceNode?.node.bakers ?? 0) > 0

  async function run(dryRun: boolean) {
    if (!sourceNode) return
    setRunning(dryRun ? 'dry' : 'run')
    setReport(null)
    try {
      const result = await transferHoudiniMaterials({
        data: {
          source: { hipPath: sourceNode.project.hipPath, nodePath: sourceNode.node.path },
          targets: targetRefs,
          sections: MATERIAL_SECTIONS.filter((key) => sections.has(key)),
          materials: [...pickedMaterials],
          replace,
          dryRun,
        },
      })
      setReport(result)
      if (!dryRun) {
        const failed = result.targets.filter((t) => !t.ok)
        if (failed.length > 0) {
          toast.error(
            `${failed.length} of ${result.targets.length} target${result.targets.length === 1 ? '' : 's'} failed — see the report.`,
          )
        } else {
          toast.success(
            `Copied ${result.sourceBakers} texture baker${result.sourceBakers === 1 ? '' : 's'} to ${result.targets.length} node${result.targets.length === 1 ? '' : 's'}.`,
          )
        }
        // The targets changed on disk — their counts are now stale.
        void runScan(targets, setTargetScan)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  return (
    <>
      <SidePanel
        open={open}
        onClose={busy ? () => {} : onClose}
        title={
          <span className="flex items-center gap-1.5">
            <Wrench className="size-4 shrink-0" />
            Utils — {character.name}
          </span>
        }
      >
        <Tabs defaultValue="copy-from">
          <TabsList>
            <TabsTrigger value="copy-from">Copy from</TabsTrigger>
          </TabsList>

          <TabsContent value="copy-from" className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Copy the texture-baker setup of one material node onto this character&apos;s
              material nodes. Bakers name their material and geometry groups as text, so a
              target that doesn&apos;t define those names takes the bakers and bakes nothing —
              the dry run lists exactly that before anything is written.
            </p>

            {/* ---------------------------------------------------------- target */}
            <section>
              <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                Target
                <InfoPopup label="Target — more information">
                  This character&apos;s linked Houdini projects and the DazToHue material nodes
                  found in each. Select every node that should receive the copied bakers.
                </InfoPopup>
              </Label>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {targets.length === 0
                    ? 'No Houdini projects linked to this character.'
                    : `${targets.length} linked project${targets.length === 1 ? '' : 's'}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={targetScan.loading || targets.length === 0}
                  onClick={() => void runScan(targets, setTargetScan)}
                >
                  <RefreshCw className={targetScan.loading ? 'animate-spin' : ''} /> Rescan
                </Button>
              </div>
              <NodePicker
                scan={targetScan}
                mode="multi"
                selected={selectedTargets}
                disabledKey={selectedSource}
                onToggle={toggleTarget}
              />
            </section>

            {/* ---------------------------------------------------------- source */}
            <section>
              <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                Source
                <InfoPopup label="Source — more information">
                  The node to copy FROM — another character&apos;s project, or any Houdini
                  project on disk. Exactly one material node can be the source.
                </InfoPopup>
              </Label>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Select
                  value={sourceCharacterId}
                  onValueChange={(value) => {
                    setSourceMode('studio')
                    setSourceCharacterId(value)
                    const next = others.find((c) => c.id === value)
                    setSourceHip(next?.houdiniProjects[0] ?? '')
                  }}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Character from the studio…" />
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((c) => (
                      <SelectItem key={`${c.projectId}|${c.id}`} value={c.id}>
                        {c.name} — {c.projectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {sourceCharacter && sourceCharacter.houdiniProjects.length > 1 && (
                  <Select
                    value={sourceMode === 'studio' ? sourceHip : ''}
                    onValueChange={(value) => {
                      setSourceMode('studio')
                      setSourceHip(value)
                    }}
                  >
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="Project…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceCharacter.houdiniProjects.map((hip) => (
                        <SelectItem key={hip} value={hip}>
                          {fileName(hip)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Same action as the picker: drag a `.hip` out of Explorer
                    straight onto the button. */}
                <FileDropZone
                  accept={['hip', 'hipnc', 'hiplc']}
                  label="Drop a Houdini project"
                  onDrop={(paths) => {
                    const dropped = paths[0]
                    if (!dropped) return
                    setSourceMode('browse')
                    setBrowsedHip(dropped)
                  }}
                >
                  <Button variant="outline" size="sm" onClick={() => void onBrowse()}>
                    <FolderOpen /> Browse…
                  </Button>
                </FileDropZone>
              </div>

              {activeSourceHip && (
                <p className="mb-2 truncate text-xs text-muted-foreground" title={activeSourceHip}>
                  {displayPath(activeSourceHip)}
                </p>
              )}

              <NodePicker
                scan={sourceScan}
                mode="single"
                selected={new Set(selectedSource ? [selectedSource] : [])}
                onToggle={(hipPath, nodePath) => setSelectedSource(nodeKey(hipPath, nodePath))}
                empty={
                  activeSourceHip
                    ? undefined
                    : 'Pick a character or browse for a Houdini project to copy from.'
                }
              />
            </section>

            {/* --------------------------------------------------------- materials */}
            {sourceNode && sourceNode.node.slots.length > 0 && (
              <section>
                <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                  Materials
                  <InfoPopup label="Materials — more information">
                    The unit you actually reuse. A material slot is the list of Daz surfaces
                    merged into one material — for a Genesis 9 skin that list is the same on
                    every character of that generation, so it transfers as-is. Clothing only
                    matches when the target wears the same asset. Each slot&apos;s texture
                    bakers travel with it.
                  </InfoPopup>
                </Label>
                <p className="mb-2 text-xs text-muted-foreground">
                  {pickedMaterials.size === 0
                    ? 'Nothing picked — every material is copied. Tick one to copy just that.'
                    : `${pickedMaterials.size} of ${sourceNode.node.slots.length} materials`}
                </p>
                <ul className="space-y-1">
                  {sourceNode.node.slots.map((slot) => {
                    const needsUv = slot.channelUvs.length > 0
                    return (
                      <li key={slot.name}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/50">
                          <input
                            type="checkbox"
                            checked={pickedMaterials.has(slot.name)}
                            onChange={() =>
                              setPickedMaterials((prev) => {
                                const next = new Set(prev)
                                if (next.has(slot.name)) next.delete(slot.name)
                                else next.add(slot.name)
                                return next
                              })
                            }
                          />
                          <span className="font-medium">{slot.displayName}</span>
                          <span className="text-muted-foreground">
                            {slot.surfaces} surface{slot.surfaces === 1 ? '' : 's'} ·{' '}
                            {slot.bakers} baker{slot.bakers === 1 ? '' : 's'} · {slot.layers}{' '}
                            layer{slot.layers === 1 ? '' : 's'}
                          </span>
                          {needsUv && (
                            <span
                              className="text-amber-500"
                              title={`These bakers read ${slot.channelUvs.join(', ')}, which only a UV channel produces — include UV channels below.`}
                            >
                              needs UV channels
                            </span>
                          )}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {/* ------------------------------------------------------ what to copy */}
            <section>
              <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                What to copy
                <InfoPopup label="What to copy — more information">
                  These are one setup, not three: a texture baker names its material
                  (<code>MI_Skin</code>) and its layers name UV channels
                  (<code>uv_original</code>, <code>uv_geoshell</code>) as plain text. Copying
                  the bakers alone leaves those names pointing at nothing, and they bake
                  nothing — which is why all three are on by default.
                </InfoPopup>
              </Label>
              <div className="space-y-1">
                {MATERIAL_SECTIONS.map((key) => (
                  <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={sections.has(key)}
                      onChange={() =>
                        setSections((prev) => {
                          const next = new Set(prev)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }
                    />
                    <span>
                      <span className="font-medium">{SECTION_LABELS[key].label}</span>
                      {sourceNode && (
                        <span className="ml-1 text-muted-foreground">
                          ({sectionCountOf(sourceNode.node, key, pickedMaterials)})
                        </span>
                      )}
                      <br />
                      <span className="text-xs text-muted-foreground">
                        {SECTION_LABELS[key].hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {!sections.has('materials') && sections.has('bakers') && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Without the material slots, the copied bakers only bake if the target
                    already defines the same material names. The dry run lists any that are
                    missing.
                  </span>
                </p>
              )}
            </section>

            {report && <TransferReport report={report} labelFor={labelFor} />}
          </TabsContent>
        </Tabs>

        {/* The panel's own footer action — the modal owns the actual run. */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t pt-4">
          {sourceNode && !sourceHasBakers && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="size-3.5" /> The source node has no texture bakers.
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {targetRefs.length} target node{targetRefs.length === 1 ? '' : 's'} selected
          </span>
          <Button
            disabled={!canTransfer}
            title={
              !sourceNode
                ? 'Select a source material node first'
                : targetRefs.length === 0
                  ? 'Select at least one target material node'
                  : sections.size === 0
                    ? 'Select at least one thing to copy'
                    : undefined
            }
            onClick={() => {
              setReport(null)
              setConfirmOpen(true)
            }}
          >
            <Wrench /> Transfer
          </Button>
        </div>
      </SidePanel>

      {confirmOpen && sourceNode && (
        <Modal
          open
          onClose={() => setConfirmOpen(false)}
          dismissible={!busy}
          title="Copy texture bakers?"
        >
          <div className="space-y-2 text-sm">
            <p>
              Copy{' '}
              <strong>
                {MATERIAL_SECTIONS.filter((key) => sections.has(key))
                  .map((key) => sectionCountOf(sourceNode.node, key, pickedMaterials))
                  .join(', ')}
              </strong>{' '}
              from <strong>{labelFor(sourceNode.project.hipPath, sourceNode.node.path)}</strong> in{' '}
              <code>{fileName(sourceNode.project.hipPath)}</code> to{' '}
              <strong>{targetRefs.length}</strong> material node
              {targetRefs.length === 1 ? '' : 's'}.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {targetRefs.map((t) => (
                <li key={nodeKey(t.hipPath, t.nodePath)}>
                  {labelFor(t.hipPath, t.nodePath)} — <code>{fileName(t.hipPath)}</code>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-start gap-3 rounded-md border p-3">
            <Switch
              id="replace-at-target"
              checked={replace}
              disabled={busy}
              onCheckedChange={setReplace}
            />
            <div className="text-sm">
              <Label htmlFor="replace-at-target" className="font-medium">
                Replace at target
              </Label>
              <p className="text-xs text-muted-foreground">
                {replace
                  ? 'Everything the targets already have in the selected sections is removed first — only the copied ones remain.'
                  : 'The copied entries are ADDED to whatever each target already has. Material slots merge by name: a slot the target already defines is left alone.'}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            A real run saves each target project. Close them in Houdini first — Houdini writes the
            whole scene on save and would overwrite this. The previous state is kept as{' '}
            <code>backup/&lt;name&gt;_dthbak.hiplc</code>.
          </p>

          {report && <TransferReport report={report} labelFor={labelFor} />}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void run(true)}>
              {running === 'dry' ? <Loader2 className="animate-spin" /> : null} Dry run
            </Button>
            <Button disabled={busy} onClick={() => void run(false)}>
              {running === 'run' ? <Loader2 className="animate-spin" /> : null} Run
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

/** The project → material-node list both sides share. */
function NodePicker({
  scan,
  mode,
  selected,
  onToggle,
  disabledKey,
  empty,
}: {
  scan: ScanState
  mode: 'single' | 'multi'
  selected: ReadonlySet<string>
  onToggle: (hipPath: string, nodePath: string) => void
  /** A node that cannot be picked here (the chosen source, in the target list). */
  disabledKey?: string
  empty?: string
}) {
  if (scan.loading) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Opening the project in Houdini — this takes a moment per file.
      </p>
    )
  }
  if (scan.error) {
    return <p className="rounded-md border border-destructive/50 p-3 text-xs text-destructive">{scan.error}</p>
  }
  if (scan.projects.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        {empty ?? 'No Houdini projects to scan.'}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {scan.projects.map((project) => (
        <div key={project.hipPath} className="rounded-md border p-3">
          <p className="truncate text-sm font-medium" title={project.hipPath}>
            {fileName(project.hipPath)}
          </p>
          {!project.ok ? (
            <p className="mt-1 text-xs text-destructive">{project.error}</p>
          ) : project.nodes.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No DazToHue material nodes in this project.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {project.nodes.map((node) => {
                const key = nodeKey(project.hipPath, node.path)
                return (
                  <li key={key}>
                    <MaterialNodeRow
                      node={node}
                      mode={mode}
                      checked={selected.has(key)}
                      disabled={disabledKey === key}
                      onToggle={() => onToggle(project.hipPath, node.path)}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * One selectable material node — the linked-project card's sibling.
 *
 * Same anatomy as the DTH Export dialog's project rows (`HipRow`): the
 * `houdini-card` tint/border with its orange left accent bar, a Houdini mark as
 * the tile, a checkbox, and a transparent cover button so the whole row toggles.
 * The heading is the network-box title when the node has one, since that is the
 * name the user gave this network.
 */
function MaterialNodeRow({
  node,
  mode,
  checked,
  disabled,
  onToggle,
}: {
  node: MaterialNodeInfo
  /** Multi = a target (checkbox); single = the one source (radio). */
  mode: 'single' | 'multi'
  checked: boolean
  /** Already chosen as the source — offered but refused, so the reason is
   *  visible rather than the row silently vanishing from the target list. */
  disabled: boolean
  onToggle: () => void
}) {
  const { primary, secondary } = nodeLabel(node)
  return (
    <div className="group/card relative w-full">
      <div
        className={`houdini-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${
          disabled ? ' opacity-50' : ''
        }`}
        data-selected={checked ? 'true' : undefined}
      >
        <input
          type={mode === 'multi' ? 'checkbox' : 'radio'}
          name={mode === 'single' ? 'material-source' : undefined}
          className="relative z-10 size-4 shrink-0 accent-houdini-orange"
          aria-label={primary}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
        />
        <span className="flex aspect-[3/4] h-[56px] shrink-0 items-center justify-center rounded-md bg-[#262626]">
          <img src={houdiniLogo} alt="" aria-hidden className="size-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">
            {primary}
            {secondary && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground/70">
                {secondary}
              </span>
            )}
          </span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={node.path}>
            {node.materials} material{node.materials === 1 ? '' : 's'} · {node.uvChannels} UV
            channel{node.uvChannels === 1 ? '' : 's'} · {node.bakers} baker
            {node.bakers === 1 ? '' : 's'} · {node.layers} layer{node.layers === 1 ? '' : 's'}
          </p>
          {disabled && <p className="mt-0.5 text-xs text-muted-foreground">Chosen as the source</p>}
        </div>
      </div>
      {!disabled && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          className="absolute inset-0 rounded-lg"
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-houdini-orange"
      />
    </div>
  )
}

/** What a run (or dry run) did, per target. */
function TransferReport({
  report,
  labelFor,
}: {
  report: MaterialUtilReport
  /** Network-box name for a node — falls back to the node path when unscanned. */
  labelFor: (hipPath: string, nodePath: string) => string
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Transfer complete'}
      </p>
      <ul className="space-y-2 text-xs">
        {report.targets.map((target) => (
          <li key={`${target.hipPath}|${target.nodePath}`}>
            <p className="truncate" title={`${target.hipPath} — ${target.nodePath}`}>
              <strong>{labelFor(target.hipPath, target.nodePath)}</strong> —{' '}
              <code>{fileName(target.hipPath)}</code>
            </p>
            {target.ok ? (
              <p className="text-muted-foreground">
                {target.sections
                  .map(
                    (s) =>
                      `${SECTION_LABELS[s.key as MaterialSection]?.label ?? s.key} ${s.before} → ${s.after}` +
                      (s.skipped > 0 ? ` (${s.skipped} already defined, kept)` : ''),
                  )
                  .join(' · ')}
                {target.replaced ? ' — replaced' : ' — added'}
                {target.backupPath ? ' · backup written' : ''}
              </p>
            ) : (
              <p className="text-destructive">{target.error}</p>
            )}
            {target.missingMaterials.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Set up first: this node still has no material named{' '}
                  {target.missingMaterials.map((m) => `"${m}"`).join(', ')} — add a matching slot
                  in the Materials tab (or include Material slots above), or those bakers produce
                  no texture.
                </span>
              </p>
            )}
            {target.missingUvSources.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Set up first: these bakers read {target.missingUvSources.join(', ')}, which only
                  a UV channel produces — tick UV channels, or build the same channel at the
                  target.
                </span>
              </p>
            )}
            {target.missingGroups.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>Groups not found on the target geometry: {target.missingGroups.join(', ')}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
