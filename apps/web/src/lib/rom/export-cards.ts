import type { ExportTask } from '#/components/character/export-pipeline-panel.tsx'
import type { HoudiniRunState } from './houdini-jobs.ts'

/**
 * The Houdini half of the run's task-card column: one card per DazToHue
 * NETWORK, not per project.
 *
 * A `.hip` can hold several networks (measured: two in one project), and the
 * meters have always counted them — so a single card per project said "one
 * thing is happening" about work the bar said was two.
 *
 * Where the names come from, in the order they become available:
 *
 * 1. **The run's own targets** (`live.networks`), once 456.py has collected
 *    them: the title of the network box around each node, which is what the
 *    USER called it. Authoritative — it is the list actually being exported.
 * 2. **The stored scan** (`sets`, each export node's `character_name`) before
 *    that. It is what the project WRITES, so it can name the cards while
 *    hython is still opening the file — the stretch this was reported in.
 * 3. Neither: one card for the project, as it always was.
 *
 * The scan's list can disagree with the run's — a network whose scene was not
 * selected is not exported — so the run replaces it the moment it speaks. That
 * is a card disappearing mid-run, which is honest: it says "that network is not
 * in this run" instead of leaving a row that never starts.
 */
export function houdiniTaskCards(
  project: { path: string; label: string; networks: Array<string>; sets?: Array<string> },
  index: number,
  live: Extract<HoudiniRunState, { state: 'running' }> | null,
  isActive: boolean,
  finishedProjects: number,
): Array<ExportTask> {
  const single = (): Array<ExportTask> => [
    {
      id: `hou:${project.path}`,
      label: project.label,
      // The scenes it will export, ONE PER LINE — a comma-joined list wrapped
      // into a wall of text.
      detail: project.networks.length > 0 ? project.networks.join('\n') : undefined,
      kind: 'houdini',
      status: index < finishedProjects ? 'done' : isActive ? 'active' : 'waiting',
    },
  ]
  if (live && live.total > 1) {
    const running = live.networks.filter((one) => one.status !== 'waiting').length
    return Array.from({ length: live.total }, (_, n) => {
      const network = live.networks[n]
      const done = network !== undefined && network.status !== 'waiting'
      return {
        id: `hou:${project.path}#${n}`,
        label: network?.label || (n === running ? live.activity?.scene || '' : '') || `Network ${n + 1}`,
        detail: project.label,
        kind: 'houdini',
        status: done ? 'done' : n === running ? 'active' : 'waiting',
      }
    })
  }
  const sets = project.sets ?? []
  if (live || sets.length < 2) return single()
  // Not running yet, and the scan knows what this project writes: name the
  // cards now rather than showing one row for two networks.
  return sets.map((name, n) => ({
    id: `hou:${project.path}#${n}`,
    label: name,
    detail: project.label,
    kind: 'houdini',
    status: index < finishedProjects ? 'done' : 'waiting',
  }))
}
