import { z } from 'zod'

/**
 * The on-disk record of which linked `.hip` files the studio has run DazToHue's
 * own **Refresh Assets** tool on, and under which DTH release.
 *
 * Why it exists: a `.hip` stores the DazToHue asset definitions it was built
 * with, so installing a new DTH release leaves every existing project on the
 * old ones. `refreshHoudiniAssets` can fix that headlessly — but nothing in a
 * project says whether it NEEDS it, and nothing afterwards says whether it
 * helped (see `op_refresh` in material_utils.py). So the studio records the one
 * thing it legitimately knows: **that it ran the tool on this file while
 * release X was active.** That is a fact about what the app did, never a claim
 * about the file's contents.
 *
 * Three consequences of taking that honesty seriously:
 *
 *  - A file with **no entry** is `unknown`, not stale. It is still offered (it
 *    may well be on old definitions), but the offer says "never refreshed by
 *    the studio" rather than pretending to a verdict.
 *  - The entry carries **no mtime**. A user re-saving the project in Houdini
 *    does not undo the refresh, so invalidating on mtime — the way the scan
 *    store must — would manufacture staleness that isn't there.
 *  - {@link HoudiniRefreshStore.lastSeenDthVersion} is what makes "the release
 *    CHANGED" sayable at all on a library where nothing has an entry yet.
 *    Without it, a first run could only ever say "I don't know", and the offer
 *    would either nag on every refresh or never appear.
 *
 * **App-data, not project-data, on purpose.** The answer depends on which DTH
 * release is installed into THIS machine's Houdini; a `.hip` on a share that
 * machine A refreshed under 2.6 genuinely still wants a run on machine B if B
 * still has 2.5 installed. The flip side is the honest limitation: a project
 * refreshed on another machine reads as `unknown` here.
 *
 * This module is pure — shape, classification and stamping — so the rules are
 * testable without a filesystem, a Houdini, or a DTH install.
 */

/** File name of the store, inside the app-data folder. */
export const HOUDINI_REFRESH_FILE = 'houdini-refresh.json'

const entrySchema = z.object({
  /** The DTH release that was active when the tool last ran on this file. */
  dthVersion: z.string().default(''),
  /** ISO timestamp of that run (diagnostics + the "last refreshed" line). */
  refreshedAt: z.string().default(''),
})

export type HoudiniRefreshEntry = z.infer<typeof entrySchema>

export const houdiniRefreshStoreSchema = z.object({
  version: z.number().default(1),
  /** The DTH release the last Refresh-assets run saw active. Set even when
   *  nothing was offered, so the NEXT release change is detectable on a library
   *  where no project has an entry yet. '' = never recorded. */
  lastSeenDthVersion: z.string().default(''),
  /** Keyed by {@link refreshStoreKey} — the normalized lower-cased path. */
  projects: z.record(z.string(), entrySchema).default({}),
})

export type HoudiniRefreshStore = z.infer<typeof houdiniRefreshStoreSchema>

export function emptyRefreshStore(): HoudiniRefreshStore {
  return { version: 1, lastSeenDthVersion: '', projects: {} }
}

/**
 * Parse a store. Anything unreadable becomes an EMPTY store rather than an
 * exception: every entry is re-earnable by running the tool again, so failing
 * loud here would break the Refresh page to save nothing. The cost of a lost
 * store is one extra offer, which is the safe direction.
 */
export function parseRefreshStore(text: string): HoudiniRefreshStore {
  try {
    return houdiniRefreshStoreSchema.parse(JSON.parse(text))
  } catch {
    return emptyRefreshStore()
  }
}

export function houdiniRefreshStoreJson(store: HoudiniRefreshStore): string {
  return JSON.stringify(store, null, 2)
}

/** The key a store files a project under — separators and case normalized, the
 *  way every other scene/project lookup in the app compares paths. */
export function refreshStoreKey(hipPath: string): string {
  return hipPath.trim().replace(/\\/g, '/').toLowerCase()
}

/**
 * How a linked project stands relative to the active DTH release.
 *
 *  - `stale` — the studio refreshed it, under a DIFFERENT release than the one
 *    active now. The only bucket that is evidence of anything.
 *  - `unknown` — the studio has never refreshed it. Offered, never diagnosed.
 *  - `current` — refreshed under exactly this release; skipped by the offer.
 */
export type RefreshBucket = 'stale' | 'unknown' | 'current'

/** A `.hip` some character links, with who links it (for the offer's list). */
export interface LinkedHoudiniProject {
  hipPath: string
  /** Character names linking this project — a shared project has several. */
  characters: Array<string>
}

export interface RefreshCandidate extends LinkedHoudiniProject {
  bucket: RefreshBucket
  /** The release it was last refreshed under; '' when never. */
  lastVersion: string
  /** ISO timestamp of that run; '' when never. */
  lastRefreshedAt: string
}

/**
 * Bucket every linked project against the active release.
 *
 * Total by construction: with no active release ('' — none configured, or the
 * configured folder is unreadable) nothing can be judged, so everything is
 * `unknown`. The caller is what refuses to offer in that state — classifying
 * and offering are separate decisions, and only one of them is pure.
 */
export function classifyRefreshTargets(
  projects: ReadonlyArray<LinkedHoudiniProject>,
  store: HoudiniRefreshStore,
  activeVersion: string,
): Array<RefreshCandidate> {
  return projects.map((project) => {
    const entry = store.projects[refreshStoreKey(project.hipPath)]
    const lastVersion = entry?.dthVersion ?? ''
    const bucket: RefreshBucket =
      !activeVersion || !lastVersion
        ? 'unknown'
        : lastVersion === activeVersion
          ? 'current'
          : 'stale'
    return {
      ...project,
      bucket,
      lastVersion,
      lastRefreshedAt: entry?.refreshedAt ?? '',
    }
  })
}

/**
 * Whether the DTH release has demonstrably CHANGED since the studio last
 * looked — the gate on offering the sweep at all.
 *
 * Two independent kinds of evidence, either of which is enough:
 *  - the recorded `lastSeenDthVersion` differs from what is active now (covers
 *    a library where nothing has an entry yet);
 *  - some project was refreshed under a different release (covers a store whose
 *    `lastSeenDthVersion` was written by a run that then failed to sweep).
 *
 * A first-ever run has neither, and returns false. That is deliberate: "I have
 * never looked" is not "it changed", and an offer on first launch would be a
 * guess dressed as a finding. The run records `lastSeenDthVersion` on its way
 * out, so the next real release change fires — with the never-refreshed
 * projects swept along with it.
 */
export function dthReleaseChanged(
  candidates: ReadonlyArray<RefreshCandidate>,
  store: HoudiniRefreshStore,
  activeVersion: string,
): boolean {
  if (!activeVersion) return false
  if (store.lastSeenDthVersion && store.lastSeenDthVersion !== activeVersion) return true
  return candidates.some((c) => c.bucket === 'stale')
}

/** The projects an offer would actually run on — everything not already
 *  refreshed under the active release. */
export function refreshTargetPaths(candidates: ReadonlyArray<RefreshCandidate>): Array<string> {
  return candidates.filter((c) => c.bucket !== 'current').map((c) => c.hipPath)
}

/**
 * Record that the tool ran on `hipPaths` under `version`. Never called for a
 * dry run, and never for a project whose run came back `ok: false`.
 *
 * Touches the per-project entries ONLY — advancing `lastSeenDthVersion` is the
 * caller's separate decision ({@link noteReleaseSeen}), and the two must not be
 * fused. A sweep where some projects failed stamps the ones that worked but
 * leaves `lastSeenDthVersion` alone, so the next refresh still sees a changed
 * release and offers the remainder. Fusing them would mark the release handled
 * on the strength of a partial run and silently strand every project that
 * failed.
 */
export function stampRefreshed(
  store: HoudiniRefreshStore,
  hipPaths: ReadonlyArray<string>,
  version: string,
  atIso: string,
): HoudiniRefreshStore {
  const projects = { ...store.projects }
  for (const hipPath of hipPaths) {
    const key = refreshStoreKey(hipPath)
    if (!key) continue
    projects[key] = { dthVersion: version, refreshedAt: atIso }
  }
  return { ...store, projects }
}

/** Record the active release without claiming anything was refreshed — what a
 *  run that offered nothing leaves behind, so the next change is detectable. */
export function noteReleaseSeen(store: HoudiniRefreshStore, version: string): HoudiniRefreshStore {
  if (!version || store.lastSeenDthVersion === version) return store
  return { ...store, lastSeenDthVersion: version }
}

/**
 * Drop entries for projects nothing links anymore — the store's retention
 * bound (app-generated data that nothing collects is how a disk fills).
 *
 * The caller may only pass a COMPLETE live set: an entry pruned because its
 * project was merely unreachable this run comes back as `unknown` and gets
 * offered again, which is safe but pointless work. Losing an entry can never
 * cost more than one extra run of a tool that is idempotent by nature.
 */
export function pruneRefreshStore(
  store: HoudiniRefreshStore,
  liveHipPaths: ReadonlyArray<string>,
): HoudiniRefreshStore {
  const live = new Set(liveHipPaths.map(refreshStoreKey))
  const projects: Record<string, HoudiniRefreshEntry> = {}
  for (const [key, entry] of Object.entries(store.projects)) {
    if (live.has(key)) projects[key] = entry
  }
  return { ...store, projects }
}
