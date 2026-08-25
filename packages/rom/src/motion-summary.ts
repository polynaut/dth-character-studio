/**
 * The DTH Exporter's "Alembic ROM motion summary" (exporter >= 2.1.9), parsed
 * STUDIO-side — the relative staleness gate the carrier's own audit cannot
 * express.
 *
 * The exporter walks every ROM frame and, per exported node, counts the frames
 * on which the sampled mesh actually CHANGED. Daz's re-evaluation of fitted
 * FOLLOWERS (eyes/mouth/tear, grafts, shells, clothing) silently degrades in a
 * measured, deterministic pattern (2026-08-24/25, DS4 4.24, exporter 2.1.10):
 * every scripted export after a scene RE-load in the same Daz session freezes
 * the followers while the figure keeps moving. The summary is the only
 * artifact that tells that export from a healthy one — alembics are not
 * bit-reproducible and size is not a health metric.
 *
 * Two verdict layers exist on purpose:
 *
 * - The CARRIER gate (runtime v102, `MOTION_SUMMARY_HELPER` in dsa.ts) runs
 *   inside Daz and judges absolutes: an all-zero summary un-lands the export,
 *   a best node under ~90% warns. It cannot judge followers RELATIVE to the
 *   figure — and the measured partial staleness is exactly that shape: figure
 *   464/484 while eyes sit at 110 and boots at 45.
 * - THIS module is the studio's relative gate, run over the per-set export
 *   `.log` after a batch. Same log, richer judgement, and a place to evolve
 *   thresholds without a runtime version.
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
  /** The LAST summary block's node lines, in log order. */
  nodes: Array<MotionSummaryNode>
  /**
   * The exporter's own "N of M frames left at least one mesh unchanged"
   * warning when it accompanies that block (2.1.10+ prints it only when the
   * count is notable — it appears on none of the twelve measured healthy
   * runs). Null when absent.
   */
  unchangedFrames: { affected: number; total: number } | null
}

/**
 * Parse the LAST "Alembic ROM motion summary" block out of an export log.
 *
 * Last, because the exporter APPENDS to one per-set log across runs — an
 * earlier run's block must never judge a later export. Callers scope the log
 * to the run they are judging by its file mtime (this module never sees the
 * filesystem). Null when the log carries no parseable block at all — an older
 * exporter is not evidence of anything.
 */
export function parseLastMotionSummary(logText: string): MotionSummary | null {
  const HEADER = 'Alembic ROM motion summary'
  const at = logText.lastIndexOf(HEADER)
  if (at < 0) return null
  const nodes: Array<MotionSummaryNode> = []
  for (const line of logText.slice(at).split('\n').slice(1)) {
    // The node label sits between the log prefix ("[ts] [INFO]   ") and
    // ": moved on" — excluding ':', '[' and ']' from the label class stops the
    // capture from swallowing the timestamp prefix. Same expression the
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
  if (nodes.length === 0) return null
  // The unchanged-frames warning is printed right BEFORE its summary block.
  // Only a line between the previous block and this one belongs to this run.
  const prev = logText.lastIndexOf(HEADER, at - 1)
  const between = logText.slice(prev < 0 ? 0 : prev + HEADER.length, at)
  let unchangedFrames: MotionSummary['unchangedFrames'] = null
  const re = /(\d+) of (\d+) frames left at least one mesh unchanged/g
  for (let m = re.exec(between); m; m = re.exec(between)) {
    const total = Number(m[2])
    if (total > 0) unchangedFrames = { affected: Number(m[1]), total }
  }
  return { nodes, unchangedFrames }
}

/**
 * A follower counts as LOW when its moved fraction is under half the
 * reference node's. Measured separation (Ita.log, 12 runs): the degraded
 * runs' frozen followers sit at 9–35% of the figure while the worst HEALTHY
 * follower ever measured (Genesis 9 Tear, 290/484 vs figure 483/484) is 60%
 * — 0.5 splits the gap, with the next-worst healthy follower (Eyes, 77%)
 * already well clear. Degraded runs also put NINE-plus nodes under the bar,
 * so the two-node minimum below adds its own margin.
 */
export const MOTION_LOW_FOLLOWER_RATIO = 0.5

/**
 * One low mesh is legitimate — static props exist. The degraded signature is
 * MULTIPLE followers far below a moving figure (nine of eleven on the
 * measured runs), so the gate needs at least two.
 */
export const MOTION_DEGRADED_LOW_COUNT = 2

/**
 * The exporter's unchanged-frames warning fails the run when nearly every
 * frame left a mesh unchanged. Measured degraded: 472 of 483 (0.977); no
 * healthy run printed the line at all.
 */
export const MOTION_UNCHANGED_FRAMES_RATIO = 0.9

export interface MotionGateVerdict {
  /** The export is judged stale — fail the scene. */
  degraded: boolean
  /** The liveliest node (the figure on every measured run) — what the
   *  followers are judged relative to. */
  reference: MotionSummaryNode | null
  /** The nodes far below the reference ({@link MOTION_LOW_FOLLOWER_RATIO}). */
  low: Array<MotionSummaryNode>
  /** Human-readable grounds, one line per finding — empty when healthy. */
  reasons: Array<string>
}

const pct = (moved: number, total: number): string =>
  `${Math.round((moved / total) * 100)}%`

/**
 * Judge one run's summary — the RELATIVE gate.
 *
 * Degraded when:
 * - no node moved at all (the total statue — the carrier gate also un-lands
 *   this one; judged here too so a studio-side reader never depends on the
 *   runtime version that generated the carrier), or
 * - at least {@link MOTION_DEGRADED_LOW_COUNT} nodes sit below
 *   {@link MOTION_LOW_FOLLOWER_RATIO} of the reference node's moved fraction
 *   while the reference itself moved, or
 * - the exporter's own unchanged-frames warning covers
 *   {@link MOTION_UNCHANGED_FRAMES_RATIO} of the walk.
 *
 * Null in, nothing out: a log without a summary gates nothing.
 */
export function motionGateVerdict(summary: MotionSummary | null): MotionGateVerdict {
  const verdict: MotionGateVerdict = { degraded: false, reference: null, low: [], reasons: [] }
  if (!summary) return verdict
  let reference: MotionSummaryNode | null = null
  for (const node of summary.nodes) {
    if (!reference || node.moved / node.total > reference.moved / reference.total) {
      reference = node
    }
  }
  verdict.reference = reference
  if (!reference) return verdict
  if (reference.moved === 0) {
    verdict.degraded = true
    verdict.reasons.push(
      `no exported mesh moved on any of the ${reference.total} ROM frames (statue export)`,
    )
    return verdict
  }
  const refFraction = reference.moved / reference.total
  verdict.low = summary.nodes.filter(
    (node) => node !== reference && node.moved / node.total < MOTION_LOW_FOLLOWER_RATIO * refFraction,
  )
  if (verdict.low.length >= MOTION_DEGRADED_LOW_COUNT) {
    verdict.degraded = true
    const worst = [...verdict.low].sort((a, b) => a.moved / a.total - b.moved / b.total)
    verdict.reasons.push(
      `${verdict.low.length} meshes barely moved while ${reference.node} moved on ${pct(reference.moved, reference.total)} of the ROM's frames (e.g. ${worst
        .slice(0, 3)
        .map((n) => `${n.node} ${pct(n.moved, n.total)}`)
        .join(', ')}) — the measured follower-evaluation staleness`,
    )
  }
  const uf = summary.unchangedFrames
  if (uf && uf.affected / uf.total >= MOTION_UNCHANGED_FRAMES_RATIO) {
    verdict.degraded = true
    verdict.reasons.push(
      `the exporter reported ${uf.affected} of ${uf.total} frames left at least one mesh unchanged`,
    )
  }
  return verdict
}
