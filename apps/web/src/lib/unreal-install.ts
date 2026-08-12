/**
 * The installed Unreal Engine versions, and which configured plugin builds fit
 * a given project.
 *
 * The registry half is native (`unreal_install.rs` — the Epic launcher records
 * every install under `HKLM\SOFTWARE\EpicGames\Unreal Engine`), and so is the
 * source-folder scan. Everything here is the part worth testing: which engine
 * a `.uproject`'s `EngineAssociation` names, which plugin builds match it,
 * which build wins when several share a name, and which engine to preselect.
 *
 * **Matching is by major.minor, and it is the whole point.** An Unreal plugin
 * is a compiled binary against ONE engine version — installing a 5.6 build
 * into a 5.7 project produces a module-load error at startup. `''` as a
 * build's engine version means "no version signal anywhere" and matches any
 * engine (a content-only plugin has no binary to mismatch).
 */

/** One Unreal Engine install, as the registry reports it (`5.7` + folder). */
export interface UnrealEngineInstall {
  /** Epic's major.minor (`5.7`) — the identity a `.uproject` associates with. */
  version: string
  path: string
  /** The engine's own `BuildId` — see {@link pluginBuildMismatch}. */
  buildId?: string
}

/** An install plus what the studio worked out about it. */
export interface UnrealEngineFound extends UnrealEngineInstall {
  /** "Unreal Engine 5.7" — the card/select title. The folder basename is NOT
   *  used: Epic's default is an opaque `UE_5.7` and a custom location can be
   *  anything, while the version is always the identity that matters. */
  name: string
  /** false = the engine folder is not on disk (a stale registry entry —
   *  measured on this project's own dev machine, where an uninstalled 4.0
   *  still had its key). */
  exists: boolean
}

/** Everything engine detection found. */
export interface UnrealEngineScan {
  installs: Array<UnrealEngineFound>
}

/** Empty, and the shape a caller can always rely on. */
export const EMPTY_UNREAL_SCAN: UnrealEngineScan = { installs: [] }

/** One plugin build a source-folder scan found (wire shape of
 *  `scan_unreal_plugins` — see `unrealPluginSourceSchema`). */
export interface UnrealPluginSource {
  /** The `.uplugin` stem — also the folder name an install writes under the
   *  project's `Plugins/`. */
  name: string
  /** The folder holding the `.uplugin` (what an install copies). */
  path: string
  /** `major.minor` this build targets, or `''` = any engine. */
  engineVersion: string
  /** The configured settings folder it was found under. */
  sourceFolder: string
  /** The `BuildId` its binaries were compiled against — see
   *  {@link pluginBuildMismatch}. Absent/'' for a plugin with no binaries. */
  buildId?: string
}

/**
 * Whether a plugin build's binaries CANNOT load in a given engine.
 *
 * The version match above compares labels — a folder called `UE_5.7`, or a
 * `.uplugin` field. Unreal itself compares `BuildId`s: the engine's, out of
 * `Engine/Binaries/Win64/UnrealEditor.modules`, against each plugin's. They
 * must be equal or the editor reports *"missing or built with a different
 * engine version"* and offers to rebuild — which a Blueprint-only project
 * cannot do.
 *
 * MEASURED 2026-08-12, and why this exists: a plugin folder named
 * `Unreal Engine 5.7 Plugin` held binaries built for 5.8. Every label agreed;
 * only the BuildId disagreed, and it was the one that mattered.
 *
 * Returns false whenever either side is unknown (`''`): a plugin with no
 * binaries has nothing to mismatch, and an engine whose id the studio could not
 * read is not evidence of anything. Never guess a mismatch — the cost of a
 * false alarm here is the user unchecking a plugin that would have worked.
 */
export function pluginBuildMismatch(
  plugin: Pick<UnrealPluginSource, 'buildId'>,
  engine: Pick<UnrealEngineInstall, 'buildId'> | null | undefined,
): boolean {
  const pluginId = (plugin.buildId ?? '').trim()
  const engineId = (engine?.buildId ?? '').trim()
  if (!pluginId || !engineId) return false
  return pluginId !== engineId
}

/** Numeric dotted compare — `5.7` < `5.10` (which a string compare gets
 *  wrong). Missing components count as 0. */
function compareVersion(a: string, b: string): number {
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

/** Sort + annotate the raw registry list. Newest first, so the first present
 *  install is also the one to preselect. */
export function buildUnrealScan(
  installs: ReadonlyArray<UnrealEngineInstall>,
  /** Which engine folders are actually on disk (the caller stats them). */
  existing: ReadonlySet<string>,
): UnrealEngineScan {
  const found = installs.map(
    (install): UnrealEngineFound => ({
      version: install.version,
      path: install.path,
      name: `Unreal Engine ${install.version}`,
      exists: existing.has(install.path),
    }),
  )
  found.sort((a, b) => compareVersion(b.version, a.version))
  return { installs: found }
}

/** The engine to preselect: the newest one that is actually on disk. */
export function defaultUnrealEngine(
  installs: ReadonlyArray<UnrealEngineFound>,
): UnrealEngineFound | null {
  return installs.find((install) => install.exists) ?? null
}

/**
 * The `major.minor` a `.uproject`'s `EngineAssociation` names, or null when it
 * names no matchable version: a GUID (source build), an empty string (next to
 * the engine), or any other custom identifier. `5.7.1` normalizes to `5.7` —
 * matching is on the release, not a patch.
 */
export function engineVersionFromAssociation(association: string): string | null {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(association.trim())
  if (!match) return null
  return `${Number(match[1])}.${Number(match[2])}`
}

/** Whether one build fits one engine version (`''` = built for any). */
export function pluginMatchesEngine(plugin: UnrealPluginSource, engineVersion: string): boolean {
  return plugin.engineVersion === '' || plugin.engineVersion === engineVersion
}

/**
 * The one build per plugin NAME that fits the given engine — the install
 * checklist for a project whose engine version is known.
 *
 * One per name because the install target is `Plugins/<name>`: offering two
 * builds of one plugin would offer two writes to the same folder. An exact
 * version match beats an any-engine build; a same-version tie keeps the scan's
 * own order — the Rust scan sorts by name, version, then PATH, so the
 * alphabetically first build path wins, deterministically.
 */
export function matchPluginsToEngine(
  plugins: ReadonlyArray<UnrealPluginSource>,
  engineVersion: string,
): Array<UnrealPluginSource> {
  const byName = new Map<string, UnrealPluginSource>()
  for (const plugin of plugins) {
    if (!pluginMatchesEngine(plugin, engineVersion)) continue
    const key = plugin.name.toLowerCase()
    const seen = byName.get(key)
    if (!seen || (seen.engineVersion === '' && plugin.engineVersion !== '')) {
      byName.set(key, plugin)
    }
  }
  return [...byName.values()]
}

/**
 * Every distinct build, for a project whose engine version is UNKNOWN (GUID
 * or absent association): the dialog lists them all — labeled with their
 * versions, none preselected — because only the user knows what their source
 * build is. Deduped by path (two overlapping configured folders can find the
 * same build twice).
 */
export function allPluginBuilds(
  plugins: ReadonlyArray<UnrealPluginSource>,
): Array<UnrealPluginSource> {
  const byPath = new Map<string, UnrealPluginSource>()
  for (const plugin of plugins) {
    const key = plugin.path.replace(/\\/g, '/').toLowerCase()
    if (!byPath.has(key)) byPath.set(key, plugin)
  }
  return [...byPath.values()]
}

/** "UE 5.7" / "any engine" — the checklist's per-build version label. */
export function pluginVersionLabel(engineVersion: string): string {
  return engineVersion === '' ? 'any engine' : `UE ${engineVersion}`
}

/**
 * Why a new-project name would be refused, or null when it is fine. Unreal's
 * own rules: module/asset tooling chokes on anything beyond `[A-Za-z0-9_]`,
 * and a leading digit breaks generated C++ identifiers.
 */
export function unrealProjectNameError(name: string): string | null {
  if (name.trim() === '') return 'Enter a project name.'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())) {
    return 'Unreal project names allow letters, digits and _ only, not starting with a digit.'
  }
  return null
}

/**
 * Whether a scanned plugin build is an ARCHIVE rather than a folder.
 *
 * Some vendors ship the plugin as a single `<Plugin>.zip` in a versioned
 * folder. The scan reads the `.uplugin` out of the archive and offers it like
 * any other build; the install extracts instead of copying. Worth SAYING in the
 * UI, because "this is a zip" explains both why the folder looked empty before
 * and what the install is about to do.
 */
export function isZippedPlugin(path: string): boolean {
  return path.trim().toLowerCase().endsWith('.zip')
}

/**
 * A DTH project's name as a LEGAL Unreal project name, for prefilling the
 * Generate dialog.
 *
 * The two namespaces don't agree: a `.dcsp` may be called anything the
 * filesystem allows, while Unreal takes `[A-Za-z_][A-Za-z0-9_]*` only (see
 * {@link unrealProjectNameError}). Prefilling the raw name would open the
 * dialog on its own validation error for something the user didn't type —
 * "3d-workflow" is a real project here and fails on both counts. So: every
 * illegal character becomes `_`, runs collapse, TRAILING `_` go, and a leading
 * digit gets one `_` in front (legal, and keeps the name recognisable rather
 * than inventing a word). A leading `_` is kept — it is legal Unreal, and
 * dropping it would rename a project the user deliberately called `_Sandbox`.
 * Returns '' when nothing usable is left, which the dialog treats as "no
 * prefill" — an empty field the user fills in beats a suggestion that means
 * nothing.
 */
export function unrealProjectNameFrom(projectName: string): string {
  const cleaned = projectName
    .trim()
    // Both of these are GLOBAL replaces with no anchor, so each match consumes
    // — linear. The trailing trim below is a loop and not `/_+$/`: a `+` right
    // before `$` is the polynomial-ReDoS shape CodeQL flags (js/polynomial-redos,
    // high), which is why `lib/path-trim.ts` exists at all. See `.ai/gotchas.md`.
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
  let trimmed = cleaned
  while (trimmed.endsWith('_')) trimmed = trimmed.slice(0, -1)
  if (trimmed === '') return ''
  return /^[0-9]/.test(trimmed) ? `_${trimmed}` : trimmed
}

/**
 * The `.uproject` a generated project starts from: a Blueprint-only project
 * (no C++ modules), which Unreal opens without a compile step. The engine
 * association is the launcher's major.minor, so the editor binds it without
 * the "select engine version" prompt.
 */
export function uprojectFileContent(engineVersion: string): string {
  return `${JSON.stringify(
    {
      FileVersion: 3,
      EngineAssociation: engineVersion,
      Category: '',
      Description: '',
    },
    null,
    '\t',
  )}\n`
}
