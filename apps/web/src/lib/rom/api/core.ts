import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'

// Shared plumbing for the api/ modules: path helpers, the per-window active
// project state, project→record resolution, the shared zod input schemas, and
// the session-lived pose-asset catalog. All module-level mutable state lives
// HERE (and only here) so the split modules stay stateless.

export function joinPath(...parts: Array<string>): string {
  return parts
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

export function basename(p: string): string {
  return p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? p
}

/** Everything but the last path segment ('/'-joined). */
export function dirname(p: string): string {
  const norm = p.replace(/[\\/]+$/g, '')
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return idx >= 0 ? norm.slice(0, idx).replace(/\\/g, '/') : norm
}

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

/**
 * The projects a cross-project sweep — Refresh assets and version detection —
 * acts on: **every known project, in every window**. Known = the recents list
 * (there's no global registry; recents is the set of projects the app knows
 * about), unioned with this window's active project in case it hasn't reached
 * recents yet. A refresh from a project window used to scope to that project
 * only, which made the same button mean different things in different windows —
 * now it always brings the whole library up to date. Entries dedupe by
 * normalised folder path; unreachable folders (a moved/deleted project, an
 * unreadable `.dcsp`) are skipped — they simply contribute nothing to the sweep.
 */
export async function projectsForSweep(): Promise<Array<ProjectInfo>> {
  const recents = await storage.listRecents()
  const dirs = new Set(recents.map((r) => joinPath(dirname(r.path))))
  const activeDir = await getActiveProjectDir()
  if (activeDir) dirs.add(joinPath(activeDir))
  const projects: Array<ProjectInfo> = []
  for (const dir of dirs) {
    try {
      projects.push(await resolveProject(dir))
    } catch {
      // a moved/deleted recent — skip it
    }
  }
  return projects
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

/** The DTH pose presets for the active release — scanned once, then kept in
 *  memory for the session. */
export async function fetchPoseAssets(): Promise<PoseAssets> {
  if (poseAssets) return poseAssets
  const result = await storage.scanPoseAssets()
  if (!result.error) poseAssets = result
  return result
}

/** Re-scan the active release now and refresh the in-memory catalog — call after
 *  the release selection changes or its content is installed/updated. */
export async function rescanPoseAssets(): Promise<PoseAssets> {
  const result = await storage.scanPoseAssets()
  poseAssets = result.error ? null : result
  return result
}
