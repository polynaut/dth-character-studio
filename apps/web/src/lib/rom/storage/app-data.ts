import { mkdir } from '@tauri-apps/plugin-fs'
import { appLocalDataDir } from '@tauri-apps/api/path'
import { getVersion } from '@tauri-apps/api/app'

import { join } from './fs'

// The per-user app-local data dir (volatile / machine-specific state) and the
// studio's own version — shared plumbing for the other storage modules.

let dataDirPromise: Promise<string> | null = null
export async function dataDir(): Promise<string> {
  if (!dataDirPromise) {
    dataDirPromise = appLocalDataDir().then((d) => d.replace(/[\\/]+$/g, ''))
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
