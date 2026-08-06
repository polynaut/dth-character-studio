import { exists, mkdir, readDir, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { houdiniVersionFromInstall, matchingHoudiniDocsFolder } from '#/lib/houdini-version.ts'
import { HOUDINI_SCRIPTS_FOLDER } from '../houdini-jobs'
import { materialUtilReportSchema } from './native-types.ts'
import type { MaterialScanProject, MaterialUtilReport } from './native-types.ts'
import { joinPath } from './core'
// The hython half, bundled as source and rewritten before every run (same
// self-repairing rule as 456.py: small, must track the app version, and needs
// no install ritual).
import materialUtilsScript from '../houdini-runtime/material_utils.py?raw'

// DazToHue material utilities — the studio half of the "Utils" panel.
//
// Reading what a DazToHueMaterial node holds requires `hou`, so the work runs
// under hython (`houdini-runtime/material_utils.py`); this module resolves the
// paths, writes the request, and parses the report — the usual split (resolve in
// TS, heavy work outside).
//
// Two measured facts the UI depends on, verified against DazToHue 2.5 rather
// than assumed (details in the Python's header):
//   * the node's multiparms are 0-BASED, and
//   * bakers reference their material and groups BY NAME, so a copy into a node
//     without those names imports cleanly and then bakes nothing.
// The second is why every transfer reports `missingMaterials` and why the dry
// run exists at all.

/**
 * The material-utility request/result files live beside `456.py` in app-data,
 * and every run gets its OWN pair.
 *
 * Fixed names looked tidier and were a race: two runs overlap easily (React
 * StrictMode double-fires the panel's scan effect in dev, and Rescan can be
 * clicked while a scan is in flight), and then the first run's cleanup deletes
 * the result the second run's hython had just written — which surfaces as the
 * baffling "hython wrote no result (exited with exit code: 0)", a process that
 * did everything right and left nothing behind.
 */
function runFiles(): { requestPath: string; resultPath: string; id: string } {
  const id = crypto.randomUUID()
  return {
    id,
    requestPath: `material-util-${id}-request.json`,
    resultPath: `material-util-${id}-report.json`,
  }
}

const nodeRef = z.object({
  hipPath: z.string().min(1),
  nodePath: z.string().min(1),
})

const scanInput = z.object({
  /** The `.hip`/`.hiplc` files to scan (deduped by the caller). */
  hipPaths: z.array(z.string().min(1)),
})

/**
 * The three transferable parts of a material setup.
 *
 * They are one setup, not three independent ones: a baker names its material
 * (`MI_Skin`) and its layers name UV channels (`uv_original`, `uv_geoshell`) as
 * plain text, so bakers copied without the slots that define those names — and
 * the UV channels that create them — import cleanly and bake nothing.
 */
export const MATERIAL_SECTIONS = ['materials', 'uvChannels', 'bakers'] as const
export type MaterialSection = (typeof MATERIAL_SECTIONS)[number]

const transferInput = z.object({
  source: nodeRef,
  /** One or more target nodes; several may live in the same project. */
  targets: z.array(nodeRef).min(1),
  /** Which parts of the setup to copy — at least one. */
  sections: z.array(z.enum(MATERIAL_SECTIONS)).min(1),
  /** Restrict the material slots (and the bakers naming them) to these slot
   *  names. Empty = every material. This is the selection that matters in
   *  practice: a user reuses "the same skin" or "that one dress", not a whole
   *  node — and skin slots merge identically across a Daz generation, while
   *  clothing only matches when the same asset is worn. */
  materials: z.array(z.string()).default([]),
  /** true = the selected sections are wiped at the target first; false =
   *  append (material slots merge by name rather than duplicating). */
  replace: z.boolean(),
  /** true = report what WOULD happen and write nothing. */
  dryRun: z.boolean(),
})

/**
 * Resolve hython + the version-matched Houdini prefs folder.
 *
 * A near-twin of the resolution in `api/houdini.ts` (Generate project / Export
 * too). Deliberately NOT shared with them here: those two sit on the shipped
 * generate and export paths, and this feature is not a reason to touch either.
 * Matching prefs are mandatory for the same measured reason — hython inherits
 * the studio's environment, and resolving another version's (or no) prefs means
 * the DazToHue otls never load, so every DazToHueMaterial node would come back
 * as an unknown type and a scan would report an empty project.
 */
async function resolveHython(): Promise<{ hythonPath: string; houdiniPrefDir: string }> {
  const settings = await storage.getSettings()
  const installDir = settings.houdiniInstallFolder.trim()
  if (!installDir) {
    throw new Error(
      'Set the Houdini installation folder in Settings first — the material utilities run hython.',
    )
  }
  const hythonPath = joinPath(installDir.replace(/\\/g, '/'), 'bin/hython.exe')
  if (!(await exists(hythonPath))) {
    throw new Error(
      `hython was not found:\n${hythonPath}\nCheck the Houdini installation folder in Settings.`,
    )
  }
  const houdiniPrefDir = matchingHoudiniDocsFolder(installDir, [
    settings.houdiniDocsFolder,
    ...settings.extraHoudiniDocsFolders,
  ])
  if (!houdiniPrefDir) {
    const version = houdiniVersionFromInstall(installDir)
    throw new Error(
      version
        ? `The Houdini installation (${version}) has no matching documents folder — add "…\\Documents\\houdini${version}" as a Houdini documents folder in Settings.`
        : `Could not read a Houdini version from the installation folder:\n${installDir}\nPoint it at a versioned install (e.g. "…\\Houdini 22.0.368").`,
    )
  }
  return { hythonPath, houdiniPrefDir }
}

/** Write the script + request into app-data and run one operation. */
async function runMaterialUtil(request: unknown): Promise<MaterialUtilReport> {
  const { hythonPath, houdiniPrefDir } = await resolveHython()
  const dir = await storage.dataPath(HOUDINI_SCRIPTS_FOLDER)
  await mkdir(dir, { recursive: true })
  const scriptPath = joinPath(dir, 'material_utils.py')
  const files = runFiles()
  const requestPath = joinPath(dir, files.requestPath)
  const resultPath = joinPath(dir, files.resultPath)
  await storage.writeTextFileAtomic(scriptPath, materialUtilsScript)
  await storage.writeTextFileAtomic(requestPath, JSON.stringify(request, null, 2))

  await sweepStaleRunFiles(dir)

  try {
    // Never a bare invoke<T>() cast — the report crosses Python → serde → here,
    // and the shared fixture (contracts/material-util-report.json) pins all three.
    const report = materialUtilReportSchema.parse(
      await invoke('run_houdini_material_util', {
        request: { hythonPath, scriptPath, requestPath, resultPath, houdiniPrefDir },
      }),
    )
    if (!report.ok) throw new Error(report.error || 'The material utility failed.')
    return report
  } finally {
    // In a `finally`, not on the success path: a failed run's files are exactly
    // the ones nobody will ever look at again, and per-run names mean a leak
    // here accumulates instead of being overwritten.
    await Promise.all(
      [requestPath, resultPath].map(async (path) => {
        try {
          if (await exists(path)) await remove(path)
        } catch {
          // locked — the age sweep above collects it on a later run
        }
      }),
    )
  }
}

/**
 * Drop material-utility run files left behind by a crash.
 *
 * ONLY files older than {@link STALE_RUN_MS}: a run still in flight owns files
 * that are seconds old, and deleting those would recreate the very race the
 * per-run names removed. An app-generated file that nothing collects is how a
 * disk fills, so this is the bound.
 */
const STALE_RUN_MS = 60 * 60 * 1000

async function sweepStaleRunFiles(dir: string): Promise<void> {
  try {
    const entries = await readDir(dir)
    const cutoff = Date.now() - STALE_RUN_MS
    await Promise.all(
      entries
        .filter((entry) => entry.isFile && /^material-util-.*\.json$/.test(entry.name))
        .map(async (entry) => {
          const path = joinPath(dir, entry.name)
          try {
            const info = await stat(path)
            const changed = info.mtime?.getTime() ?? info.birthtime?.getTime() ?? 0
            if (changed && changed < cutoff) await remove(path)
          } catch {
            // vanished or locked — nothing to do
          }
        }),
    )
  } catch {
    // the folder may not exist yet on a first run
  }
}

/**
 * Every DazToHueMaterial node in the given projects.
 *
 * One hython process opens the files in turn — starting it costs far more than
 * a single extra `.hip`, so the panel scans in batches rather than per project.
 * An unreadable project comes back as `ok: false` with its reason instead of
 * failing the whole scan.
 */
export async function scanHoudiniMaterials({
  data,
}: {
  data: unknown
}): Promise<Array<MaterialScanProject>> {
  const { hipPaths } = scanInput.parse(data)
  if (hipPaths.length === 0) return []
  if (!isTauri()) {
    throw new Error('Scanning Houdini projects needs the desktop app (it runs hython).')
  }
  // Identical scans already in flight are SHARED rather than started again: a
  // scan costs a whole hython start plus seconds per `.hip`, and the panel can
  // easily ask twice (React StrictMode double-fires its effect in dev, and
  // Rescan is clickable while one is running). Deliberately scans only —
  // a transfer is not idempotent and must never be coalesced.
  const key = JSON.stringify(hipPaths)
  const running = inFlightScans.get(key)
  if (running) return running
  const pending = runMaterialUtil({ op: 'scan', hipPaths })
    .then((report) => report.projects)
    .finally(() => {
      inFlightScans.delete(key)
    })
  inFlightScans.set(key, pending)
  return pending
}

/** Scans in flight, keyed by their file list — see {@link scanHoudiniMaterials}. */
const inFlightScans = new Map<string, Promise<Array<MaterialScanProject>>>()

/**
 * Whether two node references point at the SAME material node.
 *
 * Path comparison is case- and separator-insensitive (Windows): the target list
 * comes from a scan (whatever spelling Houdini reported) while the source may
 * have come from a file picker, so `D:\p\x.hiplc` and `d:/p/x.hiplc` are one
 * file. The node path itself is Houdini's own and compared exactly.
 */
export function isSameNode(
  a: { hipPath: string; nodePath: string },
  b: { hipPath: string; nodePath: string },
): boolean {
  const norm = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()
  return norm(a.hipPath) === norm(b.hipPath) && a.nodePath === b.nodePath
}

/**
 * Copy the source node's texture bakers onto the target nodes.
 *
 * `dryRun` changes nothing on disk and reports exactly what a real run would do
 * — including which materials each target is missing, which is the difference
 * between a copy that bakes and one that only looks copied.
 *
 * A real run saves each touched project ONCE, after taking a single rolling
 * backup into Houdini's own `backup/` folder (`<name>_dthbak.hiplc`).
 */
export async function transferHoudiniMaterials({
  data,
}: {
  data: unknown
}): Promise<MaterialUtilReport> {
  const input = transferInput.parse(data)
  // Checked BEFORE the host check so the refusal is testable (and so a browser
  // build reports the real mistake rather than "needs the desktop app").
  // A target that IS the source would be opened and saved by the same run —
  // append would double the node's own bakers, replace would be a no-op that
  // still rewrites the file.
  if (input.targets.some((t) => isSameNode(t, input.source))) {
    throw new Error('The source node is also a target — deselect it and run again.')
  }
  if (!isTauri()) {
    throw new Error('Transferring material setups needs the desktop app (it runs hython).')
  }
  return runMaterialUtil({ op: 'transfer', ...input })
}
