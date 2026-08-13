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

/** The other half of {@link pluginBuildMismatch}: both ids known and EQUAL —
 *  positive proof this build loads in this engine, not merely the absence of
 *  proof that it doesn't. Two different things, and {@link matchPluginsToEngine}
 *  needs to tell them apart. */
function pluginBuildAgrees(
  plugin: Pick<UnrealPluginSource, 'buildId'>,
  engine: Pick<UnrealEngineInstall, 'buildId'> | null | undefined,
): boolean {
  const pluginId = (plugin.buildId ?? '').trim()
  const engineId = (engine?.buildId ?? '').trim()
  return pluginId !== '' && pluginId === engineId
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

/**
 * Sort + annotate the raw registry list. Newest first, so the first present
 * install is also the one to preselect.
 *
 * SPREADS the install rather than naming its fields. Listing them meant a field
 * added to {@link UnrealEngineInstall} was silently dropped on the way to the
 * UI — which is exactly what happened to `buildId`: the native side read it,
 * the schema parsed it, and this function threw it away, so every plugin build
 * check quietly answered "cannot tell". Nothing caught it, because the dialog
 * tests mock `detectUnrealEngines` and never run this. A spread makes the next
 * field arrive on its own.
 */
export function buildUnrealScan(
  installs: ReadonlyArray<UnrealEngineInstall>,
  /** Which engine folders are actually on disk (the caller stats them). */
  existing: ReadonlySet<string>,
): UnrealEngineScan {
  const found = installs.map(
    (install): UnrealEngineFound => ({
      ...install,
      name: `Unreal Engine ${install.version}`,
      exists: existing.has(install.path),
    }),
  )
  found.sort((a, b) => compareVersion(b.version, a.version))
  return { installs: found }
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
 * How well one build is KNOWN to fit the engine — the ranking
 * {@link matchPluginsToEngine} picks by. Higher wins.
 *
 * Binary proof outranks a label in BOTH directions, because that is the whole
 * lesson of `pluginBuildMismatch`: a matching `BuildId` is the engine's own
 * yes, a differing one is its own no, and a folder name is neither.
 *
 * | rank | meaning |
 * | ---- | ------- |
 * | 3 | its `BuildId` equals the engine's — proven to load |
 * | 2 | no BuildId evidence, but it names this exact engine version |
 * | 1 | no BuildId evidence and no version signal (`any engine`) |
 * | 0 | its `BuildId` differs from the engine's — proven NOT to load |
 *
 * With no BuildIds anywhere only 2 and 1 occur, which is exactly the older
 * "an exact version beats an any-engine build" rule, unchanged.
 */
function buildRank(
  plugin: UnrealPluginSource,
  engine: Pick<UnrealEngineInstall, 'buildId'> | null | undefined,
): number {
  if (pluginBuildAgrees(plugin, engine)) return 3
  if (pluginBuildMismatch(plugin, engine)) return 0
  return plugin.engineVersion === '' ? 1 : 2
}

/**
 * The one build per plugin NAME that fits the given engine — the install
 * checklist for a project whose engine version is known.
 *
 * One per name because the install target is `Plugins/<name>`: offering two
 * builds of one plugin would offer two writes to the same folder. Which one is
 * {@link buildRank}; a tie keeps the scan's own order — the Rust scan sorts by
 * name, version, then PATH, so the alphabetically first build path wins,
 * deterministically.
 *
 * **Pass `engine` whenever it is known.** Without it the choice is made on
 * labels alone, and MEASURED 2026-08-12 that is not enough: a user with
 * `KawaiiPhysics_5_7_1_…` and `KawaiiPhysics_5_8_…` side by side has two builds
 * that BOTH read as `any engine` (the underscores are not a version), so the
 * alphabetically first — the 5.7 one — was offered to a 5.8 project, marked
 * unloadable, while the 5.8 build that would have worked was dropped from the
 * list entirely. Ranking by BuildId picks the one that loads instead of
 * explaining why the other doesn't.
 */
export function matchPluginsToEngine(
  plugins: ReadonlyArray<UnrealPluginSource>,
  engineVersion: string,
  /** The engine this project uses, when the studio found it — its `buildId`
   *  decides between two builds a label cannot separate. */
  engine?: Pick<UnrealEngineInstall, 'buildId'> | null,
): Array<UnrealPluginSource> {
  const byName = new Map<string, UnrealPluginSource>()
  for (const plugin of plugins) {
    if (!pluginMatchesEngine(plugin, engineVersion)) continue
    const key = plugin.name.toLowerCase()
    const seen = byName.get(key)
    if (!seen || buildRank(plugin, engine) > buildRank(seen, engine)) {
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
