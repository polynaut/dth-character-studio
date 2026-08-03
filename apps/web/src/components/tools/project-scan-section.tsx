import { useEffect, useState } from 'react'
import { Ban, Loader2, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Label, useRefetchOnFocus } from '@dth/ui'
import { RunnerGateNotice } from '#/components/runner-gate-notice.tsx'
import {
  PROJECT_SCAN_RUN,
  abortProjectScanRun,
  fetchExportRunProgress,
  fetchExportRunnerGate,
  fetchProjectScanPlan,
  startProjectScan,
} from '#/lib/rom/api.ts'

import type { ProjectScanPlan, RunnerGate } from '#/lib/rom/api.ts'

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

  useRefetchOnFocus(
    () => {
      void refresh()
    },
    [],
    { immediate: true },
  )
  useEffect(() => {
    if (phase === 'idle') return
    const id = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(id)
    // Re-armed on `phase` alone — refresh captures nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  async function onStart() {
    setStarting(true)
    try {
      const summary = await startProjectScan({ data: { projectId, ...selection } })
      toast.success(
        summary.dazWasRunning
          ? `Handed ${summary.rows} job${summary.rows === 1 ? '' : 's'} to Daz Studio.`
          : `Started Daz Studio — ${summary.rows} job${summary.rows === 1 ? '' : 's'} queued.`,
        {
          description: summary.skipped.length
            ? `Skipped ${summary.skipped.length} scene(s) missing on disk.`
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
  const sceneRows = selection.morphs || selection.products ? (plan?.totalScenes ?? 0) : 0
  const rowCount = (selection.base ? 1 : 0) + sceneRows
  const nothingPicked = !selection.base && !selection.morphs && !selection.products
  // A scene pass with no scenes to run it on would hand Daz an empty batch.
  const noScenes = (selection.morphs || selection.products) && (plan?.totalScenes ?? 0) === 0
  const blocked = !dazLibraryConfigured || !projectId
  const productsOff = plan !== null && !plan.productsEnabled

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

      {!projectId ? (
        <p className="text-sm text-muted-foreground">
          Open a project to scan its characters. (The base index below can be rebuilt without
          one.)
        </p>
      ) : (
        <>
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
              checked={selection.morphs}
              disabled={busy}
              onChange={(morphs) => setSelection((s) => ({ ...s, morphs }))}
              hint={
                plan
                  ? `Scans each linked scene for the dials the base index doesn't have — clothing, hair, third-party grafts — and files them under that scene. ${plan.totalScenes} scene(s).`
                  : 'Scans each linked scene for the dials the base index doesn’t have.'
              }
            />
            <ScanOption
              label="Products"
              checked={selection.products}
              disabled={busy || productsOff}
              onChange={(products) => setSelection((s) => ({ ...s, products }))}
              hint={
                productsOff
                  ? 'Daz Products is switched off for this project — enable it in Settings → Project.'
                  : plan && !plan.dimConfigured
                    ? 'No DAZ Install Manager manifests folder is set — the scan would report every asset as unmatched. Set one in Settings.'
                    : 'Matches each scene’s used assets against your installed Daz products. Shares the scene opens with the morph scan.'
              }
            />
          </div>

          {plan && plan.characters.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {plan.characters.length} character{plan.characters.length === 1 ? '' : 's'},{' '}
              {plan.totalScenes} linked scene{plan.totalScenes === 1 ? '' : 's'}
              {rowCount > 0 && !busy && ` — ${rowCount} job${rowCount === 1 ? '' : 's'} to run`}.
            </p>
          )}
        </>
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
          No linked Daz scenes in this project yet — the scene passes have nothing to run on.
        </p>
      )}
      {runner?.blocked && <RunnerGateNotice gate={runner} subject="The project scan runs" />}
    </section>
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
