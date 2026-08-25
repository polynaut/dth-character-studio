/**
 * The DTH Exporter's "Alembic ROM motion summary" (exporter >= 2.1.9), parsed
 * STUDIO-side — the staleness gate the carrier's own audit cannot express.
 *
 * The exporter walks every ROM frame and, per exported node, counts the frames
 * on which the sampled mesh actually CHANGED. Daz's re-evaluation of fitted
 * FOLLOWERS (eyes/mouth/tear, grafts, shells, clothing) silently degrades in a
 * measured, deterministic pattern (2026-08-24/25, DS4 4.24, exporter 2.1.10):
 * every scripted export after a scene RE-load in the same Daz session freezes
 * followers that used to move. The summary is the only artifact that tells
 * that export from a healthy one — alembics are not bit-reproducible and size
 * is not a health metric.
 *
 * THE JUDGING IS HISTORICAL, and that is the load-bearing design decision —
 * both "obvious" absolute signals were measured to lie:
 *
 * - "followers far below the figure = degraded" false-positives on any scene
 *   whose ROM legitimately leaves meshes still. Measured on the naked-G9 test
 *   scene (no facial sections): eyes/mouth/tear move on 66–123 of 433 frames
 *   in perfectly HEALTHY fresh-session exports — the same counts a degraded
 *   run shows.
 * - The exporter's own "N of M frames left at least one mesh unchanged"
 *   warning fires at 415–423 of 432 on those same healthy exports. It is not
 *   a failure signal; it only looked like one on a scene that animates
 *   everything.
 *
 * What DOES separate, in every measured log: a node's moved-fraction against
 * its own best in EARLIER summaries of the same log (the log accretes across
 * runs and survives the export sweep). A degraded run collapses nodes to
 * 9–35% of what the same nodes reached before (GP 426→119 of 433; Ita eyes
 * 476→110 of 484), while healthy runs stay above 60% of their best (worst
 * measured: Ita Tear at 61%). A first-ever export has no history and gates
 * nothing — no evidence is not evidence.
 *
 * Two verdict layers exist on purpose:
 * - The CARRIER gate (runtime v102, `MOTION_SUMMARY_HELPER` in dsa.ts) runs
 *   inside Daz and judges absolutes: an all-zero summary un-lands the export,
 *   a best node under ~90% of the reachable walk warns.
 * - THIS module is the studio's history gate, run over the per-set export
 *   `.log` after a batch (`verifyDazExportsLanded`).
 *
 * Pure (no I/O) so the thresholds stay pinned by tests against the measured
 * log blocks.
 */

export interface MotionSummaryNode {
  /** The exported node's label as the summary prints it. */
  node: string
  /** Frames on which this node's sampled mesh changed. */
  moved: number
  /** Frames the ROM walk sampled. */
  total: number
}

export interface MotionSummary {
  /** One summary block's node lines, in log order. */
  nodes: Array<MotionSummaryNode>
}

/**
 * Every "Alembic ROM motion summary" block of an export log, in log order —
 * the LAST is the newest run's, the ones before it are the history the gate
 * judges against. Callers scope "is the last block THIS run's?" by the log
 * file's mtime (this module never sees the filesystem). Empty for a log
 * without a parseable block (an older exporter).
 */
export function parseMotionSummaries(logText: string): Array<MotionSummary> {
  const out: Array<MotionSummary> = []
  const HEADER = 'Alembic ROM motion summary'
  let at = logText.indexOf(HEADER)
  while (at >= 0) {
    const next = logText.indexOf(HEADER, at + HEADER.length)
    const section = logText.slice(at, next < 0 ? undefined : next)
    const nodes: Array<MotionSummaryNode> = []
    for (const line of section.split('\n').slice(1)) {
      // The node label sits between the log prefix ("[ts] [INFO]   ") and
      // ": moved on" — excluding ':', '[' and ']' from the label class stops
      // the capture from swallowing the timestamp prefix. Same expression the
      // carrier helper uses (MOTION_SUMMARY_HELPER).
      const m = /([^:[\]]+): moved on (\d+) of (\d+) frames/.exec(line)
      if (!m) {
        // The block is contiguous: the first non-matching line after any node
        // line ends it.
        if (nodes.length > 0) break
        continue
      }
      const total = Number(m[3])
      if (!(total > 0)) continue
      nodes.push({ node: m[1].trim(), moved: Number(m[2]), total })
    }
    if (nodes.length > 0) out.push({ nodes })
    at = next
  }
  return out
}

/** The newest block alone — a convenience over {@link parseMotionSummaries}. */
export function parseLastMotionSummary(logText: string): MotionSummary | null {
  const all = parseMotionSummaries(logText)
  return all.length > 0 ? all[all.length - 1] : null
}

/**
 * A node counts as COLLAPSED when its moved fraction falls under half of its
 * own best across the earlier summaries. Measured separation is wide: the
 * degraded runs put collapsed nodes at 9–35% of their best while the worst
 * HEALTHY follower ever measured (Ita's Tear, 290/484 against a 477/484 best)
 * is 61% — 0.5 splits the gap with margin on both sides.
 */
export const MOTION_COLLAPSE_RATIO = 0.5

/**
 * One collapsed mesh is legitimate (a removed morph, a re-fitted item). The
 * degraded signature is MULTIPLE nodes collapsing at once — the measured runs
 * put three to eleven under the bar.
 */
export const MOTION_DEGRADED_COLLAPSE_COUNT = 2

export interface MotionGateVerdict {
  /** The export is judged stale — fail the scene. */
  degraded: boolean
  /** The nodes that collapsed against their own history, with the best
   *  fraction they used to reach. */
  collapsed: Array<MotionSummaryNode & { bestFraction: number }>
  /** Human-readable grounds, one line per finding — empty when healthy. */
  reasons: Array<string>
}

const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`

/**
 * Judge the NEWEST summary against the ones before it — the history gate.
 *
 * Degraded when:
 * - no node moved at all (the total statue — the carrier gate also un-lands
 *   this one; judged here too so a studio-side reader never depends on the
 *   runtime version that generated the carrier), or
 * - at least {@link MOTION_DEGRADED_COLLAPSE_COUNT} nodes sit below
 *   {@link MOTION_COLLAPSE_RATIO} of their own best earlier fraction.
 *
 * A node with no earlier appearance (first export, renamed item) has no
 * history and is never counted. An empty history gates nothing beyond the
 * statue. Degraded earlier runs cannot poison the baseline: the best is a
 * MAX, and a frozen run never raises it.
 */
export function motionGateVerdict(summaries: ReadonlyArray<MotionSummary>): MotionGateVerdict {
  const verdict: MotionGateVerdict = { degraded: false, collapsed: [], reasons: [] }
  if (summaries.length === 0) return verdict
  const current = summaries[summaries.length - 1]
  if (current.nodes.length > 0 && current.nodes.every((n) => n.moved === 0)) {
    verdict.degraded = true
    verdict.reasons.push(
      `no exported mesh moved on any of the ${current.nodes[0].total} ROM frames (statue export)`,
    )
    return verdict
  }
  const best = new Map<string, number>()
  for (const summary of summaries.slice(0, -1)) {
    for (const node of summary.nodes) {
      const fraction = node.moved / node.total
      if (fraction > (best.get(node.node) ?? 0)) best.set(node.node, fraction)
    }
  }
  for (const node of current.nodes) {
    const was = best.get(node.node)
    if (was === undefined || was <= 0) continue
    if (node.moved / node.total < MOTION_COLLAPSE_RATIO * was) {
      verdict.collapsed.push({ ...node, bestFraction: was })
    }
  }
  if (verdict.collapsed.length >= MOTION_DEGRADED_COLLAPSE_COUNT) {
    verdict.degraded = true
    const worst = [...verdict.collapsed].sort(
      (a, b) => a.moved / a.total / a.bestFraction - b.moved / b.total / b.bestFraction,
    )
    verdict.reasons.push(
      `${verdict.collapsed.length} meshes moved far less than the same meshes did on earlier exports (e.g. ${worst
        .slice(0, 3)
        .map((n) => `${n.node} ${pct(n.moved / n.total)} vs ${pct(n.bestFraction)} before`)
        .join(', ')}) — the measured follower-evaluation staleness`,
    )
  }
  return verdict
}
