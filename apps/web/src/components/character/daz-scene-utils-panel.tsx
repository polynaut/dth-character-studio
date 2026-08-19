import { useEffect, useState } from 'react'
import { Ban, Loader2, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'

import {
  Button,
  InfoPopup,
  Label,
  SidePanel,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useArmedWatch,
  useCoalescedRefresh,
  useRefetchOnFocus,
} from '@dth/ui'
import { MultipleDazModal } from '#/components/multiple-daz-modal.tsx'
import { RunnerGateNotice } from '#/components/runner-gate-notice.tsx'
import {
  MultipleDazInstancesError,
  PROJECT_SCAN_RUN,
  abortProjectScanRun,
  fetchExportRunProgress,
  fetchExportRunnerGate,
  fetchProjectScanPlan,
  ingestProjectProductScans,
  startProjectScan,
  watchExportRunFiles,
} from '#/lib/rom/api.ts'
import { normalizeSceneKey } from '#/lib/rom/execute-jobs.ts'
import dazLogo from '#/assets/daz-logo.png'
import { sceneHairExportEnabled, sceneOverrideSchema, sceneRecordEmpty } from '@dth/rom'

import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character, SceneOverride } from '@dth/rom'
import type { ProjectScanPlan, RunnerGate } from '#/lib/rom/api.ts'

/** A scene's `.duf` file name — what the drawer title shows for its scope. */
function fileName(scenePath: string): string {
  return scenePath.split(/[\\/]/).pop() ?? scenePath
}

/**
 * The Daz scene cards' **Utils drawer** — the per-scene twin of the Houdini
 * project Utils drawer, scoped to the ONE scene whose 🔧 button opened it.
 * One General tab (the tab bar is the shared drawer shape, ready for more):
 *
 * - **Scan this scene** — the two scene passes of Tools → Scan project
 *   (products / morphs), narrowed to this scene: the same
 *   {@link startProjectScan} batch with a one-scene selection, followed
 *   through the same {@link PROJECT_SCAN_RUN} watch (pending = abortable,
 *   running = Daz works the row).
 * - **Export hair items** — the per-scene switch on the DTH Export flow's hair
 *   pass (schema v37): ON by default for the primary scene, OFF for extras;
 *   the stored value exists only while the choice differs from that default
 *   ({@link sceneHairExportEnabled} resolves the effective answer). Only the
 *   export pass is gated — the scene's hair items stay hidden from the main
 *   export either way.
 */
export function DazSceneUtilsPanel({
  open,
  onClose,
  character,
  targetScene,
  projectId,
  persistPatch,
  dazProductsEnabled,
}: {
  open: boolean
  onClose: () => void
  character: Character
  /** The scene whose Utils button was pressed — the drawer's entire scope. */
  targetScene: string
  projectId: string
  /** The draft hook's immediate-persist primitive — the hair switch saves (and
   *  regenerates the scripts that embed the per-scene map) through it. */
  persistPatch: PersistCharacterPatch
  /** The project's "Daz Products" opt-in — without it the product scan refuses,
   *  so the button explains instead of failing. */
  dazProductsEnabled: boolean
}) {
  const [starting, setStarting] = useState<'products' | 'morphs' | ''>('')
  const [multiDaz, setMultiDaz] = useState(false)
  // The run's watch phase: 'pending' = job file written, not yet claimed
  // (abortable); 'running' = the Runner renamed it and works the row.
  const [phase, setPhase] = useState<'idle' | 'pending' | 'running'>('idle')
  const [aborting, setAborting] = useState(false)
  const [savingHair, setSavingHair] = useState(false)
  // null = the Runner probe is still running (the buttons stay off meanwhile).
  const [runner, setRunner] = useState<RunnerGate | null>(null)
  // Only `dimConfigured` is read from it — but the probe also tells a plain
  // browser apart from the desktop app (it returns un-configured there).
  const [plan, setPlan] = useState<ProjectScanPlan | null>(null)

  useEffect(() => {
    let active = true
    // A failed probe must not brick the scans — only a definite missing/outdated
    // verdict blocks (the gate treats unreadable runner states as unblocked).
    fetchExportRunnerGate()
      .then((gate) => {
        if (active) setRunner(gate)
      })
      .catch(() => {
        if (active) setRunner({ blocked: false })
      })
    return () => {
      active = false
    }
  }, [])

  // Settings change in other windows (the DIM manifests folder lives there) —
  // re-probe on focus like the Tools panel does.
  useRefetchOnFocus(
    () => {
      void fetchProjectScanPlan({ data: { projectId } })
        .then(setPlan)
        .catch(() => setPlan(null))
    },
    [projectId],
    { immediate: true },
  )

  // The shared watch, polled as the run's OWNER (the same sentinel watcher id
  // the Tools panel uses — the two are never mounted in one window at once):
  // only the owner receives — and consumes — the finished/dead snapshot.
  async function refresh() {
    const run = await fetchExportRunProgress(PROJECT_SCAN_RUN)
    if (!run || run.characterId !== PROJECT_SCAN_RUN) {
      setPhase('idle')
      return
    }
    if (run.state === 'finished') {
      setPhase('idle')
      // Take in what a product pass wrote. Project-wide like the Tools panel's
      // pickup — a one-scene batch only produces this character's results, and
      // the ingest is a cheap no-op for everyone else.
      await ingestProjectProductScans({ data: { projectId } })
      if (run.failed > 0) {
        toast.warning('The scene scan finished with a failed row.', {
          description: run.errors.length ? run.errors.join('\n') : undefined,
        })
      } else {
        toast.success('Scene scan complete — the autocompletes and product results are current.')
      }
      return
    }
    if (run.state === 'dead') {
      setPhase('idle')
      toast.error('The scene scan did not finish — Daz Studio is no longer running.')
      return
    }
    setPhase(run.state === 'pending' ? 'pending' : 'running')
  }

  // One coalesced funnel for every refresh trigger (focus, watch event,
  // heartbeat): the finished snapshot above is destructive — it consumes the
  // run, ingests the product scans and toasts — and two refreshes racing over
  // that moment must not both act on it.
  const refreshCoalesced = useCoalescedRefresh(refresh)

  useRefetchOnFocus(
    () => {
      void refreshCoalesced()
    },
    [],
    { immediate: true },
  )
  // Real file watching while a run is live (see the Tools panel for the full
  // rationale); the interval is the heartbeat under events a NAS share may
  // swallow, and the one prompter for a Daz that died mid-run.
  const live = phase !== 'idle'
  const runWatchArmed = useArmedWatch(live, () =>
    watchExportRunFiles(() => void refreshCoalesced()),
  )
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => void refreshCoalesced(), runWatchArmed ? 15_000 : 2500)
    return () => window.clearInterval(id)
    // Re-armed on the booleans alone — refresh captures nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, runWatchArmed])

  async function onScan(kind: 'products' | 'morphs') {
    setStarting(kind)
    try {
      const summary = await startProjectScan({
        data: {
          projectId,
          base: false,
          morphs: kind === 'morphs',
          products: kind === 'products',
          scenes: [targetScene],
        },
      })
      toast.success(
        summary.dazWasRunning
          ? 'Handed the scene scan to Daz Studio.'
          : 'Started Daz Studio — the scene scan is queued.',
      )
      await refresh()
    } catch (e) {
      if (e instanceof MultipleDazInstancesError) setMultiDaz(true)
      else toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting('')
    }
  }

  async function onAbort() {
    setAborting(true)
    try {
      await abortProjectScanRun()
      setPhase('idle')
      toast.success('Scan aborted — the job file was deleted, nothing will run.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setAborting(false)
    }
  }

  const sceneKey = normalizeSceneKey(targetScene)
  const isPrimary = sceneKey !== '' && sceneKey === normalizeSceneKey(character.scenePath)
  const hairExportOn = sceneHairExportEnabled(character, targetScene)
  const sceneRecord = character.sceneOverrides.find(
    (record) => normalizeSceneKey(record.scenePath) === sceneKey,
  )
  const hairCount = sceneRecord?.hair.length ?? 0

  /** Store the switch under the present-iff-divergent rule: the field exists
   *  only while the choice differs from the scene's default (primary = on,
   *  extra = off), and a record left carrying nothing is dropped. */
  async function onHairToggle(next: boolean) {
    setSavingHair(true)
    try {
      const record: SceneOverride =
        sceneRecord ?? sceneOverrideSchema.parse({ scenePath: targetScene })
      const updated: SceneOverride = {
        ...record,
        exportHair: next === isPrimary ? undefined : next,
      }
      const others = character.sceneOverrides.filter(
        (other) => normalizeSceneKey(other.scenePath) !== sceneKey,
      )
      await persistPatch(
        { sceneOverrides: sceneRecordEmpty(updated) ? others : [...others, updated] },
        {
          toast: next
            ? 'Hair items export for this scene — scripts regenerated'
            : 'Hair export off for this scene — scripts regenerated',
        },
      )
    } finally {
      setSavingHair(false)
    }
  }

  const busy = phase !== 'idle' || starting !== ''
  const productsOff = !dazProductsEnabled || (plan !== null && !plan.dimConfigured)
  const scanBlocked = busy || (runner?.blocked ?? true)

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        // Names the KIND of thing being worked on, like the Houdini drawer: it
        // acts on this one scene, so the scene's file name leads.
        title={
          <span className="flex items-center gap-2">
            <img src={dazLogo} alt="" aria-hidden className="size-5 shrink-0 object-contain" />
            <span className="truncate">
              Daz scene utils
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {fileName(targetScene)} · {character.name}
              </span>
            </span>
          </span>
        }
      >
        <Tabs value="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            {runner?.blocked && <RunnerGateNotice gate={runner} subject="Scans run" />}

            <div>
              <Label className="flex w-fit items-center gap-1 text-base font-semibold">
                Scan this scene
                <InfoPopup label="Scan this scene — more information">
                  The two scene passes of Tools → Scan project, narrowed to this one scene: Daz
                  Studio opens it once and runs the pass you picked. Products matches the scene's
                  used assets against your installed Daz products; morphs files the dials the base
                  index doesn't have — clothing, hair, third-party grafts — under this scene.
                </InfoPopup>
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Runs unattended through the Runner plugin — a scan opens the scene in Daz, so it
                takes a while.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={scanBlocked || productsOff}
                  title={
                    !dazProductsEnabled
                      ? 'Daz Products is switched off for this project — enable it in Settings → Project.'
                      : plan !== null && !plan.dimConfigured
                        ? 'No DAZ Install Manager manifests folder is set — the scan would report every asset as unmatched. Set one in Settings.'
                        : undefined
                  }
                  onClick={() => void onScan('products')}
                >
                  {starting === 'products' ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                  Scan products of this scene
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={scanBlocked}
                  onClick={() => void onScan('morphs')}
                >
                  {starting === 'morphs' ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                  Scan morphs of this scene
                </Button>
              </div>
              {live && (
                <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {phase === 'pending'
                    ? 'Waiting for Daz Studio to pick the scan up…'
                    : 'Daz Studio is scanning the scene…'}
                  {phase === 'pending' && (
                    <Button variant="outline" size="sm" disabled={aborting} onClick={() => void onAbort()}>
                      <Ban /> {aborting ? 'Aborting…' : 'Abort'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <Label className="flex w-fit items-center gap-1 text-base font-semibold">
                DTH Export
                <InfoPopup label="Export hair items — more information">
                  Whether a DTH Export run exports this scene's hair items — after the main export,
                  each item on its own (the Export_Hair pass). On by default for the primary scene,
                  off for other scenes. The items stay hidden from the main export either way; this
                  only decides whether they also export as grooms of their own.
                </InfoPopup>
              </Label>
              <div className="mt-3 flex items-center gap-3">
                <Switch
                  checked={hairExportOn}
                  disabled={savingHair}
                  onCheckedChange={(next) => void onHairToggle(next)}
                />
                <span className="text-sm">Export hair items</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {hairCount > 0
                  ? `${hairCount} hair item${hairCount === 1 ? '' : 's'} listed for this scene.`
                  : 'No hair items are listed for this scene yet — there is nothing to export until some are (see the Hair list).'}
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </SidePanel>

      <MultipleDazModal open={multiDaz} onClose={() => setMultiDaz(false)} />
    </>
  )
}
