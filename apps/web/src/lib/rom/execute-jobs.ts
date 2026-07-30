import {
  buildSceneCsvMap,
  characterScriptName,
  houdiniProjectResolution,
  poseAssetFileName,
  sceneExportSubfolders,
} from '@dth/rom'

import type { Character } from '@dth/rom'

/**
 * The DTH Exporter job file — the handoff between the studio's Execute buttons
 * and the DTH Exporter Plugin. The studio writes a small CSV of
 * (daz-scene-path, daz-script-path) rows into the shared
 * `Scripts/DTH-Character-Studio/` root of the Daz library, starting Daz Studio
 * (scene-less) when it isn't running. The plugin POLLS for the file — on
 * startup and regularly while Daz runs, so a running instance accepts new
 * batches — parses it, DELETES it (the delete is the "transfer succeeded"
 * ack), and works through the rows: open scene → run script → discard
 * changes → next. Contract spec: docs/exporter-plugin-job-file.md.
 *
 * This module is the pure part (names, CSV text, change signatures) so it stays
 * unit-testable; the I/O lives in api/execute.ts.
 */

/** Job-file name inside `Scripts/DTH-Character-Studio/` (the studio scripts root). */
export const EXPORTER_JOB_FILE = 'dth_exporter_jobs.csv'

/** The job file's fixed header row — two columns, in this order. */
export const EXPORTER_JOB_HEADER = 'daz-scene-path,daz-script-path'

/** Per-character stamp file (character folder, dot-prefixed like the run log):
 *  what Execute last handed off per scene, so Execute all can skip unchanged
 *  scenes. Machine-friendly bookkeeping, not user content. */
export const EXECUTE_STAMPS_FILE = '.dth_execute_stamps.json'

export interface ExporterJob {
  /** Absolute path of the Daz scene (`.duf`) to open. */
  scenePath: string
  /** Absolute path of the `.dsa` script to run in that scene. */
  scriptPath: string
}

/** What a scene looked like when its jobs were last written: the `.duf` stamp
 *  plus the definition signature ({@link executeSceneSignature}). */
export interface ExecuteStamp {
  mtimeMs: number
  size: number
  signature: string
}

export interface ExecuteStamps {
  version: 1
  /** Keyed by {@link normalizeSceneKey} of the scene path. */
  scenes: Record<string, ExecuteStamp>
}

/** The one scene-path normalization (trim, '/'-separators, lowercase) — the same
 *  convention generation and the runtime scene lookup key scenes by. */
export function normalizeSceneKey(scenePath: string): string {
  return scenePath.trim().replace(/\\/g, '/').toLowerCase()
}

/** Quote a CSV field per RFC 4180 — only when it needs it (comma, quote, newline). */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The job file's full text: header + one row per job, LF line endings, trailing
 * newline. Paths are written as-is (absolute, Windows separators allowed) —
 * quoting only kicks in for the rare comma/quote in a path.
 */
export function jobFileCsv(jobs: Array<ExporterJob>): string {
  return [
    EXPORTER_JOB_HEADER,
    ...jobs.map((job) => `${csvField(job.scenePath)},${csvField(job.scriptPath)}`),
  ].join('\n') + '\n'
}

/**
 * The generated script(s) a scene must run, in run order — always just the ONE
 * ROM script: it selects the open scene's overrides itself, and the plugin
 * executes it with the "bulk-export" argument (runtime v38), which makes it
 * ALWAYS build AND export — the export/hair toggles (`exportWithRomScript`,
 * `exportHairAssets`) only govern manual runs. Kept as an array for forward
 * compatibility (a future job kind may need multiple rows per scene).
 */
export function characterJobScriptNames(character: Character): Array<string> {
  return [`ROM_${characterScriptName(character)}.dsa`]
}

/**
 * Scene key → the export-dir-RELATIVE path of the PoseAsset CSV a bulk run
 * delivers for that scene: `<scene's export subfolder>/<csv name>` — prefixed
 * with `<houdini project folder>/dth-export/` when one resolves for the scene
 * (schema v27) — from the SAME subfolder map + project resolution + scene-CSV
 * lookup the generated export block embeds (subfolder falls back to the
 * scene-file stem exactly like the runtime; the project override map uses
 * hasOwn because '' is a real override meaning "flat"). The studio's export
 * watch stats these files — a CSV whose mtime is newer than the handoff time
 * means that scene finished exporting.
 */
export function expectedSceneCsvRel(
  character: Character,
  scenesRootAbs?: string,
): Record<string, string> {
  const subfolders = sceneExportSubfolders(character, scenesRootAbs)
  const project = houdiniProjectResolution(character)
  const sceneCsvs = buildSceneCsvMap(character)
  const baseCsv = poseAssetFileName(character)
  const map: Record<string, string> = {}
  for (const scene of [character.scenePath, ...character.extraScenes]) {
    const key = normalizeSceneKey(scene)
    if (!key) continue
    const stem = (key.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
    const sub = subfolders[key] ?? stem
    const name = sceneCsvs[key] ?? baseCsv
    const proj = Object.hasOwn(project.byScene, key) ? project.byScene[key] : project.base
    const rel = sub ? `${sub}/${name}` : name
    map[key] = proj ? `${proj}/dth-export/${rel}` : rel
  }
  return map
}

/** Character fields that don't influence what a ROM run produces (cosmetic,
 *  provenance, scan data, Houdini-side links) — changes here must not re-flag
 *  scenes as affected. `sceneOverrides` is excluded because it's folded in
 *  per scene by {@link executeSceneSignature}. */
const SIGNATURE_EXCLUDED_FIELDS = new Set<string>([
  'image',
  'imageScene',
  'createdAt',
  'updatedAt',
  'studioVersion',
  'generatedDthVersion',
  'products',
  'productsUnmatched',
  'productsScannedAt',
  'schemaVersion',
  'houdiniProjects',
  'sceneOverrides',
])

/** JSON.stringify with recursively sorted object keys, so the same data always
 *  yields the same text regardless of property insertion order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** FNV-1a over `text`, twice with different offset bases, hex-joined — a cheap
 *  64-bit-ish content fingerprint (no crypto needed; a collision merely skips
 *  one re-run, and Ctrl+Execute-all forces past it). */
function fnvHash(text: string): string {
  const pass = (offset: number) => {
    let hash = offset >>> 0
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }
  return pass(0x811c9dc5) + pass(0x9dc5811c)
}

/**
 * The change signature of ONE scene's effective inputs: the base definition
 * (minus the excluded fields) PLUS that scene's own override record (or null).
 * The base rides along for EVERY scene — non-primary scenes inherit it, so a
 * base edit changes their output too, and they must re-flag as affected. The
 * `.duf` file itself is tracked separately (mtime+size in {@link ExecuteStamp}).
 */
export function executeSceneSignature(character: Character, scenePath: string): string {
  const base: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(character)) {
    if (!SIGNATURE_EXCLUDED_FIELDS.has(key)) base[key] = value
  }
  const key = normalizeSceneKey(scenePath)
  const record =
    character.sceneOverrides.find((o) => normalizeSceneKey(o.scenePath) === key) ?? null
  return fnvHash(canonicalJson({ base, record }))
}

/**
 * Parse a job file back into its rows — the studio's own reader, used by Abort
 * to learn which scenes a pending (deleted) handoff carried so their stamps can
 * roll back. RFC-4180 tolerant like the contract asks of the plugin: quoted
 * fields, LF or CRLF, extra columns ignored, the header row skipped.
 */
export function parseJobFileCsv(text: string): Array<ExporterJob> {
  const rows: Array<Array<string>> = []
  let field = ''
  let row: Array<string> = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
    .slice(1) // the fixed header row
    .filter((r) => r.length >= 2 && r[0].trim() !== '')
    .map((r) => ({ scenePath: r[0], scriptPath: r[1] }))
}

/** Parse a stored stamps file, tolerating garbage (a bad file = no stamps = the
 *  first-run "everything is affected" behaviour). */
export function parseExecuteStamps(text: string): ExecuteStamps {
  try {
    const raw = JSON.parse(text) as Partial<ExecuteStamps> | null
    if (raw && raw.version === 1 && raw.scenes && typeof raw.scenes === 'object') {
      const scenes: Record<string, ExecuteStamp> = {}
      for (const [key, stamp] of Object.entries(raw.scenes)) {
        if (
          stamp &&
          typeof stamp.mtimeMs === 'number' &&
          typeof stamp.size === 'number' &&
          typeof stamp.signature === 'string'
        ) {
          scenes[key] = { mtimeMs: stamp.mtimeMs, size: stamp.size, signature: stamp.signature }
        }
      }
      return { version: 1, scenes }
    }
  } catch {
    // fall through — treat as empty
  }
  return { version: 1, scenes: {} }
}
