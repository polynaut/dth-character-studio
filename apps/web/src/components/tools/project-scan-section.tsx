import { useEffect, useRef, useState } from 'react'
import { Ban, ChevronDown, ChevronRight, FileWarning, Loader2, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Label, useRefetchOnFocus } from '@dth/ui'
import { SceneTile } from '#/components/portrait.tsx'
import { RunnerGateNotice } from '#/components/runner-gate-notice.tsx'
import {
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

import type { ProjectScanPlan, RunnerGate, StopWatching } from '#/lib/rom/api.ts'

/** Scene paths are compared by the ONE key convention the whole handoff uses. */
const sceneKey = normalizeSceneKey

/** A scene's `.duf` stem — what the picker lists (the full path is the title). */
function sceneName(scenePath: string): string {
  return scenePath.split(/[\\/]/).pop()?.replace(/\.duf$/i, '') ?? scenePath
}

/** The three things a project can be scanned for — the panel's selection, and
 *  the shape {@link startProjectScan} takes. */
interface ScanSelection {
  base: boolean
  morphs: boolean
  products: boolean
}

/**
 * Tools → **Scan project**: the one-click pass over everything a project can be
 * scanned for. The user ticks what they want, presses Start, and waits — the
 * studio hands the Runner ONE batch (base index first, then one row per linked
 * scene of every character) and reports progress here.
 *
 * Works with NO project open too (the Tools page is reachable from Home): the
 * base pass belongs to no project, so it stays available while the two
 * scene-scoped passes disable themselves. That is the whole reason this panel
 * could replace the standalone Build Genesis Index one.
 *
 * The run is the same job-file handoff every batch uses and reports through the
 * shared export watch under the {@link PROJECT_SCAN_RUN} sentinel. This panel is
 * the run's OWNER: it polls the watch with that sentinel as its watcher id,
 * which is what routes the one destructive finished/dead snapshot here — every
 * other poller sees the run as a display-only adoption. Like every Runner
 * feature the Start button is gated on the plugin's install state: the batch
 * goes THROUGH the Runner, so a missing/outdated install would strand it.
 */
export function ProjectScanSection({
  projectId,
  dazLibraryConfigured,
}: {
  /** The active project's folder path ('' when the window has no project open —
   *  the panel then explains itself instead of offering a scan of nothing). */
  projectId: string
  /** “My DAZ 3D Library” is set — where the job file and the scripts live. */
  dazLibraryConfigured: boolean
}) {
  const [starting, setStarting] = useState(false)
  // The run's watch phase: 'pending' = job file written, not yet claimed
  // (abortable); 'running' = the Runner renamed it and works the batch.
  const [phase, setPhase] = useState<'idle' | 'pending' | 'running'>('idle')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [aborting, setAborting] = useState(false)
  // null = the Runner probe is still running (the button stays off meanwhile).
  const [runner, setRunner] = useState<RunnerGate | null>(null)
  // null = the plan probe hasn't landed yet.
  const [plan, setPlan] = useState<ProjectScanPlan | null>(null)
  const [selection, setSelection] = useState<ScanSelection>({
    base: true,
    morphs: true,
    products: false,
  })
  /**
   * Which scenes the two scene passes cover, as {@link normalizeSceneKey} keys.
   * ONE selection for both passes: a row opens a scene once and runs whichever
   * scans it is due for, so splitting the pick per pass would buy nothing but a
   * second list to keep in sync.
   *
   * `null` = "everything", the state a freshly-loaded plan starts in — kept
   * distinct from an explicit full set so a project gaining a scene in another
   * window is covered by default rather than silently left out of the run.
   */
  const [pickedScenes, setPickedScenes] = useState<Set<string> | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let active = true
    // A failed probe must not brick the scan — only a definite missing/outdated
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

  // The plan is re-read on focus: characters and scenes change in OTHER windows
  // (and scenes come and go on disk), and a stale plan would misreport what a
  // Start is about to cover.
  useRefetchOnFocus(
    () => {
      if (!projectId) return
      void fetchProjectScanPlan({ data: { projectId } })
        .then(setPlan)
        .catch(() => setPlan(null))
    },
    [projectId],
    { immediate: true },
  )

  // The shared watch, polled as the run's OWNER (the sentinel watcher id):
  // only this panel receives — and consumes — the finished/dead snapshot.
  async function refresh() {
    const run = await fetchExportRunProgress(PROJECT_SCAN_RUN)
    if (!run || run.characterId !== PROJECT_SCAN_RUN) {
      setPhase('idle')
      setProgress(null)
      return
    }
    if (run.state === 'finished') {
      setPhase('idle')
      setProgress(null)
      // Take in what the batch's product scans wrote, across every character —
      // nobody is sitting on a character page after a project-wide run, and the
      // per-character pickup only happens when one is opened.
      if (projectId) await ingestProjectProductScans({ data: { projectId } })
      if (run.failed > 0) {
        toast.warning(
          `The project scan finished with ${run.failed} failed ${run.failed === 1 ? 'row' : 'rows'}.`,
          { description: run.errors.length ? run.errors.join('\n') : undefined },
        )
      } else {
        toast.success('Project scan complete — the autocompletes and product results are current.')
      }
      return
    }
    if (run.state === 'dead') {
      setPhase('idle')
      setProgress(null)
      toast.error('The project scan did not finish — Daz Studio is no longer running.')
      return
    }
    setPhase(run.state === 'pending' ? 'pending' : 'running')
    setProgress(run.state === 'running' ? { done: run.processed, total: run.total } : null)
  }

  // One coalesced funnel for every refresh trigger (focus, watch event,
  // heartbeat): the finished snapshot above is destructive — it consumes the
  // run, ingests the product scans and toasts — and two refreshes racing over
  // that moment must not both act on it. An ask that lands mid-refresh runs
  // AFTER it, so the newest state is never skipped.
  const refreshBusyRef = useRef(false)
  const refreshAgainRef = useRef(false)
  async function refreshCoalesced() {
    if (refreshBusyRef.current) {
      refreshAgainRef.current = true
      return
    }
    refreshBusyRef.current = true
    try {
      do {
        refreshAgainRef.current = false
        await refresh()
      } while (refreshAgainRef.current)
    } finally {
      refreshBusyRef.current = false
    }
  }

  useRefetchOnFocus(
    () => {
      void refreshCoalesced()
    },
    [],
    { immediate: true },
  )
  // Real file watching while a run is live: the Runner's pickup rename and
  // per-row rewrites (and the progress-log lines) arrive as change events, so
  // the panel follows the batch the moment it moves. Armed on the live/idle
  // BOOLEAN, not on `phase` — pending→running must not tear the watch down.
  const live = phase !== 'idle'
  const [runWatchArmed, setRunWatchArmed] = useState(false)
  useEffect(() => {
    if (!live) return
    let stop: StopWatching | null = null
    let disposed = false
    void watchExportRunFiles(() => void refreshCoalesced()).then((stopper) => {
      if (!stopper) return
      if (disposed) {
        stopper()
        return
      }
      stop = stopper
      setRunWatchArmed(true)
    })
    return () => {
      disposed = true
      stop?.()
      setRunWatchArmed(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])
  // With the watch armed the interval is only the heartbeat under events a NAS
  // share may swallow — and the one prompter for a Daz that died mid-run
  // (lib/fs-watch.ts on why the poll survives). Full speed without a watch (a
  // plain browser, a failed start).
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => void refreshCoalesced(), runWatchArmed ? 15_000 : 2500)
    return () => window.clearInterval(id)
    // Re-armed on the booleans alone — refresh captures nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, runWatchArmed])

  async function onStart() {
    setStarting(true)
    try {
      // Send what the panel EFFECTIVELY offers, not the raw ticks: with no
      // project open the scene passes are unavailable however the state stands
      // (a tick set before the project closed must not ride along and fail).
      const summary = await startProjectScan({
        data: {
          projectId,
          base: selection.base,
          morphs: selection.morphs && !noProject,
          products: selection.products && !productsOff,
          // Omitted while the pick is "everything", so a scene added in another
          // window between the plan probe and this click is still covered.
          ...(pickedScenes === null ? {} : { scenes: allScenes.filter(isPicked) }),
        },
      })
      toast.success(
        summary.dazWasRunning
          ? `Handed ${summary.rows} job${summary.rows === 1 ? '' : 's'} to Daz Studio.`
          : `Started Daz Studio — ${summary.rows} job${summary.rows === 1 ? '' : 's'} queued.`,
        {
          description: summary.skipped.length
            ? `Skipped ${summary.skipped.length} scene${summary.skipped.length === 1 ? '' : 's'} missing on disk.`
            : undefined,
        },
      )
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
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

  const busy = phase !== 'idle'
  // With no project open the scene passes cannot run at all, so they never
  // count towards the batch however the ticks stand.
  const noProject = !projectId
  const wantsScenes = !noProject && (selection.morphs || selection.products)
  const allScenes = plan ? plan.characters.flatMap((c) => c.scenes) : []
  const isPicked = (scene: string) => pickedScenes === null || pickedScenes.has(sceneKey(scene))
  const pickedCount = pickedScenes === null ? allScenes.length : allScenes.filter(isPicked).length
  const sceneRows = wantsScenes ? pickedCount : 0
  const rowCount = (selection.base ? 1 : 0) + sceneRows
  const nothingPicked = !selection.base && !wantsScenes
  // A scene pass with nothing selected would hand Daz an empty batch.
  const noScenes = wantsScenes && pickedCount === 0
  const blocked = !dazLibraryConfigured
  const productsOff = noProject || (plan !== null && !plan.productsEnabled)
  const scenes = plan?.totalScenes ?? 0
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  /** Set membership for one scene, switching off "everything" on the first
   *  explicit exclusion (the null state can't represent a gap). */
  function toggleScene(scene: string, on: boolean) {
    setPickedScenes((prev) => {
      const next = new Set(prev === null ? allScenes.map(sceneKey) : prev)
      if (on) next.add(sceneKey(scene))
      else next.delete(sceneKey(scene))
      return next
    })
  }

  /** Tick or clear a whole character's scenes in one go. */
  function toggleCharacter(charScenes: Array<string>, on: boolean) {
    setPickedScenes((prev) => {
      const next = new Set(prev === null ? allScenes.map(sceneKey) : prev)
      for (const scene of charScenes) {
        if (on) next.add(sceneKey(scene))
        else next.delete(sceneKey(scene))
      }
      return next
    })
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <Label className="flex w-fit items-center gap-1 text-base font-semibold">
          Scan project
          <InfoPopup label="Scan project — more information">
            One pass over everything this project can be scanned for. Tick what you want and
            press Start: the studio hands Daz Studio a single batch and works through it
            unattended — the base morph + bone index first (it is what the scene scans filter
            themselves against), then every character's linked Daz scenes, one open per scene
            however many scans it is due for.
          </InfoPopup>
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs unattended through the Runner plugin. Start it once and leave it — a project with
          many scenes takes a while, since each scene has to be opened in Daz.
        </p>
      </div>

      <div className="space-y-2">
        <ScanOption
          label="Base morphs"
          checked={selection.base}
          disabled={busy}
          onChange={(base) => setSelection((s) => ({ ...s, base }))}
          hint="Builds each generation's stock figures and indexes their morphs and bones — the autocompletes' foundation. 1 job."
        />
        <ScanOption
          label="Character morphs"
          checked={selection.morphs && !noProject}
          disabled={busy || noProject}
          onChange={(morphs) => setSelection((s) => ({ ...s, morphs }))}
          hint={
            noProject
              ? 'Needs a project open — this scans the linked scenes of its characters.'
              : plan
                ? `Scans the selected scenes for the dials the base index doesn't have — clothing, hair, third-party grafts — and files them under that scene. ${plural(pickedCount, 'job')}.`
                : 'Scans each linked scene for the dials the base index doesn’t have.'
          }
        />
        <ScanOption
          label="Products"
          checked={selection.products && !productsOff}
          disabled={busy || productsOff}
          onChange={(products) => setSelection((s) => ({ ...s, products }))}
          hint={
            noProject
              ? 'Needs a project open — the product scan is per character.'
              : plan !== null && !plan.productsEnabled
                ? 'Daz Products is switched off for this project — enable it in Settings → Project.'
                : plan && !plan.dimConfigured
                  ? 'No DAZ Install Manager manifests folder is set — the scan would report every asset as unmatched. Set one in Settings.'
                  : 'Matches the selected scenes’ used assets against your installed Daz products. Shares the scene opens with the morph scan.'
          }
        />
      </div>

      {/* The scene picker. A project can hold dozens of scenes and each one is
          a full Daz open, so "re-scan just this outfit" has to be one click
          away — but the common case is still "all of them", so the list stays
          collapsed until asked for. */}
      {wantsScenes && plan && plan.characters.length > 0 && (
        <div className="rounded-md border">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium"
              aria-expanded={picking}
              onClick={() => setPicking((p) => !p)}
            >
              {picking ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Scenes to scan
            </button>
            <span className="text-xs text-muted-foreground">
              {pickedCount === allScenes.length
                ? `all ${plural(allScenes.length, 'scene')}`
                : `${pickedCount} of ${allScenes.length}`}
            </span>
            <span className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || pickedCount === allScenes.length}
                onClick={() => setPickedScenes(null)}
              >
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || pickedCount === 0}
                onClick={() => setPickedScenes(new Set())}
              >
                None
              </Button>
            </span>
          </div>
          {picking && (
            <div className="max-h-72 space-y-3 overflow-y-auto border-t px-3 py-2">
              {plan.characters.map((character) => {
                const picked = character.scenes.filter((s) => isPicked(s)).length
                const allOn = character.scenes.length > 0 && picked === character.scenes.length
                return (
                  <div key={character.id}>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <TriStateCheckbox
                        checked={allOn}
                        // SOME of this character's scenes picked: a plain
                        // unchecked box would claim the character is out of the
                        // run entirely, which is the opposite of true.
                        indeterminate={picked > 0 && !allOn}
                        disabled={busy || character.scenes.length === 0}
                        onChange={(next) => toggleCharacter(character.scenes, next)}
                      />
                      {character.name}
                    </label>
                    {/* Tiny scene cards — the same Daz-green card language the
                        export panel's scene rows use, with the scene's own
                        `.tip.png` preview. Picking the right outfit by
                        thumbnail beats reading near-identical stems
                        (Ita_G9_GP vs Ita_G9_GP_Winter). */}
                    {/* One card per ROW, spanning the panel: the scene name is
                        the thing being read, and content-width cards left it
                        cramped next to a wall of empty space. */}
                    <div className="mt-1.5 ml-6 flex flex-col gap-1.5">
                      {character.scenes.map((scene) => {
                        const on = isPicked(scene)
                        return (
                          <label
                            key={scene}
                            className={`daz-card flex w-full items-center gap-2 rounded-md border py-1 pr-2.5 pl-2 text-sm${
                              busy ? ' opacity-50' : ' cursor-pointer'
                            }`}
                            data-selected={on ? 'true' : undefined}
                            title={scene}
                          >
                            <input
                              type="checkbox"
                              className="size-4 shrink-0 accent-daz-green"
                              checked={on}
                              disabled={busy}
                              onChange={(e) => toggleScene(scene, e.target.checked)}
                            />
                            <SceneTile
                              scenePath={scene}
                              name={sceneName(scene)}
                              genesis={character.genesis}
                              size="md"
                            />
                            <span className="min-w-0 flex-1 truncate">{sceneName(scene)}</span>
                          </label>
                        )
                      })}
                      {/* Named, never selectable: a missing `.duf` can only
                          produce a failed row, and silence would read as the
                          scene never having been linked. No preview to show —
                          the file it would come from is the missing one. */}
                      {character.missing.map((scene) => (
                        <p
                          key={scene}
                          className="flex w-full items-center gap-2 rounded-md border border-dashed py-1 pr-2.5 pl-2 text-sm text-muted-foreground"
                          title={`${scene} — missing on disk`}
                        >
                          <FileWarning className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate line-through">
                            {sceneName(scene)}
                          </span>
                          <span className="shrink-0 text-xs">missing on disk</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {noProject ? (
        <p className="text-sm text-muted-foreground">
          No project open — only the base index can be rebuilt from here.
        </p>
      ) : (
        plan &&
        plan.characters.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {plural(plan.characters.length, 'character')}, {plural(scenes, 'linked scene')}
            {rowCount > 0 && !busy && ` — ${plural(rowCount, 'job')} to run`}.
          </p>
        )
      )}

      <div className="flex items-center gap-2">
        <Button
          size="lg"
          disabled={
            blocked ||
            starting ||
            busy ||
            nothingPicked ||
            noScenes ||
            !runner ||
            runner.blocked
          }
          onClick={() => void onStart()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <ScanSearch />}
          {phase === 'running'
            ? progress
              ? `Scanning in Daz Studio… ${progress.done}/${progress.total}`
              : 'Scanning in Daz Studio…'
            : phase === 'pending'
              ? 'Waiting for Daz Studio…'
              : starting
                ? 'Handing over…'
                : 'Start scan'}
        </Button>
        {phase === 'pending' && (
          <Button
            variant="outline-destructive"
            size="lg"
            disabled={aborting}
            onClick={() => void onAbort()}
            title="The job file is still waiting for Daz Studio — Abort deletes it, nothing will run"
          >
            <Ban /> {aborting ? 'Aborting…' : 'Abort'}
          </Button>
        )}
      </div>

      {!dazLibraryConfigured && (
        <p className="text-sm text-destructive">
          Set “My DAZ 3D Library” in Settings first — the job file and the scripts live there.
        </p>
      )}
      {noScenes && !busy && (
        <p className="text-sm text-muted-foreground">
          {allScenes.length === 0
            ? 'No linked Daz scenes in this project yet — the scene passes have nothing to run on.'
            : 'No scenes selected — pick at least one, or untick the scene passes.'}
        </p>
      )}
      {runner?.blocked && <RunnerGateNotice gate={runner} subject="The project scan runs" />}
    </section>
  )
}

/**
 * A checkbox that can also sit HALF on — the state a character is in when some
 * of its scenes are picked and some aren't. `indeterminate` is DOM-only (there
 * is no React prop and no attribute for it), so it goes on via a ref callback
 * on every render rather than through JSX.
 */
function TriStateCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      className="size-4 shrink-0 accent-daz-green"
      checked={checked}
      // Half-on reads as "not all of it yet", so clicking takes the whole
      // character IN — the same direction an unchecked box goes.
      ref={(node) => {
        if (node) node.indeterminate = indeterminate
      }}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

/** One tick-box of the scan selection, with the line explaining what it costs. */
function ScanOption({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border p-3${disabled ? ' opacity-50' : ' cursor-pointer'}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-daz-green"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
