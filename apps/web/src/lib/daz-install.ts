/**
 * Reading what the DAZ Install Manager already knows.
 *
 * Every Daz path the studio needs — the content library, the Studio install
 * folder, the DIM manifest database — is something the user already told DIM.
 * Until v0.67 the studio asked for them again and, failing that, GUESSED: the
 * manifests probe walked `<A..Z>:/DAZ 3D/Install Manager/ManifestFiles` and
 * took the first hit. That finds the right folder by luck on a default layout
 * and silently finds nothing on any other.
 *
 * DIM writes three plain INI files under `%APPDATA%/DAZ 3D` (measured on
 * DIM 1.4.1.96), at a FIXED location that does not depend on where DIM itself
 * was installed — so there is nothing to search for:
 *
 *   dzInstall.ini                       the installed Daz apps + their folders
 *   InstallManager/Settings/AppSettings.ini   which account is current
 *   InstallManager/UserAccounts/<acct>.ini    every path in Advanced Settings
 *
 * This module is the PURE half: text in, typed paths out, no I/O — so the
 * parsing is unit-testable and the host half (`lib/rom/api/daz-install.ts`)
 * only has to find the files.
 *
 * ## The account file holds a credential
 *
 * `<acct>.ini` sits next to `RememberPassword=true` and contains an
 * `Account=<256 hex chars>` blob — the user's stored Daz credentials. Nothing
 * here is generic: {@link parseDimAccountIni} returns a fixed struct built from
 * a NAMED whitelist of keys, so a credential cannot reach a caller, a log, a
 * report or settings.json even by accident. Add a key to the whitelist
 * deliberately or not at all.
 */

/** One Daz application DIM has installed. */
export interface DazApp {
  /** DIM's own key (`dzStudio6InstallDir-64`) — the stable identity the studio
   *  stores as "which installation is active". Survives a path change. */
  key: string
  /** "DAZ Studio 6", for the card. */
  name: string
  /** Major Studio version: 6, 4, … — 0 when the key carries none. */
  version: number
  /** 64 or 32. The studio only ever wants the 64-bit one, but a 32-bit entry is
   *  reported rather than hidden, so "why is my install missing?" has an answer. */
  bits: number
  path: string
}

/** The paths one DIM account carries — the Advanced Settings dialog, as data. */
export interface DimAccountPaths {
  /** `CurInstallPath` — the library DIM installs content into RIGHT NOW, which
   *  is what "My DAZ 3D Library" means for everything the studio generates. */
  library: string
  /** Every configured content library (`[InstallPaths]`), in DIM's order.
   *  Usually one; a user with a split library has several, and `library` is
   *  whichever of them is currently selected. */
  libraries: Array<{ title: string; path: string }>
  /** `OverrideManifestDir` — EMPTY on a default install, where the manifests
   *  live under Public Documents instead. Absence is not failure. */
  manifests: string
  /** `DownloadPath` — where DIM parks the product `.zip`s it downloads. */
  downloads: string
  thumbnails: string
  /** `Software64Path` — the base DIM installs 64-bit applications under. */
  software64: string
}

/** A {@link DazApp} plus whether its folder is actually on disk. */
export interface DazAppFound extends DazApp {
  /** false = DIM still lists it but the folder is gone. Shown, never offered:
   *  activating it would derive paths that resolve to nothing. */
  exists: boolean
}

/** Everything DIM can tell us about this machine, as one answer. */
export interface DazInstallScan {
  /** false = no DIM settings found at all; the user sets paths by hand. */
  dimFound: boolean
  apps: Array<DazAppFound>
  paths: DimAccountPaths
  /** The manifest folder actually resolved — the override, the Public-Documents
   *  default, or the legacy drive probe (see `api/daz-install.ts`). */
  manifests: string
  /** Which DIM account these paths came from. Not shown — the name means
   *  nothing to the user — but it is what selected the INI they were read
   *  from, so it stays for diagnosis. */
  account: string
}

/**
 * The installation to offer on a fresh detection.
 *
 * Newest Studio first (so a DS4 + DS6 machine defaults to **6**), and only one
 * whose folder is actually there — DIM keeps listing an install it has already
 * removed, and activating that would fill every derived path with a folder that
 * does not exist. Nothing installed → null, and the UI says so.
 */
export function defaultDazApp(apps: ReadonlyArray<DazAppFound>): DazAppFound | null {
  return apps.find((app) => app.exists && app.bits === 64) ?? apps.find((app) => app.exists) ?? null
}

/** The studio settings an activated installation implies. */
/**
 * Which installations may be marked **Export only** — the older ones, and only
 * while the NEWEST is the one running everything else.
 *
 * The flag exists for one shape of machine: authoring has moved to the newest
 * Studio, but the export batch still has to run in an older one because the DTH
 * Runner plugin is built against a single Studio major (`.ai/gotchas.md`). So it
 * is offered only where it makes sense to answer:
 *
 *  - an install OLDER than the active one — marking the active install itself
 *    would mean "run exports where everything already runs", which is the
 *    default and not a choice;
 *  - and only while the active install IS the newest detected. Someone who has
 *    deliberately gone back to the old Studio for everything has already
 *    answered this question with the Activate button, and offering a switch
 *    that says "…but exports here" on the newer one would be a second, opposite
 *    knob for the same decision.
 *
 * An install whose folder is gone is never a candidate: exports would launch
 * nothing. Returns the eligible KEYS, in the order the apps were given.
 */
export function exportOnlyCandidateKeys(
  apps: ReadonlyArray<DazAppFound>,
  activeKey: string,
): Array<string> {
  const active = apps.find((app) => app.key === activeKey)
  if (!active) return []
  // "Newest detected" counts installs that are GONE too: a machine whose DS7
  // folder was deleted but still listed is not a machine that has settled on
  // DS6, and quietly offering the switch there would read as the studio
  // approving a layout it cannot see the whole of.
  const newest = apps.reduce((max, app) => Math.max(max, app.version), 0)
  if (active.version < newest) return []
  return apps
    .filter((app) => app.exists && app.version > 0 && app.version < active.version)
    .map((app) => app.key)
}

export interface DerivedDazPaths {
  dazInstallFolder: string
  dazLibraryFolder: string
  dimManifestsFolder: string
}

/**
 * What activating one card writes into settings.
 *
 * Only the three paths that genuinely FOLLOW from the installation. The DIM
 * download folder and the morph/preset staging folders are deliberately not
 * here: those are the user's own curation, and silently rewriting a list they
 * built is exactly the surprise this feature is supposed to remove.
 *
 * An unknown key derives nothing rather than falling back to "the first app" —
 * a stored key that no longer matches any install means the machine changed,
 * and the UI has to say so instead of quietly activating something else.
 */
export function deriveDazPaths(scan: DazInstallScan, appKey: string): DerivedDazPaths | null {
  const app = scan.apps.find((candidate) => candidate.key === appKey)
  if (!app) return null
  return {
    dazInstallFolder: app.path,
    dazLibraryFolder: scan.paths.library,
    dimManifestsFolder: scan.manifests,
  }
}

/** Nothing found, and the shape a caller can always rely on. */
export const EMPTY_DIM_PATHS: DimAccountPaths = {
  library: '',
  libraries: [],
  manifests: '',
  downloads: '',
  thumbnails: '',
  software64: '',
}

/**
 * A Qt-style INI as `section -> key -> value`.
 *
 * Section and key are lower-cased (Qt treats them case-insensitively and DIM's
 * own casing is not something to depend on); the VALUE is kept verbatim,
 * because it is a path. Only the first `=` splits, so a value may contain more.
 * A key before any section header lands in `''`.
 */
function parseIni(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  let section = ''
  out.set(section, new Map())
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim().toLowerCase()
      if (!out.has(section)) out.set(section, new Map())
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (key !== '') out.get(section)?.set(key, value)
  }
  return out
}

/** One value, '' when the section or key is absent. */
function get(ini: Map<string, Map<string, string>>, section: string, key: string): string {
  return ini.get(section.toLowerCase())?.get(key.toLowerCase()) ?? ''
}

/** `DAZ Studio 6` etc. from DIM's key — the only human-readable name available:
 *  `dzInstall.ini` carries no display names. */
function appName(version: number, bits: number): string {
  const base = version > 0 ? `DAZ Studio ${version}` : 'DAZ Studio'
  return bits === 32 ? `${base} (32-bit)` : base
}

/**
 * The Daz applications listed in `dzInstall.ini`.
 *
 * `InstalledApplications` (a space-separated key list) is the source of truth
 * for what is INSTALLED; `[ApplicationPath]` holds where. An entry that keeps a
 * path but has dropped off the installed list is an uninstall DIM has not
 * tidied, so it is skipped — offering it would activate a folder that is gone.
 * A file with no `InstalledApplications` at all falls back to every path entry,
 * since reporting nothing would be worse than reporting a stale one.
 *
 * Sorted newest-Studio first, so a DS4+DS6 machine offers DS6 as the default.
 */
export function parseDzInstallIni(text: string): Array<DazApp> {
  const ini = parseIni(text)
  const paths = ini.get('applicationpath') ?? new Map<string, string>()
  const listed = get(ini, 'General', 'InstalledApplications')
    .split(/\s+/)
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean)
  const allow = listed.length > 0 ? new Set(listed) : null

  const apps: Array<DazApp> = []
  for (const [key, path] of paths) {
    if (allow && !allow.has(key)) continue
    if (path.trim() === '') continue
    // `dzStudio6InstallDir-64` — anything else is an app the studio has no
    // opinion about, and inventing a name for it would be a guess.
    const match = /^dzstudio(\d+)installdir-(\d+)$/.exec(key)
    if (!match) continue
    const version = Number(match[1])
    const bits = Number(match[2])
    apps.push({ key, name: appName(version, bits), version, bits, path: path.trim() })
  }
  // Newest first, 64-bit ahead of 32-bit at the same version.
  apps.sort((a, b) => b.version - a.version || b.bits - a.bits)
  return apps
}

/** The account whose settings are live (`CurrentUser`), '' when unreadable.
 *  NOT assumed to be "Account": it is the user's own account title. */
export function parseDimCurrentUser(text: string): string {
  return get(parseIni(text), 'General', 'CurrentUser')
}

/**
 * The paths one account's INI carries.
 *
 * A NAMED whitelist, never a passthrough — see the credential note atop this
 * file. Everything absent comes back '' (or an empty list), which the caller
 * reads as "DIM has no opinion", not as an error.
 */
export function parseDimAccountIni(text: string): DimAccountPaths {
  const ini = parseIni(text)
  const general = (key: string) => get(ini, 'General', key)

  // `[InstallPaths]` is a Qt list: `size=N` then `<i>\InstallPath{,Title}`.
  const libraries: Array<{ title: string; path: string }> = []
  const size = Number(get(ini, 'InstallPaths', 'size'))
  if (Number.isFinite(size) && size > 0) {
    for (let i = 1; i <= size; i++) {
      const path = get(ini, 'InstallPaths', `${i}\\InstallPath`)
      if (path.trim() === '') continue
      libraries.push({
        title: get(ini, 'InstallPaths', `${i}\\InstallPathTitle`) || path,
        path,
      })
    }
  }

  return {
    library: general('CurInstallPath'),
    libraries,
    manifests: general('OverrideManifestDir'),
    downloads: general('DownloadPath'),
    thumbnails: general('OverrideThumbnailDir'),
    software64: general('Software64Path'),
  }
}
