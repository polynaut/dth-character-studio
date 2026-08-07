/**
 * The surface-merge rule for DazToHue material slots.
 *
 * **A Daz surface can belong to exactly one material slot.** That single
 * invariant is what makes a material transfer well-defined: installing a slot
 * must evict exactly the slots that claim the surfaces it claims, and leave
 * everything else alone.
 *
 * Neither of the two obvious modes obeys it, which is why this module exists:
 *
 *  * *Replace* wipes the whole list — measured, copying one `MI_Skin` onto a
 *    real 25-slot node left it with 1 slot and no way back but the backup.
 *  * *Append* (merging by slot NAME) leaves the target's own `Body`, `Head`,
 *    `Legs`… beside the incoming `Skin` that already merges all three, so the
 *    same surfaces end up claimed twice.
 *
 * The eviction set is derived from the INCOMING slots' own `material_group`
 * values, read out of the source at transfer time. Nothing here knows what a
 * Genesis 9 skin is made of, so nothing has to be updated when a generation
 * changes — the rule is generation-agnostic by construction.
 *
 * ## The mirror
 *
 * This is the twin of `_plan_surface_merge` in
 * `lib/rom/houdini-runtime/material_utils.py`, which is the copy that actually
 * writes the `.hip`. This one drives the confirm dialog's preview, so a user
 * sees what will be replaced BEFORE running rather than in the report after.
 * Both implement the same rule and are pinned by the same cases — a repo rule
 * for any decision that lives on two sides of a boundary (`.ai/gotchas.md`).
 * Change one, change both.
 */

/**
 * One slot as the merge rule sees it: a name, and the surfaces it claims.
 *
 * `surfaces` are the RAW tokens of the node's `material_group#` string —
 * measured on DazToHue 2.5, a space-separated list of `@fbx_material_name=Body`
 * group expressions. They are compared verbatim, never parsed: the attribute
 * name is the HDA's business, and an exact compare cannot mistake one claim for
 * another. A pattern token (`@fbx_material_name=GP*`) therefore matches nothing
 * and evicts nothing — the conservative direction, since a wrong eviction
 * deletes the user's work and a missed one leaves a duplicate they can see.
 */
export interface MergeSlot {
  name: string
  surfaces: ReadonlyArray<string>
}

/** What installing a set of slots does to the slots a target already has. */
export interface SurfaceMergePlan {
  /** Target slots that go away entirely: every surface they claimed is now
   *  claimed by an incoming slot, or an incoming slot carries their NAME. */
  evicted: Array<string>
  /** Target slots that keep some surfaces and lose others — the partial
   *  overlap. They survive, minus the claims that moved. */
  trimmed: Array<string>
  /** Surfaces the incoming slots claim that NO target slot claims today.
   *
   *  A handful is ordinary (the source wears something the target doesn't). All
   *  of them, on a large set, means the two nodes describe different figures —
   *  copying a Genesis 9 skin onto a Genesis 8 character would look exactly like
   *  this. The studio has not measured how the generations name their surfaces,
   *  so this reports the symptom instead of asserting a rule. */
  unclaimed: Array<string>
}

/** The surfaces a target slot keeps once the incoming claims are taken out. */
function keptSurfaces(
  slot: MergeSlot,
  incomingSurfaces: ReadonlySet<string>,
): Array<string> {
  return slot.surfaces.filter((token) => !incomingSurfaces.has(token))
}

/**
 * What installing `incoming` does to `targetSlots`.
 *
 * Order is the target's own — the report reads in the order the user sees the
 * slots in Houdini.
 */
export function planSurfaceMerge(
  targetSlots: ReadonlyArray<MergeSlot>,
  incoming: ReadonlyArray<MergeSlot>,
): SurfaceMergePlan {
  const incomingSurfaces = new Set(incoming.flatMap((slot) => [...slot.surfaces]))
  const incomingNames = new Set(incoming.map((slot) => slot.name).filter(Boolean))

  const evicted: Array<string> = []
  const trimmed: Array<string> = []
  const claimed = new Set<string>()

  for (const slot of targetSlots) {
    for (const token of slot.surfaces) {
      if (incomingSurfaces.has(token)) claimed.add(token)
    }
    // A name collision is its own eviction reason, independent of surfaces: two
    // slots called `Skin` render one material name (`MI_Skin`) and a baker
    // naming it could resolve to either. The incoming one is the one the user
    // just asked for, so it wins.
    if (incomingNames.has(slot.name)) {
      evicted.push(slot.name)
      continue
    }
    const kept = keptSurfaces(slot, incomingSurfaces)
    if (kept.length === slot.surfaces.length) continue
    // Emptied by the merge — every surface it existed to claim has moved. A
    // slot that claimed NOTHING to begin with is left alone: it lost nothing,
    // and silently deleting an empty slot the user made is not this rule's job.
    if (kept.length === 0) evicted.push(slot.name)
    else trimmed.push(slot.name)
  }

  return {
    evicted,
    trimmed,
    unclaimed: [...incomingSurfaces].filter((token) => !claimed.has(token)),
  }
}

/**
 * A surface claim as a human reads it: `@fbx_material_name=Body` → `Body`.
 *
 * Display only — the merge itself never parses a token (see {@link MergeSlot}).
 * A token in any other shape is shown as it is, which is the honest rendering
 * of something this code does not understand.
 */
export function surfaceLabel(token: string): string {
  const match = /^@[^=]+=(.+)$/.exec(token)
  return match?.[1] ?? token
}

/** How many slots a plan touches at all — the confirm dialog's headline number. */
export function mergeTouchCount(plan: SurfaceMergePlan): number {
  return plan.evicted.length + plan.trimmed.length
}
