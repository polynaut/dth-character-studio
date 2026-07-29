import { useState } from 'react'
import { FastForward, Play } from 'lucide-react'
import { toast } from 'sonner'

import { Button, useModifierHeld } from '@dth/ui'
import { executeCharacterJobs } from '#/lib/rom/api.ts'

import type { Character } from '@dth/rom'

/**
 * The header's Execute / Execute all buttons: hand the character's ROM+export
 * runs to the DTH Exporter Plugin as a job file and start Daz Studio (see
 * api/execute.ts + docs/exporter-plugin-job-file.md).
 *
 *  - **Execute** queues the SELECTED scene, unconditionally.
 *  - **Execute all** queues every linked scene that changed since its last
 *    handoff (first run = all); holding Ctrl forces all scenes. It needs an
 *    export directory — an all-scene sweep exists to (re)deliver exports.
 *
 * Its own component (like HeaderActions) so the Ctrl-held flips re-render just
 * these buttons, not the whole editor. Disabled while the draft is dirty:
 * Execute runs the GENERATED scripts on disk, which lag unsaved edits.
 */
export function ExecuteActions({
  projectId,
  character,
  selectedScene,
  saving,
  dirty,
  dazLibraryConfigured,
}: {
  projectId: string
  character: Character
  /** The editor's selected Daz scene (falls back to the primary). */
  selectedScene: string
  saving: boolean
  dirty: boolean
  /** “My DAZ 3D Library” is set — where the job file and scripts live. */
  dazLibraryConfigured: boolean
}) {
  const ctrlHeld = useModifierHeld('Control')
  const [busy, setBusy] = useState(false)

  const sceneLinked = Boolean(character.scenePath)
  const exportDirSet = character.exportPath.trim() !== ''
  const baseDisabled = busy || saving || dirty || !sceneLinked || !dazLibraryConfigured
  const blockedHint = !dazLibraryConfigured
    ? 'Set “My DAZ 3D Library” in Settings first'
    : !sceneLinked
      ? 'Link a primary Daz scene first'
      : dirty
        ? 'Save first — Execute runs the generated scripts on disk'
        : undefined

  async function run(scope: 'scene' | 'all', force: boolean) {
    setBusy(true)
    try {
      const result = await executeCharacterJobs({
        data: { projectId, id: character.id, scope, scenePath: selectedScene, force },
      })
      if (result.scenes.length === 0) {
        toast.info('All scenes are unchanged since the last run — Ctrl+click to force them all.')
      } else if (result.dazWasRunning) {
        toast.warning(
          `Jobs written for ${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'}, ` +
            'but Daz Studio is already running — restart it so the Exporter Plugin picks them up.',
        )
      } else {
        toast.success(
          `Started Daz Studio — ${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'} queued` +
            (result.skipped.length > 0 ? ` (${result.skipped.length} unchanged, skipped)` : '') +
            '.',
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void run('scene', false)}
        disabled={baseDisabled}
        title={
          blockedHint ??
          'Run the selected Daz scene through the Exporter Plugin — writes the job file and starts Daz Studio'
        }
      >
        <Play /> Execute
      </Button>
      <Button
        variant="outline"
        onClick={() => void run('all', ctrlHeld)}
        disabled={baseDisabled || !exportDirSet}
        title={
          blockedHint ??
          (!exportDirSet
            ? 'Set an export directory to enable Execute all'
            : ctrlHeld
              ? 'Run ALL linked scenes, changed or not (Ctrl held)'
              : 'Run every linked scene that changed since its last run — Ctrl+click to force all')
        }
      >
        <FastForward /> {ctrlHeld && !baseDisabled && exportDirSet ? 'Execute all (force)' : 'Execute all'}
      </Button>
    </>
  )
}
