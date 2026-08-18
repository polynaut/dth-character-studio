import { z } from 'zod'

// Linear trims — `/\/+$/` is a high-severity CodeQL js/polynomial-redos alert
// (see path-trim.ts). This module stays otherwise pure; path-trim imports nothing.
import { stripTrailingSeparators } from '../path-trim'

/**
 * The **Import from Daz scene** handoff: what the studio writes so the job
 * runner can scan a scene's keyed ROM frames without anyone watching.
 *
 * Pure — the naming rule, the script text and the result shape — because all
 * three are a CONTRACT with `runtime/DthScanFrames.dsa`, which cannot be run
 * from a test. Both sides of each rule are stated here and mirrored there;
 * change one, change both (the repo rule for a decision living on two sides of
 * a boundary, `.ai/gotchas.md`).
 */

/**
 * File name of the per-run script, in the studio's scripts ROOT beside the
 * runtime it includes.
 *
 * Dot-prefixed like the runtime's own `.DthUtils.dsa`: it is machinery, not one
 * of the scripts the user is meant to find and run from Daz's content library.
 * ONE name, rewritten per run — a scan is never concurrent with another (the
 * single global job file already refuses that), so a per-run file name would
 * only leave litter nothing cleans up.
 */
export const SCAN_RUN_SCRIPT = '.dth_scan_run.dsa'

/**
 * The name the scan writes its output under, mirroring what the `.dsa` derives
 * from the OPEN scene (`Scene.getFilename()` → `completeBaseName()` → the same
 * character strip).
 *
 * Load-bearing for the RESULT file, which is named the same way and is what the
 * poll waits on: two scans of different scenes must not overwrite each other's
 * verdict, and a stale result must never read as this run's. The CSV path it
 * also predicts is a convenience — the poll imports the path the result file
 * reports, which is authoritative even if this guess were wrong.
 *
 * `completeBaseName()` drops only the LAST extension — `Kira.G9.duf` is
 * `Kira.G9` — which is why this splits on the final dot rather than the first.
 */
export function scanCsvName(scenePath: string): string {
  const file = scenePath.trim().replace(/\\/g, '/').split('/').pop() ?? ''
  const stem = file.replace(/\.[^.]*$/, '')
  // The exact class DthScanFrames strips: the characters Windows forbids in a
  // file name. Kept character-for-character in step with the `.dsa`.
  return stem.replace(/[\\/:*?"<>|]/g, '_')
}

/** Absolute path of that CSV inside the scan-output folder. */
export function scanCsvPath(outDir: string, scenePath: string): string {
  return `${outDir.replace(/[\\/]+$/, '')}/${scanCsvName(scenePath)}.csv`
}

/**
 * Where the silent run reports what happened.
 *
 * A sibling of the CSV rather than one shared file: two scans of different
 * scenes must not overwrite each other's verdict, and the name is derived the
 * same way so a stale result can never be read as this run's.
 */
export function scanResultPath(outDir: string, scenePath: string): string {
  return `${outDir.replace(/[\\/]+$/, '')}/${scanCsvName(scenePath)}.scan.json`
}

/** What `dthWriteScanResult` writes. Tolerant on read: the studio polls WHILE
 *  Daz may still be writing, so a torn or partial file must read as "not ready
 *  yet", never as a failure (see {@link parseScanResult}). */
export const scanResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().default(''),
  csvPath: z.string().default(''),
  frames: z.number().default(0),
})

export type ScanResult = z.infer<typeof scanResultSchema>

/** Parse a result file, or null for anything not yet a whole one — the poll
 *  then simply asks again rather than reporting a failure that did not happen. */
export function parseScanResult(text: string): ScanResult | null {
  try {
    return scanResultSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

/** A Daz Script string literal: backslashes and quotes escaped. Paths are the
 *  only interpolation here and they are full of both. */
function dsaString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The one-run script handed to the job runner.
 *
 * Written INTO the studio's scripts folder in the Daz library (`runtimeRoot`),
 * beside the `.DthUtils.dsa` / `.DthScanFrames.dsa` it includes.
 *
 * It may NOT find them via `getScriptFileName()` alone, the way a shelf script
 * does: this script is a Runner batch row, and on the first row of a batch in a
 * cold-started Daz that call answers with a Daz-internal path (measured
 * 2026-08-18 — see `runtimeDirSnippet` in @dth/rom's `dsa.ts`, which resolves
 * the same problem for the generated character scripts). So it probes its own
 * reported folder first and falls back to the root the studio baked in — which
 * it knows exactly, being the folder it is about to write this file into. The
 * self-report still comes first so an install the user relocated keeps using
 * the runtime sitting beside it.
 *
 * The `include()`s stay at the TOP level: Daz resolves them through its
 * legacy-include mechanism, which fails inside try/catch ("URIError: Legacy
 * Include"). That is why the resolver returns a DIRECTORY rather than wrapping
 * the includes.
 *
 * `silent` is what separates this from the shelf script: no MessageBox (a modal
 * would block the runner on a Daz nobody is looking at) and a result file
 * instead. `genesis` is how the run selects the figure by asset identity — the
 * studio has already checked the scene holds exactly one of that generation.
 */
export function scanRunScript(options: {
  outDir: string
  resultPath: string
  genesis: string
  /** Absolute path of the DTH-Character-Studio scripts root this file is
   *  written into — the include fallback. '' = no fallback. */
  runtimeRoot?: string
}): string {
  // Forward-slashed and trailing-slash-free: DzFile/DzDir want '/', and the
  // probe below concatenates rather than joins.
  const runtimeRoot = stripTrailingSeparators(options.runtimeRoot ?? '').replace(/\\/g, '/')
  return [
    '// DAZ Studio version 4.0.0+ filetype DAZ Script',
    '',
    '// DTH Character Studio - ONE headless frame scan, written per run by the',
    '// studio and executed by the Runner after it opens the scene. Not a shelf',
    '// script: it reports through a result file and opens no dialog.',
    '',
    '// Where the runtime lives. getScriptFileName() is checked but not trusted:',
    '// on the first row of a batch in a cold-started Daz it answers with a',
    '// Daz-internal path, so the studio bakes its own install root as a fallback.',
    'var dthSelfDir = String(new DzFileInfo(getScriptFileName()).path());',
    `var dthBakedRuntimeDir = ${dsaString(runtimeRoot)};`,
    'function dthResolveRuntimeDir() {',
    '\tif (dthSelfDir != "" && (new DzFile(dthSelfDir + "/.DthUtils.dsa")).exists()) return dthSelfDir;',
    '\tif (dthBakedRuntimeDir != "" && (new DzFile(dthBakedRuntimeDir + "/.DthUtils.dsa")).exists()) return dthBakedRuntimeDir;',
    '\t// Neither has it — return the self-report so the include fails naming the',
    '\t// normal location, and the Daz log shows where this script thought it was.',
    '\treturn dthSelfDir;',
    '}',
    'var dthRuntimeDir = dthResolveRuntimeDir();',
    'include(dthRuntimeDir + "/.DthUtils.dsa");',
    'include(dthRuntimeDir + "/.DthScanFrames.dsa");',
    '',
    'DthScanFrames({',
    `\toutDir: ${dsaString(options.outDir)},`,
    `\tresultPath: ${dsaString(options.resultPath)},`,
    `\tgenesis: ${dsaString(options.genesis)},`,
    '\tsilent: true',
    '});',
    '',
  ].join('\n')
}
