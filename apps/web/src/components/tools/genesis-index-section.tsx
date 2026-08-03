import { useEffect, useState } from 'react'
import { Ban, Boxes, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Label, useRefetchOnFocus } from '@dth/ui'
import { RunnerGateNotice } from '#/components/runner-gate-notice.tsx'
import {
  GENESIS_INDEX_RUN,
  abortGenesisIndexRun,
  buildGenesisIndex,
  fetchExportRunProgress,
  fetchExportRunnerGate,
} from '#/lib/rom/api.ts'

import type { RunnerGate } from '#/lib/rom/api.ts'

/**
 * Tools → **Build Genesis Index**: one button that hands the visible
 * `Build_Genesis_Index.dsa` to the Runner plugin, so Daz builds and scans every
 * generation's stock figures unattended instead of the user opening the Content
 * Library and double-clicking it.
 *
 * The run is the same job-file handoff every batch uses, with an empty
 * `scenePath` (the contract's "new empty scene"), so it reports through the
 * shared export watch under the {@link GENESIS_INDEX_RUN} sentinel. This panel
 * is the run's OWNER: it polls the watch with the sentinel as its watcher id,
 * which is what routes the one destructive finished/dead snapshot here —
 * character editors only ever see the run as a display-only `''` adoption
 * (see fetchExportRunProgress). Like the DTH Export dialog, the button is
 * gated on the Runner plugin's install state (`fetchExportRunnerGate`): the
 * run goes THROUGH the Runner, so a missing/outdated install would strand the
 * job file unclaimed. While the handoff is still un-renamed (waiting for a
 * launched Daz to come up) an Abort button takes it back.
 */
export function GenesisIndexSection({
  dazLibraryConfigured,
}: {
  /** “My DAZ 3D Library” is set — where the job file and the script live. */
  dazLibraryConfigured: boolean
}) {
  const [starting, setStarting] = useState(false)
  // The run's watch phase: 'pending' = job file written, not yet claimed
  // (abortable); 'running' = the Runner renamed it and works the batch.
  const [phase, setPhase] = useState<'idle' | 'pending' | 'running'>('idle')
  const [aborting, setAborting] = useState(false)
  // null = the Runner probe is still running (the button stays off meanwhile).
  const [runner, setRunner] = useState<RunnerGate | null>(null)

  useEffect(() => {
    let active = true
    // A failed probe must not brick the build — only a definite missing/
    // outdated verdict blocks (the gate itself already treats unreadable
    // runner states as unblocked).
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

  // The shared watch, polled as the run's OWNER (the sentinel watcher id):
  // only this panel receives — and consumes — the finished/dead snapshot.
  async function refresh() {
    const run = await fetchExportRunProgress(GENESIS_INDEX_RUN)
    if (!run || run.characterId !== GENESIS_INDEX_RUN) {
      setPhase('idle')
      return
    }
    if (run.state === 'finished') {
      setPhase('idle')
      if (run.failed > 0) {
        toast.warning('The Genesis index run failed in Daz Studio.', {
          description: run.errors.length ? run.errors.join('\n') : undefined,
        })
      } else {
        toast.success('Genesis index rebuilt — the morph and bone autocompletes are current.')
      }
      return
    }
    if (run.state === 'dead') {
      setPhase('idle')
      toast.error('The Genesis index run did not finish — Daz Studio is no longer running.')
      return
    }
    setPhase(run.state === 'pending' ? 'pending' : 'running')
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

  async function onBuild() {
    setStarting(true)
    try {
      const { dazWasRunning } = await buildGenesisIndex()
      toast.success(
        dazWasRunning
          ? 'Handed to Daz Studio — it builds the index in a fresh scene.'
          : 'Started Daz Studio — it builds the index in a fresh scene.',
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
      await abortGenesisIndexRun()
      setPhase('idle')
      toast.success('Index build aborted — the job file was deleted, nothing will run.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setAborting(false)
    }
  }

  const blocked = !dazLibraryConfigured
  const busy = phase !== 'idle'
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <Label className="flex w-fit items-center gap-1 text-base font-semibold">
          Build Genesis Index
          <InfoPopup label="Build Genesis Index — more information">
            Builds each generation's stock figures in Daz Studio — Genesis 3, 8, 8.1 (female and
            male) and Genesis 9 (twice, differentiated by geograft since it is gender-neutral) —
            scans every figure and everything fitted to it, and writes the per-generation morph
            and bone index the <strong>Morph name</strong> and <strong>Bone</strong> autocompletes
            read. Runs in a fresh scene and clears up after itself, so whatever you have open is
            untouched.
          </InfoPopup>
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs unattended through the Runner plugin — no need to open the script yourself. Takes a
          while: it loads every generation's figures in turn.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="lg"
          disabled={blocked || starting || busy || !runner || runner.blocked}
          onClick={() => void onBuild()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Boxes />}
          {phase === 'running'
            ? 'Building in Daz Studio…'
            : phase === 'pending'
              ? 'Waiting for Daz Studio…'
              : starting
                ? 'Handing over…'
                : 'Build Genesis Index'}
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
      {blocked && (
        <p className="text-sm text-destructive">
          Set “My DAZ 3D Library” in Settings first — the job file and the script live there.
        </p>
      )}
      {runner?.blocked && <RunnerGateNotice gate={runner} subject="The index build runs" />}
    </section>
  )
}
