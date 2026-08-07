import { configDir, publicDir } from '@tauri-apps/api/path'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'

import {
  EMPTY_DIM_PATHS,
  parseDimAccountIni,
  parseDimCurrentUser,
  parseDzInstallIni,
} from '#/lib/daz-install.ts'
import { detectDimManifestsFolder } from './products'
import { joinPath } from './core'

import type { DazAppFound, DazInstallScan } from '#/lib/daz-install.ts'

// Finding DIM's own settings — the I/O half of `lib/daz-install.ts`, which does
// the parsing. Nothing here searches the disk for DIM: its settings live at a
// FIXED `%APPDATA%/DAZ 3D` location whatever folder DIM itself was installed
// into, so the "where is DIM?" question never has to be asked.

/** `%APPDATA%` — Roaming, NOT the studio's own app-data folder. */
const DAZ_APPDATA = 'DAZ 3D'

/**
 * Everything DIM can tell us about this machine's Daz installation.
 *
 * Best-effort throughout: every file may be absent (no DIM, a fresh account, a
 * portable install), and each absence narrows the answer instead of failing it.
 * A machine with no DIM at all comes back `dimFound: false` with empty paths,
 * which the Settings UI shows as "nothing detected — set the paths yourself".
 */
export async function detectDazInstalls(): Promise<DazInstallScan> {
  const empty: DazInstallScan = {
    dimFound: false,
    apps: [],
    paths: EMPTY_DIM_PATHS,
    manifests: '',
    account: '',
  }
  if (!isTauri()) return empty

  let root = ''
  try {
    root = joinPath((await configDir()).replace(/\\/g, '/'), DAZ_APPDATA)
  } catch {
    return empty
  }

  const apps = await readApps(joinPath(root, 'dzInstall.ini'))
  const { account, paths } = await readAccount(joinPath(root, 'InstallManager'))
  const manifests = await resolveManifests(paths.manifests)

  return {
    // The apps file is the one that proves DIM has run here; an account file
    // can legitimately be missing (never signed in) while Studio is installed.
    dimFound: apps.length > 0 || account !== '' || paths.library !== '',
    apps,
    paths,
    manifests,
    account,
  }
}

/** The installed Daz applications, each checked against the disk. */
async function readApps(iniPath: string): Promise<Array<DazAppFound>> {
  const text = await readIfPresent(iniPath)
  if (text === '') return []
  const apps = parseDzInstallIni(text)
  // DIM's list is what it BELIEVES; the folder is what is there. A card for a
  // folder that has been deleted would activate paths that resolve to nothing,
  // so the difference is carried into the UI rather than flattened away.
  // Built field by field rather than spread-plus-one: the shape this returns is
  // then stated here, instead of being "whatever the parser produced, and also
  // `exists`" — which is also what keeps `oxc/no-map-spread` quiet.
  return Promise.all(
    apps.map(async (app) => ({
      key: app.key,
      name: app.name,
      version: app.version,
      bits: app.bits,
      path: app.path,
      exists: await pathExists(app.path),
    })),
  )
}

/** The current account's paths — `AppSettings.ini` names the file to read. */
async function readAccount(
  dir: string,
): Promise<{ account: string; paths: typeof EMPTY_DIM_PATHS }> {
  const settings = await readIfPresent(joinPath(dir, 'Settings/AppSettings.ini'))
  const account = settings === '' ? '' : parseDimCurrentUser(settings)
  if (account === '') return { account: '', paths: EMPTY_DIM_PATHS }
  // The file is named after the account TITLE, not "Account" — see
  // parseDimCurrentUser. A title with path separators is not a title we follow.
  if (/[\\/]/.test(account)) return { account: '', paths: EMPTY_DIM_PATHS }
  const text = await readIfPresent(joinPath(dir, `UserAccounts/${account}.ini`))
  return { account, paths: text === '' ? EMPTY_DIM_PATHS : parseDimAccountIni(text) }
}

/**
 * Where the DIM manifest database actually is.
 *
 * Three steps, most-authoritative first. `OverrideManifestDir` only exists once
 * the user has moved it, so its absence is the NORMAL case and means "the
 * default location" — which is under Public Documents. The old drive-letter
 * probe stays as the last resort: it is a guess, but a guess is still better
 * than an empty field for a layout neither of the first two steps describes.
 */
async function resolveManifests(override: string): Promise<string> {
  if (override !== '' && (await pathExists(override))) return override
  try {
    const fallback = joinPath(
      (await publicDir()).replace(/\\/g, '/'),
      'Documents/DAZ 3D/InstallManager/ManifestFiles',
    )
    if (await pathExists(fallback)) return fallback
  } catch {
    // no Public folder to ask about — fall through to the probe
  }
  return detectDimManifestsFolder()
}

/** File contents, or '' for anything unreadable — absence is a normal answer here. */
async function readIfPresent(path: string): Promise<string> {
  try {
    if (!(await exists(path))) return ''
    return await readTextFile(path)
  } catch {
    return ''
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return path !== '' && (await exists(path))
  } catch {
    return false
  }
}
