import { exists, readDir, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { join, walkFilesStrict } from '../storage/fs'
import { avatarSourceMaster, parseAvatarName } from '../avatar-names'
import { characterFolderName } from '../library'
import { charsRoot, projectsForSweep } from './core'
import type { ProjectInfo } from './core'
import { gcNoteMedia } from './notes'
import { housekeepingResultSchema, remapResultSchema } from './native-types.ts'
// Inferred from the zod schemas (parsed at the invoke boundary below) + re-exported.
import type { HousekeepingResult, RemapResult } from './native-types.ts'
export type { HousekeepingResult, RemapResult }

// --- Housekeeping: keep app-generated data from filling the disk -------------
// Product-scan CSVs (one per Daz scene, app-data) age out after
// PRODUCT_SCAN_RETENTION_DAYS; the Scan_Frames keyframe CSVs (also one per Daz
// scene) after SCAN_FRAMES_RETENTION_DAYS; unreferenced note media ages out
// after NOTE_MEDIA_RETENTION_DAYS (the save-time GC usually gets there first);
// the dedup quarantine (large, reversible backup) is only ever emptied on the
// user's explicit request. deleteCharacter also prunes a character's scan
// folder + avatar so nothing orphans going forward.

/** Days a product-scan file is kept before the launch/manual sweep ages it out.
 *  Still load-bearing under the unattended pickup (which deletes what it
 *  ingests): this sweep is the ONLY GC for what ingestion deliberately leaves —
 *  CSVs it will never consume (truncated before their scene row), settling
 *  terminator-less files of characters whose page is never opened, and the
 *  `_diagnostic-*.txt` reports the Daz script writes beside the CSVs. */
export const PRODUCT_SCAN_RETENTION_DAYS = 30

/** Days a Scan_Frames keyframe CSV is kept before the sweep ages it out —
 *  scans are cheap to reproduce (re-run the script on the scene). */
export const SCAN_FRAMES_RETENTION_DAYS = 30

/** Days an unreferenced note-media file is kept before the sweep removes it. */
export const NOTE_MEDIA_RETENTION_DAYS = 7

/**
 * Backstop for the save-time note-media GC: for every known project, delete
 * media files no notes file references anymore, once they're older than
 * NOTE_MEDIA_RETENTION_DAYS. Covers projects whose notes are never saved
 * again. A missing/offline project dir contributes nothing (skipped silently).
 */
export async function sweepNoteMedia(): Promise<HousekeepingResult> {
  const total: HousekeepingResult = { filesDeleted: 0, bytesFreed: 0 }
  for (const project of await projectsForSweep()) {
    try {
      const freed = await gcNoteMedia(project.path, NOTE_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      total.filesDeleted += freed.filesDeleted
      total.bytesFreed += freed.bytesFreed
    } catch {
      // an unreachable project — contributes nothing this sweep
    }
  }
  return total
}

/**
 * Recursively delete `dir` (which the caller has containment-checked), first
 * summing its files into a HousekeepingResult. The STRICT walk is part of the
 * safety: a subtree that can't be fully listed can't be fully judged, so the
 * whole candidate is left alone (the caller catches) rather than half-counted
 * and deleted anyway.
 */
async function removeDirCounted(dir: string): Promise<HousekeepingResult> {
  const result: HousekeepingResult = { filesDeleted: 0, bytesFreed: 0 }
  for (const rel of await walkFilesStrict(dir)) {
    result.filesDeleted += 1
    try {
      result.bytesFreed += (await stat(join(dir, rel))).size
    } catch {
      // counted but unsized — the delete below still covers it
    }
  }
  await remove(dir, { recursive: true })
  return result
}

/** Fold `add` into `total` in place (the sweep's running report). */
function addResult(total: HousekeepingResult, add: HousekeepingResult): void {
  total.filesDeleted += add.filesDeleted
  total.bytesFreed += add.bytesFreed
}

/**
 * The per-character meta dirs under `.dcsmeta/characters/` that belong to NO
 * live character — as ABSOLUTE paths, all inside `metaRoot` by construction
 * (they come out of readDir descent) and re-checked by the caller. `liveKeys`
 * are the {@link storage.characterMetaDir} keys (the character's
 * library-relative folder, or its id for a loose root-level definition),
 * case-folded: keys can NEST (`group a/ita`), so a folder that is an ANCESTOR
 * of a live key is recursed into rather than judged whole, and a folder that
 * IS a live key keeps its whole subtree. Loose FILES at any level are left
 * alone — only keyed character dirs are ever this sweep's to delete.
 */
async function collectOrphanMetaDirs(
  absDir: string,
  relLower: string,
  liveKeys: ReadonlySet<string>,
): Promise<Array<string>> {
  const out: Array<string> = []
  for (const entry of await readDir(absDir)) {
    if (!entry.isDirectory) continue
    const childAbs = join(absDir, entry.name)
    const childRel = relLower ? `${relLower}/${entry.name.toLowerCase()}` : entry.name.toLowerCase()
    if (liveKeys.has(childRel)) continue
    if ([...liveKeys].some((key) => key.startsWith(`${childRel}/`))) {
      out.push(...(await collectOrphanMetaDirs(childAbs, childRel, liveKeys)))
      continue
    }
    out.push(childAbs)
  }
  return out
}

/**
 * One project's orphan pass: delete per-character meta dirs
 * (`.dcsmeta/characters/<folder>`) and avatar images (`.dcsmeta/images/`) that
 * match no live character. Deleting a character through the app already prunes
 * both — this covers EXTERNAL renames/deletes (Explorer, another machine's
 * sync), which used to strand them forever.
 *
 * STRICT guards, in the note-media GC's spirit (an incomplete view must delete
 * nothing):
 *  - the characters root is pre-walked STRICTLY — an unreadable subtree (or a
 *    missing root) aborts the whole pass, because the tolerant scan would have
 *    silently read its characters as deleted;
 *  - the scan must report ZERO problems — an unreadable definition is a
 *    character that EXISTS, not one that was deleted;
 *  - meta dirs are judged by their {@link storage.characterMetaDir} key,
 *    avatars by the character id in their filename (avatar-names); anything
 *    that can't be attributed (loose files, legacy fixed-name avatars) is left
 *    alone rather than deleted on a guess.
 */
async function sweepProjectOrphans(project: ProjectInfo): Promise<HousekeepingResult> {
  const total: HousekeepingResult = { filesDeleted: 0, bytesFreed: 0 }
  const root = charsRoot(project)
  // Completeness gate: same tree, same dot-folder pruning as the scan below,
  // but ABORTING on any unreadable directory. (A subtree turning unreadable in
  // the instant between this walk and the scan can still slip through — the
  // same narrow race the note-media GC accepts between collection and delete.)
  await walkFilesStrict(root, '', (name) => name.startsWith('.'))
  const scan = await storage.scanCharacterLibrary(root)
  if (scan.problems.length > 0) return total
  const liveKeys = new Set(
    scan.entries.map((e) => (e.location.relFolder.trim() || e.character.id).toLowerCase()),
  )
  const liveIds = new Set(scan.entries.map((e) => e.character.id.toLowerCase()))

  // Meta dirs. Containment re-checked per candidate: only paths under the meta
  // root are ever removed, however the walk produced them.
  const metaRoot = storage.metaCharactersDir(project.path)
  const metaRootKey = metaRoot.toLowerCase()
  try {
    for (const orphan of await collectOrphanMetaDirs(metaRoot, '', liveKeys)) {
      if (!orphan.toLowerCase().startsWith(`${metaRootKey}/`)) continue
      try {
        addResult(total, await removeDirCounted(orphan))
      } catch {
        // locked/unlistable candidate — left for the next sweep
      }
    }
  } catch {
    // no meta root yet, or it can't be listed — nothing to judge safely
  }

  // Avatars. `.src` siblings are classified by their MASTER's name, so they go
  // with it — a dead character loses both, a live one keeps both.
  try {
    const imagesDir = storage.metaImagesDir(project.path)
    for (const entry of await readDir(imagesDir)) {
      if (!entry.isFile) continue
      const owner = avatarSourceMaster(entry.name) ?? entry.name
      const parsed = parseAvatarName(owner)
      // Current-scheme names parse; legacy `<id>-<ts>.<ext>` names strip to an
      // id. A name matching neither is unattributable — never deleted.
      const id = parsed?.id ?? (/-\d+\.[^.]+$/.test(owner) ? owner.replace(/-\d+\.[^.]+$/, '') : '')
      if (!id || liveIds.has(id.toLowerCase())) continue
      const path = join(imagesDir, entry.name)
      try {
        const size = (await stat(path)).size
        await remove(path)
        addResult(total, { filesDeleted: 1, bytesFreed: size })
      } catch {
        // locked / already gone — the next sweep retries
      }
    }
  } catch {
    // no images dir yet, or it can't be listed
  }
  return total
}

/**
 * The orphan pass across every known project. Per-project tolerant like the
 * note-media sweep: an unreachable project (or one failing its strict guards)
 * contributes nothing this run and is retried next sweep.
 */
async function sweepOrphanedCharacterData(): Promise<HousekeepingResult> {
  const total: HousekeepingResult = { filesDeleted: 0, bytesFreed: 0 }
  for (const project of await projectsForSweep()) {
    try {
      addResult(total, await sweepProjectOrphans(project))
    } catch {
      // guards tripped (unreadable root/subtree) — deleting nothing is the point
    }
  }
  return total
}

/**
 * Orphaned per-character SCRIPT dirs in the Daz library
 * (`Scripts/DTH-Character-Studio/<project>/<character>/`): a character deleted
 * or renamed OUTSIDE the app (Explorer, another machine's sync) strands its
 * generated-script folder forever — the in-app delete removes it as a derived
 * artifact, and a rename whose regeneration threw mid-way leaks the old-name
 * dir the same way. This sweep is the app-external counterpart, with STRICTER
 * gates than the in-app delete because it reaches into the user's Daz library:
 *  - only DIRECTORIES are candidates, and only inside a project folder whose
 *    sanitized name belongs to a KNOWN project (recents is the registry) — an
 *    unknown project dir may belong to a project this machine never opened,
 *    and the runtime files at the root are files, never candidates;
 *  - names sanitize through {@link characterFolderName}, and two projects can
 *    sanitize to ONE folder — live sets are UNIONED per folder, and a folder
 *    claimed by any project that failed its gates is off limits this run;
 *  - per project, the same strictness as the meta-dir GC: a strict pre-walk of
 *    the characters root plus a zero-problem scan — an unreadable definition
 *    is a character that EXISTS, not one whose scripts are orphaned.
 */
async function sweepOrphanScriptDirs(): Promise<HousekeepingResult> {
  const total: HousekeepingResult = { filesDeleted: 0, bytesFreed: 0 }
  try {
    const settings = await storage.getSettings()
    if (!settings.dazLibraryFolder) return total
    const scriptsRoot = storage.studioScriptsDir(settings.dazLibraryFolder)
    if (!(await exists(scriptsRoot))) return total
    // Folder key (lowercased sanitized project name) → the union of live
    // character dir names; null = a claiming project failed its gates.
    const liveByFolder = new Map<string, Set<string> | null>()
    for (const project of await projectsForSweep()) {
      const key = characterFolderName(project.name).toLowerCase()
      try {
        const root = charsRoot(project)
        // Completeness gate, same shape as the meta-dir GC's.
        await walkFilesStrict(root, '', (name) => name.startsWith('.'))
        const scan = await storage.scanCharacterLibrary(root)
        if (scan.problems.length > 0) throw new Error('incomplete scan')
        const live = liveByFolder.get(key)
        if (live === null) continue
        const names = live ?? new Set<string>()
        for (const entry of scan.entries) {
          names.add(characterFolderName(entry.character.name).toLowerCase())
        }
        liveByFolder.set(key, names)
      } catch {
        liveByFolder.set(key, null)
      }
    }
    const rootKey = scriptsRoot.replace(/\\/g, '/').toLowerCase()
    for (const projectEntry of await readDir(scriptsRoot)) {
      if (!projectEntry.isDirectory) continue
      const live = liveByFolder.get(projectEntry.name.toLowerCase())
      // undefined = unknown project dir, null = gates tripped — both untouched.
      if (live == null) continue
      const projDir = join(scriptsRoot, projectEntry.name)
      try {
        for (const child of await readDir(projDir)) {
          if (!child.isDirectory) continue
          if (live.has(child.name.toLowerCase())) continue
          const target = join(projDir, child.name)
          // Containment re-check, however the names composed.
          if (!target.replace(/\\/g, '/').toLowerCase().startsWith(`${rootKey}/`)) continue
          try {
            addResult(total, await removeDirCounted(target))
          } catch {
            // locked/unlistable candidate — left for the next sweep
          }
        }
      } catch {
        // unlistable project dir — nothing can be judged safely
      }
    }
  } catch {
    // no settings / unreadable scripts root — deleting nothing is the point
  }
  return total
}

/**
 * Age-out stale app-data scan files (not modified within their retention
 * windows) — the `product-scans` root and the `scan-frames` keyframe CSVs —
 * pruning folders they empty, plus the note-media sweep and the orphaned
 * character-meta/avatar/script-dir passes across all known projects. Runs on
 * app launch and from the "Clean up now" button. No-op in the plain web build
 * (no native layer).
 */
export async function housekeepingSweep(): Promise<HousekeepingResult> {
  if (!isTauri()) return { filesDeleted: 0, bytesFreed: 0 }
  const media = await sweepNoteMedia()
  const orphans = await sweepOrphanedCharacterData()
  const scriptOrphans = await sweepOrphanScriptDirs()
  const productScansDir = await storage.dataPath('product-scans')
  const scans = housekeepingResultSchema.parse(
    await invoke('housekeeping_sweep', {
      request: { productScansDir, maxAgeDays: PRODUCT_SCAN_RETENTION_DAYS },
    }),
  )
  // Same age-out for the Scan_Frames CSVs — the sweep command is generic over
  // its root, so it bounds this folder too.
  const frames = housekeepingResultSchema.parse(
    await invoke('housekeeping_sweep', {
      request: {
        productScansDir: await storage.scanFramesDir(),
        maxAgeDays: SCAN_FRAMES_RETENTION_DAYS,
      },
    }),
  )
  return {
    filesDeleted:
      scans.filesDeleted +
      frames.filesDeleted +
      media.filesDeleted +
      orphans.filesDeleted +
      scriptOrphans.filesDeleted,
    bytesFreed:
      scans.bytesFreed +
      frames.bytesFreed +
      media.bytesFreed +
      orphans.bytesFreed +
      scriptOrphans.bytesFreed,
    // Locked/readonly files past the cutoff that could NOT be deleted — summed
    // across both native sweeps so "0 files freed" is distinguishable from
    // "every delete failed" (the note-media and orphan GCs report no failures).
    filesFailed: (scans.filesFailed ?? 0) + (frames.filesFailed ?? 0),
  }
}

// --- Elevation ------------------------------------------------------------

/** Whether this window runs elevated (UAC). False in a browser / off Windows.
 *  Matters because Windows UIPI silently kills drag-and-drop from a
 *  normal-elevation Explorer into an elevated window — the UI warns off this. */
export async function isElevatedSession(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return z.boolean().parse(await invoke('elevated_session'))
  } catch {
    // Can't ask → assume not elevated, same call the native probe makes.
    return false
  }
}

/**
 * Restart the studio WITHOUT elevation (the native side hands the launch to
 * Explorer and exits this instance). Reopens the window's current project via
 * its `.dcsp` file association; a Home window relaunches bare.
 */
export async function relaunchDeelevated(): Promise<void> {
  // Not desktop.activeProjectFile — desktop.ts imports this api barrel, so the
  // window's project file is asked here directly (same command, primitive).
  const projectFile =
    z.string().nullable().parse(await invoke('active_project_file').catch(() => null)) ?? ''
  await invoke('relaunch_deelevated', { projectFile })
}

// --- Network drives -------------------------------------------------------

/** UNC a mapped network drive points to ("X:\…" → "\\host\share"), or '' when
 *  the path isn't on a (mapped) network drive / the native command is absent. */
export async function uncForPath(path: string): Promise<string> {
  try {
    // A primitive return — schema-parsed, not a bare invoke<T>() cast.
    return z.string().nullable().parse(await invoke('unc_for_path', { path })) ?? ''
  } catch {
    return ''
  }
}

/**
 * If `path` lives on a mapped network drive, remember that drive→UNC mapping so
 * it can be re-mapped later (e.g. after relaunching elevated). Fire-and-forget,
 * called as folders/files are picked; a no-op off Windows / in web-only mode.
 */
export async function rememberNetworkPath(path: string): Promise<void> {
  if (!path || path[1] !== ':') return
  const unc = await uncForPath(path)
  if (unc) await storage.rememberDrive(path.slice(0, 2), unc)
}

/** Re-map any known network drives that aren't currently available. Runs on
 *  startup; returns a per-drive report. No-op (empty) off Windows / web-only. */
export async function ensureNetworkDrives(): Promise<Array<RemapResult>> {
  try {
    const mappings = await storage.listKnownDrives()
    if (mappings.length === 0) return []
    // Parsed at the boundary (never a bare invoke<T>() cast) — the shape is
    // pinned by contracts/remap-results.json on both sides.
    return z.array(remapResultSchema).parse(await invoke('ensure_network_drives', { mappings }))
  } catch {
    return []
  }
}

export async function fetchKnownDrives(): Promise<Array<storage.KnownDrive>> {
  return storage.listKnownDrives()
}

export async function forgetNetworkDrive({ data }: { data: unknown }): Promise<void> {
  await storage.forgetDrive(z.object({ drive: z.string().min(1) }).parse(data).drive)
}
