// Sequential `await` in a loop is this module's normal shape: the enumeration
// walks one project's character library at a time, and a failure there must be
// attributable to the project it came from rather than raced with the others.
/* oxlint-disable no-await-in-loop */
import { exists, readTextFile, stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { charsRoot, fetchPoseAssetsCurrent, sweepTargets } from './core'
import { houdiniUtilsReady, refreshHoudiniAssets, studioBackupPath } from './houdini-material.ts'
import {
  HOUDINI_REFRESH_FILE,
  classifyRefreshTargets,
  dthReleaseChanged,
  emptyRefreshStore,
  forgetRefreshed,
  houdiniRefreshStoreJson,
  noteReleaseSeen,
  parseRefreshStore,
  pruneRefreshStore,
  refreshStoreKey,
  refreshTargetPaths,
  stampRefreshed,
} from '../houdini-refresh-store.ts'

import type { MaterialUtilReport } from './native-types.ts'
import type {
  HoudiniRefreshStore,
  LinkedHoudiniProject,
  RefreshCandidate,
} from '../houdini-refresh-store.ts'

export { refreshTargetPaths } from '../houdini-refresh-store.ts'
export type { RefreshBucket, RefreshCandidate } from '../houdini-refresh-store.ts'

/**
 * The Houdini half of "Refresh assets".
 *
 * The studio's own refresh (`refreshAllAssets`) brings the DAZ side up to date —
 * definitions, scripts, the PoseAsset CSVs. It cannot touch the other end: a
 * `.hip` stores the DazToHue asset definitions it was built with, so a new DTH
 * release leaves every existing project on the old ones until someone opens each
 * one in Houdini and presses **Refresh Assets** on the shelf.
 *
 * `refreshHoudiniAssets` (houdini-material.ts) already runs that shelf tool
 * headlessly under hython. This module is what decides WHEN to offer it and on
 * WHICH projects, and what remembers the answer afterwards
 * (`houdini-refresh-store.ts`).
 *
 * The offer is deliberately narrow. It fires only after the user ran the
 * studio's own refresh, and only when the DTH release demonstrably changed
 * since the studio last looked — never on a timer, never at launch, and never
 * as a verdict about a project, because no such verdict exists (see
 * `op_refresh`).
 */

// --- the store --------------------------------------------------------------

async function storePath(): Promise<string> {
  return storage.dataPath(HOUDINI_REFRESH_FILE)
}

async function readStore(): Promise<HoudiniRefreshStore> {
  try {
    const path = await storePath()
    if (await exists(path)) return parseRefreshStore(await readTextFile(path))
  } catch {
    // unreadable store — an empty one costs at most one extra offer
  }
  return emptyRefreshStore()
}

/**
 * Writes are serialized through one queue, each folding into a FRESH read — the
 * same discipline the scan store uses, for the same reason: a sweep holds its
 * decision across a whole hython run (minutes on a real library), and a second
 * window refreshing meanwhile would otherwise have its entries dropped by
 * whichever write landed last.
 */
let storeWrite: Promise<void> = Promise.resolve()

function queueStoreWrite(mutate: (store: HoudiniRefreshStore) => HoudiniRefreshStore): Promise<void> {
  const next = storeWrite.then(async () => {
    try {
      const path = await storePath()
      await storage.writeTextFileAtomic(path, houdiniRefreshStoreJson(mutate(await readStore())))
    } catch {
      // A store that cannot be written is an extra offer next time, nothing
      // worse — and a rejection here would poison the queue for every later
      // write in this session.
    }
  })
  storeWrite = next
  return next
}

// --- what is linked ---------------------------------------------------------

/**
 * Every `.hip` linked by a character in the sweep's scope, with the characters
 * that link it.
 *
 * Scope is `sweepTargets` — the same "every known project, in every window" set
 * the studio's own refresh acts on, so the two halves of one button can never
 * disagree about what "all your projects" means.
 *
 * Two projects can link the same file (a shared template, a character
 * duplicated from another), so paths dedupe case-insensitively and collect
 * their linkers rather than appearing twice. A path that does not exist on disk
 * is dropped here rather than handed to hython, which would spend a scene load
 * to report a missing file the studio could stat.
 *
 * `complete` is false when any known project could not be resolved this run —
 * the pruning gate. An unreachable project's links are not gone, they are
 * unseen, and pruning on an incomplete view would drop entries the studio
 * legitimately earned.
 */
export async function linkedHoudiniProjects(): Promise<{
  projects: Array<LinkedHoudiniProject>
  complete: boolean
}> {
  const { projects: known, unreachable } = await sweepTargets()
  let complete = unreachable.length === 0
  const byKey = new Map<string, LinkedHoudiniProject>()
  for (const project of known) {
    let characters: Awaited<ReturnType<typeof storage.listCharacters>>
    try {
      characters = await storage.listCharacters(charsRoot(project))
    } catch {
      complete = false // a library we could not read is not a library with no links
      continue
    }
    for (const character of characters) {
      for (const hipPath of character.houdiniProjects) {
        const key = refreshStoreKey(hipPath)
        if (!key) continue
        const found = byKey.get(key)
        if (found) {
          if (!found.characters.includes(character.name)) found.characters.push(character.name)
          continue
        }
        byKey.set(key, { hipPath, characters: [character.name] })
      }
    }
  }
  // Stat'd last, once per unique path: the dedupe above routinely collapses a
  // shared template that several characters link.
  const live = await Promise.all(
    [...byKey.values()].map(async (project) => {
      try {
        return (await exists(project.hipPath)) ? project : null
      } catch {
        // Unstattable (offline share) — not offered, and NOT counted as a
        // complete view, so its stored entry survives the prune.
        complete = false
        return null
      }
    }),
  )
  return { projects: live.filter((p): p is LinkedHoudiniProject => p !== null), complete }
}

// --- the plan ---------------------------------------------------------------

/**
 * A studio backup that ALREADY sits beside a project this sweep would run.
 *
 * `_backup` keeps one rolling copy per project, so saving a project overwrites
 * whatever is there — which is exactly the copy somebody kept in order to put
 * that project back on an older DazToHue release. Naming them before the run is
 * what turns a silent overwrite into a decision.
 *
 * "Would run on" is as far as the warning can honestly reach. Whether a copy is
 * actually replaced depends on something no plan can know in advance: `_backup`
 * runs only for a project the tool leaves modified (`op_refresh` saves nothing
 * otherwise), so an offered project may finish with its old copy untouched. The
 * warning therefore covers every project at risk and claims nothing about which
 * of them the run will reach.
 */
export interface ExistingBackup {
  hipPath: string
  backupPath: string
  /** ISO mtime of the copy; '' when it could not be stat'd. The one thing that
   *  makes "is this the one I kept?" answerable without leaving the dialog. */
  modifiedAt: string
}

export interface HoudiniRefreshPlan {
  /** '' when the sweep can run here; otherwise why it cannot, in hython's own
   *  words (no desktop app, no Houdini install, no matching docs folder). A
   *  blocked plan is never offered — the user cannot act on it. */
  blocked: string
  /** The DTH release active now; '' when none is configured or resolvable. */
  activeDthVersion: string
  /** The release the last Refresh-assets run recorded; '' on a first run. */
  lastSeenDthVersion: string
  /** Every linked project, bucketed — `current` ones included, so the offer can
   *  say what it is SKIPPING rather than silently narrowing the list. */
  candidates: Array<RefreshCandidate>
  /** There is evidence the release changed since the studio last looked. */
  releaseChanged: boolean
  /** The whole linked set was readable this run (the pruning gate). */
  complete: boolean
  /** Backups a real run would REPLACE — see {@link ExistingBackup}. Scoped to
   *  the projects the sweep would actually run on, because a copy beside a
   *  project that is being skipped is in no danger. */
  existingBackups: Array<ExistingBackup>
}

/** Whether a plan is worth putting in front of the user: it can run, the
 *  release changed, and something is actually left to run it on. */
export function shouldOfferRefresh(plan: HoudiniRefreshPlan): boolean {
  return (
    plan.blocked === '' &&
    plan.releaseChanged &&
    plan.candidates.some((c) => c.bucket !== 'current')
  )
}

/**
 * The studio backups already sitting beside `hipPaths` — the copies a real run
 * would REPLACE.
 *
 * Probed here rather than discovered afterwards, because afterwards is too
 * late: `_backup` overwrites in the same breath as it copies, so by the time a
 * report exists the older copy is already gone. Best-effort per path — a
 * backup folder that cannot be read simply is not warned about, which is the
 * safe direction (nothing is destroyed that the run was not going to destroy
 * anyway).
 */
async function existingBackupsFor(
  hipPaths: ReadonlyArray<string>,
): Promise<Array<ExistingBackup>> {
  const found = await Promise.all(
    hipPaths.map(async (hipPath) => {
      const backupPath = studioBackupPath(hipPath)
      try {
        if (!(await exists(backupPath))) return null
      } catch {
        return null
      }
      let modifiedAt = ''
      try {
        modifiedAt = (await stat(backupPath)).mtime?.toISOString() ?? ''
      } catch {
        // unstattable — the copy is still named, just not dated
      }
      return { hipPath, backupPath, modifiedAt }
    }),
  )
  return found.filter((entry): entry is ExistingBackup => entry !== null)
}

/**
 * Work out whether the linked Houdini projects want DazToHue's Refresh Assets,
 * and on which of them.
 *
 * Never throws: this runs as a follow-up to the studio's own refresh, and a
 * failure to plan the OPTIONAL half must not turn a successful refresh into an
 * error. Anything unresolvable comes back as a blocked plan.
 */
export async function planHoudiniAssetRefresh(): Promise<HoudiniRefreshPlan> {
  const empty: HoudiniRefreshPlan = {
    blocked: '',
    activeDthVersion: '',
    lastSeenDthVersion: '',
    candidates: [],
    releaseChanged: false,
    complete: false,
    existingBackups: [],
  }
  if (!isTauri()) {
    return { ...empty, blocked: 'Refreshing DazToHue assets needs the desktop app (it runs hython).' }
  }
  try {
    const blocked = await houdiniUtilsReady()
    const catalog = await fetchPoseAssetsCurrent()
    const activeDthVersion = catalog.error ? '' : catalog.version
    const store = await readStore()
    const { projects, complete } = await linkedHoudiniProjects()
    const candidates = classifyRefreshTargets(projects, store, activeDthVersion)
    return {
      blocked,
      activeDthVersion,
      lastSeenDthVersion: store.lastSeenDthVersion,
      candidates,
      releaseChanged: dthReleaseChanged(candidates, store, activeDthVersion),
      complete,
      // Only for what the sweep would actually RUN on: a copy beside a project
      // that is being skipped is in no danger, and warning about it would teach
      // the eye to skip the warning that matters.
      existingBackups: await existingBackupsFor(refreshTargetPaths(candidates)),
    }
  } catch (e) {
    return { ...empty, blocked: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Record the active release WITHOUT claiming anything was refreshed, and prune
 * entries for projects nothing links anymore.
 *
 * Called on every Refresh-assets run that does not open the offer — including
 * the very first one ever, which is exactly how a library where nothing has an
 * entry yet becomes able to detect the NEXT release change (see
 * `dthReleaseChanged`). Pruning only on a `complete` view is the same rule the
 * housekeeping GCs follow: an incomplete picture may delete nothing.
 */
export async function noteDthReleaseSeen(plan: HoudiniRefreshPlan): Promise<void> {
  if (!plan.activeDthVersion) return
  await queueStoreWrite((store) => {
    const noted = noteReleaseSeen(store, plan.activeDthVersion)
    return plan.complete
      ? pruneRefreshStore(noted, plan.candidates.map((c) => c.hipPath))
      : noted
  })
}

// --- running it -------------------------------------------------------------

const runInput = z.object({
  hipPaths: z.array(z.string().min(1)).min(1),
  /** The release the run is being stamped with — the plan's active version.
   *  Never '': an unresolvable release cannot produce an offer in the first
   *  place, and a blank stamp would file entries that read back as `unknown`. */
  dthVersion: z.string().min(1),
  /** true = load each project and run the tool, but never save (and never
   *  stamp: a dry run leaves the file on its old definitions). */
  dryRun: z.boolean(),
})

/**
 * Run DazToHue's Refresh Assets across the offered projects, then record what
 * actually happened.
 *
 * What gets stamped is deliberately narrow — only projects whose entry came
 * back `ok`, and only on a real run:
 *  - `ok: false` means the tool did not run there (missing shelf tool, a scene
 *    that would not load), so nothing is known and nothing is claimed;
 *  - `changed: false` with `ok: true` DOES stamp: the tool ran and the scene
 *    reported itself unmodified, which is a refresh that had nothing to do —
 *    not a refresh that failed to happen;
 *  - a dry run stamps nothing, because it saved nothing.
 *
 * The backup is the existing one, unchanged: `op_refresh` copies each project
 * to its `backup/` folder before saving. It is ONE rolling copy per project,
 * so it undoes THIS run — not a chain of them. The offer says so, and this
 * sweep never hands its backups to `discardHoudiniBackups`: the whole reason a
 * user reverts one of these is to put a project back on an older DTH release,
 * which is a want that arrives days later, not on the way out of a dialog.
 *
 * **The consented destruction is `_backup`'s own overwrite, and nothing more.**
 * A copy already beside a project is one this run may replace, and it is exactly
 * the copy somebody kept in order to go back a DazToHue release — so the dialog
 * names every one of them and refuses to start until that is acknowledged. What
 * it must NOT do is delete them up front. `_backup` writes only for a project
 * the tool left modified, so a pre-emptive delete would destroy the copies
 * beside every project that reports no change, every project that fails, and —
 * worst — all of them when the run cannot start at all (the shelf tool missing
 * for this Houdini is the common failure). Letting the overwrite do its own
 * destroying makes the loss coincide exactly with the replacement: a project is
 * only ever left without a copy if it was never going to lose one.
 *
 * **The release is marked seen only on a CLEAN sweep.** If any project failed,
 * `lastSeenDthVersion` is left where it was, so the next Refresh-assets run
 * still detects the change and re-offers exactly the projects that did not get
 * done (the ones that did are stamped, and skipped). A sweep that advanced it
 * on a partial result would report the release handled and strand the rest
 * until some future release change — the failure mode worth designing out,
 * because the common cause of a failure here (DazToHue not installed for this
 * Houdini version) is one the user fixes and then expects to retry.
 */
export async function runHoudiniAssetRefresh({
  data,
}: {
  data: unknown
}): Promise<MaterialUtilReport> {
  const input = runInput.parse(data)
  const report = await refreshHoudiniAssets({
    data: { hipPaths: input.hipPaths, dryRun: input.dryRun },
  })
  if (!input.dryRun) {
    const refreshed = report.refresh.filter((entry) => entry.ok).map((entry) => entry.hipPath)
    // Measured against what was ASKED FOR, never against what came back: a
    // report that is short of the requested projects is a partial sweep, and
    // comparing it to itself would call that clean and mark the release handled
    // for projects the tool never reached.
    const clean = refreshed.length === input.hipPaths.length
    await queueStoreWrite((store) => {
      const stamped = stampRefreshed(store, refreshed, input.dthVersion, new Date().toISOString())
      return clean ? noteReleaseSeen(stamped, input.dthVersion) : stamped
    })
  }
  return report
}

/**
 * Forget that the studio ever refreshed this project — what an **Undo this
 * run** actually means for the record.
 *
 * Restoring puts the `.hip` back on the definitions it had before the sweep, so
 * leaving the entry behind would have the store assert a refresh that has been
 * taken back: the project would bucket as `current` and never be offered again,
 * while sitting on the old assets. Dropping the entry returns it to `unknown` —
 * offered, not diagnosed, which is exactly what is true of it again.
 *
 * Never throws (and never advances anything): the restore itself already
 * succeeded, and a store that cannot be written costs one missed offer.
 */
export async function noteHoudiniRefreshUndone(hipPath: string): Promise<void> {
  if (!hipPath.trim()) return
  await queueStoreWrite((store) => forgetRefreshed(store, hipPath))
}
