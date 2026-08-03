import { mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { appLocalDataDir } from '@tauri-apps/api/path'
import { getVersion } from '@tauri-apps/api/app'

import { join } from './fs'
import { stripTrailingSeparators } from '#/lib/path.ts'

// The per-user app-local data dir (volatile / machine-specific state) and the
// studio's own version — shared plumbing for the other storage modules.

let dataDirPromise: Promise<string> | null = null
export async function dataDir(): Promise<string> {
  if (!dataDirPromise) {
    dataDirPromise = appLocalDataDir().then(stripTrailingSeparators)
  }
  return dataDirPromise
}

/** Resolve a path inside the per-user data directory. */
export async function dataPath(...parts: Array<string>): Promise<string> {
  return join(await dataDir(), ...parts)
}

/**
 * The FOLDER a character's product-scan CSVs are written into and read back from,
 * under app-local-data: `product-scans/<projectId>/<characterId>/`. Keyed by the
 * stable `.dcsp` manifest id + character UUID (not names), so it survives renames
 * and folder moves. The generated `Scan_Products_<Name>.dsa` writes one CSV per
 * Daz scene into here (named after the open scene); the character page reads every
 * CSV and merges them. Both sides MUST resolve it through here so they agree.
 */
export async function productScanDir(
  projectId: string,
  characterId: string,
): Promise<string> {
  return dataPath('product-scans', projectId, characterId)
}

/**
 * The FOLDER the installed `Scan_Frames.dsa` writes its keyframe-scan CSVs into
 * (one per Daz scene, named after it), under app-local-data: `scan-frames/`.
 * The script gets the path baked in at install time (copyRuntimeFiles); the
 * "Import from CSV" picker lists this folder. Both sides MUST resolve it
 * through here so they agree.
 */
export async function scanFramesDir(): Promise<string> {
  return dataPath('scan-frames')
}

let versionPromise: Promise<string> | null = null
/** The DTH Character Studio app version, cached; '' when unavailable (e.g. the
 *  web-only build with no native layer). Stamped onto saved characters and the
 *  generated Daz scripts for traceability. */
export async function studioVersion(): Promise<string> {
  if (!versionPromise) versionPromise = getVersion().catch(() => '')
  return versionPromise
}

/** Ensure the app-data folder exists (it holds settings.json and images/). */
export async function ensureAppDir(): Promise<void> {
  await mkdir(await dataDir(), { recursive: true })
}

/**
 * Which projects (by MANIFEST id, not folder path — the flag must survive a
 * project folder move) have already seen the first-Generate-project intro:
 * the dialog section explaining `$HIP` paths + the `dth-exports` junction and
 * asking how this project wants them. Machine-local on purpose (appdata):
 * the DECISIONS live in the `.dcsp`; only "was it explained here" is volatile.
 */
const HOUDINI_INTRO_FILE = 'houdini-intro.json'

export async function houdiniIntroShown(projectManifestId: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readTextFile(await dataPath(HOUDINI_INTRO_FILE))) as {
      shown?: Array<string>
    }
    return Array.isArray(raw.shown) && raw.shown.includes(projectManifestId)
  } catch {
    return false // missing/broken file = never shown
  }
}

export async function markHoudiniIntroShown(projectManifestId: string): Promise<void> {
  let shown: Array<string> = []
  try {
    const raw = JSON.parse(await readTextFile(await dataPath(HOUDINI_INTRO_FILE))) as {
      shown?: Array<string>
    }
    if (Array.isArray(raw.shown)) shown = raw.shown.filter((s) => typeof s === 'string')
  } catch {
    // fresh file
  }
  if (!shown.includes(projectManifestId)) shown.push(projectManifestId)
  await writeTextFile(await dataPath(HOUDINI_INTRO_FILE), JSON.stringify({ shown }, null, 2))
}
