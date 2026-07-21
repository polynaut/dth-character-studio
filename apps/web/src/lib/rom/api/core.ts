import { invoke, isTauri } from '@tauri-apps/api/core'
import { exists } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import { normalizePathLower } from '#/lib/path.ts'
import * as storage from '../storage'
import { basename, dirname, join } from '../storage/fs'

// Type-only imports from the sibling modules that consume the session caches
// below — erased at compile time, so they can't create a runtime import cycle
// (characters.ts / products.ts import core.ts for real).
import type { MorphIndexEntry } from './characters'
import type { ProductScanResult } from './products'

// Shared plumbing for the api/ modules: path helpers, the per-window active
// project state, project→record resolution, the shared zod input schemas, and
// the session-lived pose-asset catalog + caches. All module-level mutable state
// lives HERE (and only here) so the split modules stay stateless.

// The path helpers are re-exports of the single implementation in storage/fs.ts
// (this module, storage, and lib/path.ts used to carry three drifting copies).
export { basename, dirname }
export const joinPath = join

// --- Active project (per window) ------------------------------------------
// A project is now identified by its FOLDER path (the dir holding the `.dcsp`),
// not a registry id. Routes still pass that path as `projectId` (one segment), so
// the character functions below are unchanged. `projectPath` is the identity; the
// `{ id, name, ... }` record is read from the folder's manifest on demand.

/** A project record assembled from a folder's `.dcsp` manifest. */
export interface ProjectInfo extends storage.Project {
  dazSubdir: string
  houdiniSubdir: string
  createHoudiniSubdir: boolean
  assetsEnabled: boolean
  dazProductsEnabled: boolean
  charactersSubdir: string
  /** Absolute paths of linked Unreal project files (.uproject). */
  unrealProjects: Array<string>
}

/** Resolve a project folder to its manifest-backed record. */
export async function resolveProject(projectDir: string): Promise<ProjectInfo> {
  const dir = joinPath(projectDir)
  const m = await storage.readManifest(dir)
  return {
    id: m.id,
    name: m.name,
    path: dir,
    dazSubdir: m.dazSubdir,
    houdiniSubdir: m.houdiniSubdir,
    createHoudiniSubdir: m.createHoudiniSubdir,
    assetsEnabled: m.assetsEnabled,
    dazProductsEnabled: m.dazProductsEnabled,
    charactersSubdir: m.charactersSubdir,
    unrealProjects: m.unrealProjects,
    ...(m.createdAt ? { createdAt: m.createdAt } : {}),
  }
}

/** A project folder param IS the library path now (normalised). */
export async function projectPath(projectDir: string): Promise<string> {
  return joinPath(projectDir)
}

/**
 * Where a project's character folders live: `<project>/<charactersSubdir>` (e.g.
 * `assets/characters`), or the project root when the subdir is empty (today's
 * default). The folder param/provenance stays the project root — only the storage
 * root for character folders shifts.
 */
export function charsRoot(project: ProjectInfo): string {
  return project.charactersSubdir ? joinPath(project.path, project.charactersSubdir) : project.path
}

/** Resolve a project id straight to its characters root (reads the manifest). */
export async function charactersRoot(projectId: string): Promise<string> {
  return charsRoot(await resolveProject(projectId))
}

// The active project folder for avatar resolution (resolveImageSrc) + writes,
// which have no projectId to thread. Set by the project routes' loaders; falls
// back to the per-window `.dcsp` from the native layer. '' = no project (Home).
let activeProjectDirValue = ''
export function setActiveProjectDir(dir: string): void {
  activeProjectDirValue = dir ? joinPath(dir) : ''
}
export async function getActiveProjectDir(): Promise<string> {
  if (!activeProjectDirValue && isTauri()) {
    try {
      const file = (await invoke<string | null>('active_project_file')) ?? ''
      if (file) activeProjectDirValue = dirname(file)
    } catch {
      // no native layer / Home window — stays '' until a project loader sets it
    }
  }
  return activeProjectDirValue
}

export interface SweepTargets {
  projects: Array<ProjectInfo>
  /** Known projects that could not be resolved this run — a moved/offline
   *  folder or an unreadable `.dcsp`. The Refresh sweep surfaces these; other
   *  consumers ({@link projectsForSweep}) skip them. */
  unreachable: Array<{ dir: string; error: string }>
}

/**
 * The projects a cross-project sweep — Refresh assets and version detection —
 * acts on: **every known project, in every window**. Known = the recents list
 * (there's no global registry; recents is the set of projects the app knows
 * about), unioned with this window's active project in case it hasn't reached
 * recents yet. A refresh from a project window used to scope to that project
 * only, which made the same button mean different things in different windows —
 * now it always brings the whole library up to date. Entries dedupe by
 * normalised folder path, CASE-INSENSITIVELY (Windows: the drive-letter-cased
 * path from the OS file association vs the picker path used to double-sweep a
 * project). Unresolvable folders are returned separately so the Refresh sweep
 * can report them instead of silently contributing nothing.
 */
export async function sweepTargets(): Promise<SweepTargets> {
  const dirs = new Map<string, string>() // normalized-lower key → first-seen original
  const add = (dir: string) => {
    const key = normalizePathLower(dir)
    if (key && !dirs.has(key)) dirs.set(key, dir)
  }
  for (const recent of await storage.listRecents()) add(joinPath(dirname(recent.path)))
  const activeDir = await getActiveProjectDir()
  if (activeDir) add(joinPath(activeDir))
  const projects: Array<ProjectInfo> = []
  const unreachable: Array<{ dir: string; error: string }> = []
  for (const dir of dirs.values()) {
    try {
      projects.push(await resolveProject(dir))
    } catch (e) {
      unreachable.push({ dir, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { projects, unreachable }
}

/** {@link sweepTargets} minus the unreachable report — for consumers where an
 *  unreachable project simply contributes nothing (detection, media GC, …). */
export async function projectsForSweep(): Promise<Array<ProjectInfo>> {
  return (await sweepTargets()).projects
}

// --- Shared input schemas ---------------------------------------------------

export const projectIdInput = z.object({ projectId: z.string().min(1) })

export const charScopeInput = z.object({ projectId: z.string().min(1), id: z.string().min(1) })

// --- Pose-asset catalog ------------------------------------------------------

// In-memory pose catalog for the app session. The active DTH release's Poses
// folder is scanned (natively, in Rust) on first use and re-scanned when the
// release selection changes — there's no on-disk cache to build, miss, or go
// stale. The scan is small and fast, so one session-lived value is plenty.
// Failed scans (no release / unreachable) are NOT memoized, so fixing Settings
// recovers on the next read without an explicit rescan.
export type PoseAssets = Awaited<ReturnType<typeof storage.scanPoseAssets>>
let poseAssets: PoseAssets | null = null
// The release-selection settings the cached catalog was scanned from — the
// cheap cross-window validity check for fetchPoseAssetsCurrent.
let poseAssetsFingerprint = ''

/** The release-selection fingerprint of the CURRENT settings on disk. */
async function activeReleaseFingerprint(): Promise<string> {
  const s = await storage.getSettings()
  return `${s.dthPosesFolder}|${s.currentDthVersion}`
}

/** The DTH pose presets for the active release — scanned once, then kept in
 *  memory for the session. */
export async function fetchPoseAssets(): Promise<PoseAssets> {
  if (poseAssets) return poseAssets
  return rescanPoseAssets()
}

/**
 * {@link fetchPoseAssets}, revalidated against the CURRENT settings on disk:
 * the catalog is per-window state, but settings.json is shared between windows —
 * window B changing the active DTH release must not leave window A generating
 * against the superseded catalog. One settings read (cheap) decides; only a
 * changed release-selection fingerprint triggers the re-scan. Use this at every
 * GENERATION entry point; the plain fetch stays fine for UI listing.
 */
export async function fetchPoseAssetsCurrent(): Promise<PoseAssets> {
  if (poseAssets && (await activeReleaseFingerprint()) === poseAssetsFingerprint) {
    return poseAssets
  }
  return rescanPoseAssets()
}

/** Re-scan the active release now and refresh the in-memory catalog — call after
 *  the release selection changes or its content is installed/updated. */
export async function rescanPoseAssets(): Promise<PoseAssets> {
  const fingerprint = await activeReleaseFingerprint()
  const result = await storage.scanPoseAssets()
  poseAssets = result.error ? null : result
  poseAssetsFingerprint = fingerprint
  return result
}

// --- Session caches ----------------------------------------------------------
// Plain Maps that skip the EXPENSIVE part of the hot loader paths (full library
// walks, re-parsing big JSON/CSV files) while staying honest: every consumer
// REVALIDATES cheaply before serving (a stat, an exists(), a dir listing), so
// external changes are still picked up on the very next navigation or window
// focus — nothing is served stale on trust. No TTLs, no library.

/** Parsed + deduped morph index per generation, keyed on the source
 *  `morphs_<G>.json`'s mtime+size — see {@link import('./characters').fetchMorphIndex}. */
export const morphIndexCache = new Map<
  string,
  { stamp: string; entries: Array<MorphIndexEntry> }
>()

/**
 * Where a character's definition lives, by `<charactersRoot>|<id>` — spares the
 * full library scan on every character read. A hit is verified with one
 * `exists()` before use; misses/stale entries fall back to the full scan and
 * repopulate. Mutations that move/remove files clear the whole map (it only
 * ever holds a handful of entries).
 */
export const characterLocationCache = new Map<string, storage.CharacterLocation>()

export function invalidateCharacterLocations(): void {
  characterLocationCache.clear()
}

/** Record a character's known location (same key format {@link locateCharacter}
 *  uses) — callers that just scanned/created can prime the cache so the next
 *  read skips the full library walk. */
export function cacheCharacterLocation(
  root: string,
  id: string,
  location: storage.CharacterLocation,
): void {
  characterLocationCache.set(`${root}|${id}`, location)
}

/**
 * Where a character lives, through the session location cache: a cache hit is
 * verified with a single `exists()` (so external deletes/renames are noticed);
 * a miss or stale entry falls back to the full library scan and repopulates.
 * Mutations (save/move/delete) also clear the cache outright — navigating right
 * after a rename re-scans instead of 404ing.
 */
export async function locateCharacter(
  root: string,
  id: string,
): Promise<storage.CharacterLocation | null> {
  const key = `${root}|${id}`
  const cached = characterLocationCache.get(key)
  if (cached) {
    try {
      if (await exists(cached.definitionAbs)) return cached
    } catch {
      // unverifiable (e.g. an unreachable share) — treat as stale
    }
    characterLocationCache.delete(key)
  }
  const location = await storage.getCharacterPath(root, id)
  if (location) characterLocationCache.set(key, location)
  return location
}

/** Merged product-scan result per scan dir, keyed on the dir's CSV listing
 *  (names + mtimes + sizes) — see {@link import('./products').fetchProductScan}. */
export const productScanCache = new Map<string, { signature: string; result: ProductScanResult }>()
