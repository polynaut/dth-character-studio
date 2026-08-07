import { houdiniVersionFromDocs, houdiniVersionFromInstall } from './houdini-version.ts'

/**
 * The installed Houdini versions, paired with the preferences folder each one
 * actually uses.
 *
 * The registry half is native (`houdini_install.rs` — SideFX records every
 * install under `HKLM\SOFTWARE\Side Effects Software\Houdini`). Everything here
 * is the part worth testing: which docs folder belongs to which install, which
 * install to recommend, and what activating one writes.
 *
 * **Pairing is by major.minor, and it is the whole point.** hython runs with
 * the docs folder as `HOUDINI_USER_PREF_DIR`; pointed at another version's it
 * loads the wrong otls/packages — or none — and every DazToHue node comes back
 * as an unknown type. `houdini-version.ts` owns that rule and is shared with
 * Generate project, so detection cannot pair differently from generation.
 */

/** One Houdini install, as the registry reports it. */
export interface HoudiniInstall {
  /** SideFX's four-part version (`22.0.0.368`) — the stable identity the studio
   *  stores as "which installation is active". */
  version: string
  path: string
}

/** An install plus everything the studio worked out about it. */
export interface HoudiniInstallFound extends HoudiniInstall {
  /** `22.0` — what the docs folder is matched on. '' when unparseable. */
  release: string
  /** "Houdini 22.0.368" — the card's title, from the folder SideFX installed
   *  into rather than the registry's four-part version, because that is the
   *  name the user sees everywhere else (Start menu, the folder itself). */
  name: string
  /** The `houdini<major>.<minor>` folder found for it, '' when there is none. */
  docsFolder: string
  /** false = the install folder is not on disk (a stale registry entry). */
  exists: boolean
}

/** Everything detection found. */
export interface HoudiniInstallScan {
  installs: Array<HoudiniInstallFound>
  /** Every `houdini<major>.<minor>` folder seen while looking, whether or not
   *  an install claims it — a leftover from an uninstalled version is worth
   *  reporting rather than silently dropping. */
  docsFolders: Array<string>
}

/** Empty, and the shape a caller can always rely on. */
export const EMPTY_HOUDINI_SCAN: HoudiniInstallScan = { installs: [], docsFolders: [] }

/** `…/Houdini 22.0.368` → `Houdini 22.0.368`; falls back to the version. */
function installName(install: HoudiniInstall): string {
  const base = install.path.trim().replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
  return base || `Houdini ${install.version}`
}

/**
 * Pair each install with its docs folder.
 *
 * `docsFolders` is every candidate found on disk — the caller looks in more
 * than one place because Houdini does: measured on a machine whose Documents
 * is redirected to another drive, `houdini22.0` existed under BOTH
 * `D:/User Data/Documents` and `%USERPROFILE%`. First match wins, so the
 * caller's order is the preference order.
 *
 * Sorted newest release first, so the recommendation is the newest Houdini.
 */
export function buildHoudiniScan(
  installs: ReadonlyArray<HoudiniInstall>,
  docsFolders: ReadonlyArray<string>,
  /** Which install folders are actually on disk (the caller stats them). */
  existing: ReadonlySet<string>,
): HoudiniInstallScan {
  const found = installs.map((install): HoudiniInstallFound => {
    const release = houdiniVersionFromInstall(install.path)
    return {
      version: install.version,
      path: install.path,
      release,
      name: installName(install),
      docsFolder:
        release === ''
          ? ''
          : (docsFolders.find((docs) => houdiniVersionFromDocs(docs) === release) ?? ''),
      exists: existing.has(install.path),
    }
  })
  // Newest first, by major.minor then by the full version — "22.0" beats
  // "20.5", and two builds of one release order by their build number.
  found.sort((a, b) => compareRelease(b.release, a.release) || compareVersion(b.version, a.version))
  return { installs: found, docsFolders: [...docsFolders] }
}

/** Numeric dotted compare — `20.5` < `22.0`, and `9.5` < `20.0` (which a string
 *  compare gets wrong). Missing components count as 0. */
function compareParts(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const x = left[i] ?? 0
    const y = right[i] ?? 0
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0
    if (x !== y) return x - y
  }
  return 0
}

const compareRelease = compareParts
const compareVersion = compareParts

/**
 * The install to recommend: newest whose folder is there AND that has a docs
 * folder to pair with.
 *
 * Both conditions matter. An install with no matching `houdini<major>.<minor>`
 * cannot run hython usefully — the studio's own Generate project refuses it —
 * so recommending it would recommend the one that doesn't work. Falls back to
 * the newest present install when none has a docs folder, because "here is the
 * one to fix" beats offering nothing.
 */
export function defaultHoudiniInstall(
  installs: ReadonlyArray<HoudiniInstallFound>,
): HoudiniInstallFound | null {
  return (
    installs.find((install) => install.exists && install.docsFolder !== '') ??
    installs.find((install) => install.exists) ??
    null
  )
}

/** The studio settings an activated Houdini implies. */
export interface DerivedHoudiniPaths {
  houdiniInstallFolder: string
  houdiniDocsFolder: string
}

/**
 * What activating one card writes.
 *
 * `extraHoudiniDocsFolders` is deliberately untouched: it exists so an OLDER
 * Houdini can keep an OLDER DTH release, which is a decision about the other
 * versions, not about this one. Activating picks the primary; it does not
 * decide what the user does with the rest.
 *
 * An unknown version derives nothing rather than falling back to the first
 * install — a stored version this machine no longer has means the machine
 * changed, and the UI has to say so.
 */
export function deriveHoudiniPaths(
  scan: HoudiniInstallScan,
  version: string,
): DerivedHoudiniPaths | null {
  const install = scan.installs.find((candidate) => candidate.version === version)
  if (!install) return null
  return { houdiniInstallFolder: install.path, houdiniDocsFolder: install.docsFolder }
}
