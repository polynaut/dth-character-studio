/**
 * "Does this per-scene preserve list differ from the base?" — the comparison that
 * both derives the `preserve.enabled` gate (`use-scene-selection.ts`) and shows the
 * override reset handle (`preserve-fields.tsx`). They MUST agree, so the compare
 * lives here once.
 *
 * Compared as a canonical MULTISET: the natural-identity tuples sorted, then
 * JSON-encoded. Order-independent (reordering a row never spuriously arms the
 * override) but multiplicity-aware — unlike a plain Set, which ignores duplicates
 * and so read a genuinely-diverged list as equal (base `[Head, Neck]` vs an edited
 * `[Head, Head]`), wrongly disarming the override and reverting the edit.
 */

/** Canonical multiset key for a preserve-morph list (name + hold value + node
 *  scope). Each row is JSON-encoded first, so a plain string sort orders them
 *  unambiguously. `node` is normalized to '' so a pre-v32 row compares equal to
 *  its re-saved self. */
export function preserveMorphsKey(
  list: ReadonlyArray<{ name: string; keepValue: number; node?: string }>,
): string {
  return JSON.stringify(list.map((m) => JSON.stringify([m.name, m.keepValue, m.node ?? ''])).sort())
}

/** Canonical multiset key for a preserve-node-transform list (node label). */
export function preserveNodesKey(list: ReadonlyArray<{ nodeLabel: string }>): string {
  return JSON.stringify(list.map((n) => n.nodeLabel).sort())
}

/** Canonical multiset key for a frame-0 morph list (name + value + node scope)
 *  — same arm/reset agreement contract as the preserve keys, for the "Add
 *  morphs on frame 0" panel. */
export function frameZeroMorphsKey(
  list: ReadonlyArray<{ name: string; value: number; node?: string }>,
): string {
  return JSON.stringify(list.map((m) => JSON.stringify([m.name, m.value, m.node ?? ''])).sort())
}

/** Canonical multiset key for a bare label list (per-scene hair items). */
export function labelsKey(labels: ReadonlyArray<string>): string {
  return JSON.stringify([...labels].sort())
}
