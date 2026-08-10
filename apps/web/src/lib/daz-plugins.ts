/**
 * Which Daz plugin binary belongs in which Daz installation.
 *
 * The studio installs two plugins into Daz Studio: the **DTH Exporter** (mrpdean's,
 * from a release folder the user points at) and the **DTH Character Studio
 * Runner** (ours, bundled with the app). Both ship one binary PER STUDIO
 * GENERATION, and a machine can have several generations installed side by side
 * — so "install the plugin" is never one source and one destination. It is a
 * MATCH: every release the user has, against every installation this machine
 * has, paired by generation.
 *
 * The pairing key is the DLL's own file name, and it is a contract, not a
 * heuristic: **Daz Studio 6 only loads plugins named `dsp_*.dll`; Daz Studio 4
 * loads the plain name.** So a release folder holding `dsp_dth_exporter.dll` is
 * a DS6 build and one holding `dth_exporter.dll` is a DS4 build, whatever the
 * folder is called. Folder names are the FALLBACK ({@link flavorFromPathHint}),
 * for a release whose binaries were renamed or repackaged.
 *
 * Pure — text and structs in, decisions out. The I/O half (reading the DLLs,
 * scanning the installs, copying the files) is `lib/rom/storage/releases.ts` +
 * `lib/rom/api/install.ts`.
 */

/** The two Daz Studio generations the plugins are built for. Everything ≥ 5 is
 *  a "ds6" — the plugin ABI split is at 5, not at the marketing name. */
export type DazFlavor = 'ds4' | 'ds6'

/** DS4 vs DS6 from a DAZStudio exe's file version: major 4 → ds4, 5+ → ds6
 *  (null for an unreadable/absent version — never guess from folder names,
 *  "DAZStudio4 64-bit" contains a 6). */
export function dazFlavorFromExeVersion(version: string): DazFlavor | null {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  if (!Number.isFinite(major) || major <= 0) return null
  return major >= 5 ? 'ds6' : 'ds4'
}

/** Same split from a plain major version number (DIM reports one per install). */
export function dazFlavorFromMajor(major: number): DazFlavor | null {
  if (!Number.isFinite(major) || major <= 0) return null
  return major >= 5 ? 'ds6' : 'ds4'
}

/** The `dsp_` prefix DS6 requires of every plugin it loads. */
const DS6_PLUGIN_PREFIX = 'dsp_'

/**
 * Whether a file name is a DTH **Exporter** plugin DLL, and which generation it
 * is for. Matched by pattern rather than a fixed name — the DLL has been renamed
 * across releases (`dth_exporter.dll` → `dsp_dth_exporter.dll`) — which is
 * exactly what makes the prefix the generation marker. `null` for anything else,
 * including the optional `dth_tools.dll` companion that ships beside it.
 */
export function exporterDllFlavor(fileName: string): DazFlavor | null {
  const lower = fileName.toLowerCase()
  if (!lower.endsWith('.dll') || !lower.includes('dth_exporter')) return null
  return lower.startsWith(DS6_PLUGIN_PREFIX) ? 'ds6' : 'ds4'
}

/**
 * A generation guessed from a folder path — the fallback when the binaries
 * inside carry no usable name (`…/ExporterPlugin/Daz Studio 4`, `…/DS6`,
 * `…/daz studio 4.22`). Only the LAST path segment is read: an exporter release
 * for DS4 living under `D:/Daz Studio 6 stuff/` must not read as DS6.
 */
export function flavorFromPathHint(path: string): DazFlavor | null {
  const last = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const match = /(?:daz\s*studio|daz|ds)\s*[-_ ]?(\d+)/i.exec(last)
  if (!match) return null
  return dazFlavorFromMajor(Number.parseInt(match[1] ?? '', 10))
}

/** One plugin binary the studio could install: where it is, what it is for. */
export interface PluginRelease {
  /** The folder to copy FROM (the one holding the DLL). */
  folder: string
  /** The DLL's file name — shown, because it is also the evidence. */
  fileName: string
  /** The generation it belongs to. */
  flavor: DazFlavor
  /** The DLL's FileVersion ('' when it carries no version resource). */
  version: string
  /**
   * What the FOLDER claims this build is for, when it says anything
   * ({@link flavorFromPathHint}) — a cross-check, never the decision. The DLL
   * name is not merely evidence about the packager's intent, it is functional
   * truth: Daz Studio 6 refuses to load a plugin without the `dsp_` prefix, so
   * an un-prefixed binary can only ever be a DS4 plugin no matter which folder
   * it was filed under. A hint that DISAGREES is therefore a mis-packed release
   * folder, and the panel says so rather than quietly obeying either side.
   */
  pathHint: DazFlavor | null
}

/** Version compare on dotted numbers, missing components counting as 0. */
export function compareDottedVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * The one release to install per generation: the highest version found.
 *
 * A user pointing the studio at a tree of releases (or at several folders, one
 * per Studio) means "use what I have" — and for a plugin that is the newest
 * build for each Studio. Ties keep the first seen, so the folder order the user
 * typed decides between two copies of the same version. A release with NO
 * version resource loses to any versioned one and wins only when it is the sole
 * candidate — an unversioned DLL is still installable, just never preferred
 * over one that could be compared.
 */
export function newestReleasePerFlavor(
  releases: ReadonlyArray<PluginRelease>,
): Record<DazFlavor, PluginRelease | null> {
  const pick: Record<DazFlavor, PluginRelease | null> = { ds4: null, ds6: null }
  for (const release of releases) {
    const current = pick[release.flavor]
    if (!current) {
      pick[release.flavor] = release
      continue
    }
    if (compareDottedVersions(release.version, current.version) > 0) pick[release.flavor] = release
  }
  return pick
}
