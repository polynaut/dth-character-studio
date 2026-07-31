import { z } from 'zod'

import { sceneExportName, sceneExportSubfolders } from '@dth/rom'

import { sceneExportFolderRel } from './execute-jobs.ts'

import type { Character } from '@dth/rom'

/**
 * The Houdini export handoff — the studio's second job-file contract, and a
 * deliberate mirror of the Daz one ({@link ExporterJobFile} in execute-jobs.ts):
 * the studio writes a JSON job, the other side works through it and writes
 * results back, the studio polls. Same shape, same failure story, so there is
 * one handoff pattern in this codebase rather than two.
 *
 * Houdini's half is `houdini-runtime/456.py`, which Houdini runs after a scene
 * loads when the studio's scripts folder is on HOUDINI_SCRIPT_PATH. The job path
 * travels in the `DTH_HOUDINI_JOB` environment variable, set only on the process
 * the studio spawns.
 */

/** Job + result file names, written into the character's folder beside the
 *  other dot-prefixed studio bookkeeping. */
export const HOUDINI_JOB_FILE = '.dth_houdini_job.json'
export const HOUDINI_RESULT_FILE = '.dth_houdini_result.json'

/** The env var 456.py reads the job path from ('' = do nothing at all). */
export const HOUDINI_JOB_ENV = 'DTH_HOUDINI_JOB'

export interface HoudiniJobScene {
  /**
   * Absolute path of the `.dth` this scene exported — the MATCH KEY. A
   * DazToHueImport node stores it in `import_character_dtu_file`, and since the
   * studio wrote that exact file, comparing paths identifies which network
   * belongs to which Daz scene. A name match would break the moment the user
   * renames a network; this doesn't.
   */
  dth: string
  /** The scene's display label, echoed back in the result for the report. */
  label: string
}

export interface HoudiniJobFile {
  version: 1
  scenes: Array<HoudiniJobScene>
  /**
   * Fallback export directory for a node that has NONE set. Never overrides a
   * directory the user configured on the node — the Houdini project is theirs,
   * and its output location is a deliberate choice.
   */
  exportDirectory: string
  /** Where 456.py writes progress + results for the studio to poll. */
  resultPath: string
}

/** One export node's outcome, as 456.py reports it. */
export const houdiniNodeResultSchema = z.object({
  node: z.string(),
  type: z.string().default(''),
  scene: z.string().default(''),
  dth: z.string().default(''),
  status: z.enum(['ok', 'skipped', 'failed']),
  /** What the HDA's own pre-flight check reported. The studio answers its
   *  "Continue anyway?" with Yes, so these must surface in the report or they
   *  would simply vanish. */
  problems: z.array(z.string()).default([]),
  error: z.string().default(''),
  seconds: z.number().default(0),
})
export type HoudiniNodeResult = z.infer<typeof houdiniNodeResultSchema>

/** Tolerant: the file is read WHILE it's being written to, so every field
 *  carries a default and an unknown extra is ignored rather than fatal. */
export const houdiniResultSchema = z.object({
  version: z.number().default(1),
  state: z.enum(['running', 'done', 'failed']).default('running'),
  total: z.number().default(0),
  done: z.number().default(0),
  nodes: z.array(houdiniNodeResultSchema).default([]),
  error: z.string().default(''),
})
export type HoudiniResult = z.infer<typeof houdiniResultSchema>

/** Parse a result file, tolerating a torn read (returns null — the caller polls
 *  again rather than treating one bad read as a failed run). */
export function parseHoudiniResult(text: string): HoudiniResult | null {
  try {
    return houdiniResultSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * The absolute `.dth` path a linked scene exports to — the SAME rule the export
 * watch uses for its expected files: `<exportPath>/<scene folder>/<name>.dth`,
 * where the name is {@link sceneExportName} (the primary scene keeps the bare
 * character name; extras carry their subfolder). Returns '' when the character
 * has no export directory.
 */
export function sceneDthPath(
  character: Character,
  sceneKey: string,
  scenesRootAbs?: string,
): string {
  const root = character.exportPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return ''
  const folders = sceneExportFolderRel(character, scenesRootAbs)
  const entry = folders[sceneKey]
  if (!entry) return ''
  const subfolders = sceneExportSubfolders(character, scenesRootAbs)
  const stem = (sceneKey.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  const name = sceneExportName(character, sceneKey, subfolders[sceneKey] ?? stem)
  return [root, entry.folder, `${name}.dth`].filter(Boolean).join('/')
}

/**
 * Build the job for a set of SELECTED scenes. Only scenes that resolve to a
 * `.dth` path are included — a scene with no export path has nothing for a
 * Houdini network to have imported, so there is nothing to match it against.
 */
export function buildHoudiniJob(
  character: Character,
  sceneKeys: ReadonlyArray<string>,
  options: { resultPath: string; exportDirectory?: string; scenesRootAbs?: string },
): HoudiniJobFile {
  // Scene KEYS are normalized (lowercased) for matching, so a label taken from
  // one would read "kirasummertide". Recover the original spelling from the
  // character's own linked paths.
  const original = new Map<string, string>()
  for (const scene of [character.scenePath, ...character.extraScenes]) {
    const path = scene.trim().replace(/\\/g, '/')
    if (path) original.set(path.toLowerCase(), path)
  }
  const scenes: Array<HoudiniJobScene> = []
  const seen = new Set<string>()
  for (const key of sceneKeys) {
    const dth = sceneDthPath(character, key, options.scenesRootAbs)
    if (!dth) continue
    const lower = dth.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    const source = original.get(key) ?? key
    scenes.push({ dth, label: (source.split('/').pop() ?? '').replace(/\.[^.]+$/, '') || key })
  }
  return {
    version: 1,
    scenes,
    exportDirectory: (options.exportDirectory ?? '').replace(/\\/g, '/'),
    resultPath: options.resultPath.replace(/\\/g, '/'),
  }
}

/** A finished run's one-line summary for the toast, e.g.
 *  "2 exported, 1 skipped". '' when nothing ran. */
export function houdiniResultSummary(result: HoudiniResult): string {
  const counts = { ok: 0, skipped: 0, failed: 0 }
  for (const node of result.nodes) counts[node.status] += 1
  const parts: Array<string> = []
  if (counts.ok) parts.push(`${counts.ok} exported`)
  if (counts.skipped) parts.push(`${counts.skipped} skipped`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  return parts.join(', ')
}
