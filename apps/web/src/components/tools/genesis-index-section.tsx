import { useEffect, useState } from 'react'
import { Boxes, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Label, useRefetchOnFocus } from '@dth/ui'
import { GENESIS_INDEX_RUN, buildGenesisIndex, fetchExportRunProgress } from '#/lib/rom/api.ts'

/**
 * Tools → **Build Genesis Index**: one button that hands the visible
 * `Build_Genesis_Index.dsa` to the Runner plugin, so Daz builds and scans every
 * generation's stock figures unattended instead of the user opening the Content
 * Library and double-clicking it.
 *
 * The run is the same job-file handoff every batch uses, with an empty
 * `scenePath` (the contract's "new empty scene"), so it reports through the
 * shared export watch — filtered to this run's sentinel id, since the batch
 * belongs to no character.
 */
export function GenesisIndexSection({
  dazLibraryConfigured,
}: {
  /** “My DAZ 3D Library” is set — where the job file and the script live. */
  dazLibraryConfigured: boolean
}) {
  const [starting, setStarting] = useState(false)
  const [running, setRunning] = useState(false)

  // The shared watch: poll while this run is live, and report its outcome once.
  async function refresh() {
    const run = await fetchExportRunProgress()
    if (!run || run.characterId !== GENESIS_INDEX_RUN) {
      setRunning(false)
      return
    }
    if (run.state === 'finished') {
      setRunning(false)
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
      setRunning(false)
      toast.error('The Genesis index run did not finish — Daz Studio is no longer running.')
      return
    }
    setRunning(true)
  }

  useRefetchOnFocus(
    () => {
      void refresh()
    },
    [],
    { immediate: true },
  )
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(id)
    // Re-armed on `running` alone — refresh captures nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  async function onBuild() {
    setStarting(true)
    try {
      const { dazWasRunning } = await buildGenesisIndex()
      setRunning(true)
      toast.success(
        dazWasRunning
          ? 'Handed to Daz Studio — it builds the index in a fresh scene.'
          : 'Started Daz Studio — it builds the index in a fresh scene.',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const blocked = !dazLibraryConfigured
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
      <Button size="lg" disabled={blocked || starting || running} onClick={() => void onBuild()}>
        {running ? <Loader2 className="animate-spin" /> : <Boxes />}
        {running ? 'Building in Daz Studio…' : starting ? 'Handing over…' : 'Build Genesis Index'}
      </Button>
      {blocked && (
        <p className="text-sm text-destructive">
          Set “My DAZ 3D Library” in Settings first — the job file and the script live there.
        </p>
      )}
    </section>
  )
}
