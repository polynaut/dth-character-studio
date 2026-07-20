import { exists, remove } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import {
  activeSceneOverrides,
  characterScriptName,
  characterSlug,
  generateAll,
  generateSceneOverride,
  genRomIncludes,
  jcmIsBaseRom,
  poseAssetFileName,
  resolveRomPaths,
  sceneOverrideSlug,
} from '@dth/rom'
import * as storage from '../storage'
import { poseAssetFramesSchema, sceneWearablesSchema } from './native-types'
import { CHARACTER_SCHEMA_VERSION, poseAssetCsvEra, RUNTIME_VERSION } from '@dth/rom'
import {
  charScopeInput,
  charsRoot,
  fetchPoseAssets,
  projectsForSweep,
  resolveProject,
} from './core'

import type { Character, PresetFrames } from '@dth/rom'
import type { PoseAssets, ProjectInfo } from './core'

// Generating the DTH artifacts (Daz .dsa scripts + Houdini PoseAsset CSV) from a
// character definition, plus the cross-project Refresh-assets sweep and the
// asset-version (staleness) detection that drives it.

// Generate also accepts the character's previous name so a rename can clean up
// the old-named script left behind in the shared scripts folder, plus an optional
// `targets` set so a selective Refresh can rewrite only the Daz scripts or only the
// Houdini CSV (omitted = write both, the editor's "Generate").
const generateInput = charScopeInput.extend({
  previousName: z.string().optional(),
  targets: z
    .object({ daz: z.boolean(), houdini: z.boolean() })
    .optional(),
})

// --- Pose-asset frame measurement -----------------------------------------

interface MeasuredFrames {
  frames: number
  error: string
}

/** Measure the frame length of each `.duf` via the native command. The result
 *  is parsed through the contract schema (not a bare cast), so a Rust-side
 *  shape change throws HERE instead of desyncing frame numbers downstream. */
async function measureFrames(paths: Array<string>): Promise<Map<string, MeasuredFrames>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const results = z
    .array(poseAssetFramesSchema)
    .parse(await invoke('pose_asset_frames', { paths: unique }))
  return new Map(results.map((r) => [r.path, { frames: r.frames, error: r.error }]))
}

/** The fitted (conformed) items of a scene `.duf` — the groom-suggestion source
 *  for the character editor. Best-effort by design: outside the desktop app, or
 *  when the scene can't be read, it returns an empty list with the reason in
 *  `error` — suggestions degrade, the editor never breaks. */
export async function sceneWearables({ data }: { data: unknown }) {
  const input = z.object({ scenePath: z.string().min(1) }).parse(data)
  if (!isTauri()) return { items: [], error: 'not running in the desktop app' }
  try {
    return sceneWearablesSchema.parse(await invoke('scene_wearables', { path: input.scenePath }))
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Measure the preset ROM block lengths (base JCM/RET/FAC, GP, DK, Physics) for a
 * character from the actual `.duf` assets — read on the fly, nothing hard-coded,
 * custom assets measured the same way as DTH ones. **Throws** when an included
 * block's asset can't be found or read, so a missing/bad `.duf` can never
 * silently produce a wrong-length ROM. `gp`/`dk`/`phys` are 0 when not included.
 */
export async function resolvePresetFrames(
  character: Character,
  catalog?: PoseAssets,
): Promise<PresetFrames> {
  const cat = catalog ?? (await fetchPoseAssets())
  const romPaths = cat.error ? {} : resolveRomPaths(character, cat)
  const { sections, gender } = character
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(gender, sections.GEN.presetAssets)

  const basePath =
    sections.JCM.mode === 'custom' ? sections.JCM.customAssetPath.trim() : (romPaths.jcm ?? '')
  const blocks: Array<{
    key: keyof PresetFrames
    label: string
    need: boolean
    path: string
  }> = [
    { key: 'base', label: 'base ROM (JCM / RET / FAC)', need: jcmIsBaseRom(sections), path: basePath },
    { key: 'gp', label: 'Golden Palace', need: genPreset && roms.gp, path: romPaths.gp ?? '' },
    { key: 'dk', label: 'Dicktator', need: genPreset && roms.dk, path: romPaths.dk ?? '' },
    {
      key: 'phys',
      label: 'Physics',
      need: sections.PHY.enabled && sections.PHY.mode === 'preset',
      path: romPaths.phys ?? '',
    },
  ]

  const measured = await measureFrames(blocks.filter((b) => b.need).map((b) => b.path))
  const frames: PresetFrames = { base: 0, gp: 0, dk: 0, phys: 0 }
  for (const block of blocks) {
    if (!block.need) continue
    if (!block.path) {
      throw new Error(
        `Couldn't locate the ${block.label} pose asset for ${character.genesis} — ` +
          `the installed DTH release may not ship it for this generation; ` +
          `disable the section or rescan the poses in Settings.`,
      )
    }
    const hit = measured.get(block.path)
    if (!hit || hit.error) {
      throw new Error(`Couldn't read frames from the ${block.label} asset:\n${hit?.error ?? block.path}`)
    }
    frames[block.key] = hit.frames
  }
  return frames
}

/**
 * Compiles the character into its DTH artifacts and writes them to two places:
 *  - the Houdini PoseAsset CSV → the character's own folder (next to its
 *    definition JSON), and
 *  - the self-contained Daz script (<Name>_<Genesis>.dsa) → a per-character
 *    subfolder `<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/`.
 *    The DTH runtime files it imports are installed ONCE in that root (copied
 *    from the DazToHue-Scripts checkout); the script imports them two levels up.
 *    Returns the files so the UI can offer downloads.
 */
export async function generateCharacterFiles({ data }: { data: unknown }): Promise<{
  outDir: string
  files: ReturnType<typeof generateAll>
  scriptsDir: string | null
  scriptsError: string | null
}> {
  const { projectId, id, previousName, targets } = generateInput.parse(data)
  // Which artifact groups to (re)write. The editor's Generate writes both; a
  // selective Refresh asks for only the Daz scripts (runtime change) or only the
  // Houdini CSV (DTH-era change).
  const writeDaz = targets?.daz ?? true
  const writeHoudini = targets?.houdini ?? true
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  // Resolve the character's location ONCE (one library scan) and reuse it for the
  // read, the output folder, and the generated-version write below — those three
  // storage calls used to each run their own full scan (O(N) per save; O(N²) over
  // a Refresh-assets sweep).
  const location = await storage.getCharacterPath(lib, id)
  if (!location) throw new Error(`Character ${id} not found`)
  const character = await storage.getCharacter(lib, id, location.definitionAbs)
  if (!character) throw new Error(`Character ${id} not found`)
  // Exact ROM paths from the active release's pose scan; {} when the folder is
  // unavailable — the script then falls back to DthOptions resolution.
  const catalog = await fetchPoseAssets()
  const romPaths = catalog.error ? {} : resolveRomPaths(character, catalog)
  // Frame lengths measured live from the actual .duf assets (hard-errors if an
  // included block can't be read — never a wrong-length ROM).
  const frames = await resolvePresetFrames(character, catalog)
  // The character's own folder holds the canonical PoseAsset CSV. Its absolute
  // path is baked into the generated script so the script can move the CSV into
  // the resolved export dir (scene subfolder included) when it runs in Daz.
  const outDir = await storage.getCharacterFolder(lib, id, location.folderAbs)
  // Stamp the generating studio version into the script header for traceability.
  const versioned = { ...character, studioVersion: await storage.studioVersion() }
  // The active DTH release selects the PoseAsset CSV era/variant (the Daz scripts
  // are release-independent — tied to RUNTIME_VERSION only).
  const activeRelease = catalog.error ? '' : catalog.version
  const settings = await storage.getSettings()
  // When the project enables Daz Products, also emit the per-character product-scan
  // script. The "on" flag + the DIM folder + the derived per-scene output folder
  // reach the pure core only here, as the trailing generateAll argument.
  const scanProducts = project.dazProductsEnabled
    ? {
        dimManifestPath: settings.dimManifestsFolder,
        outputDir: await storage.productScanDir(project.id, character.id),
        dazLibraryFolder: settings.dazLibraryFolder,
      }
    : undefined
  const defaultFiles = generateAll(versioned, romPaths, frames, outDir, activeRelease, scanProducts)
  // Scene overrides: every enabled override for a linked extra scene compiles
  // its own scene-suffixed ROM script + CSV pair from the merged sections —
  // the "default artifacts for the primary scene, specific ones per outfit
  // scene" split. Written to the same two destinations as the defaults.
  const overrideFiles = activeSceneOverrides(versioned).flatMap((override) =>
    generateSceneOverride(versioned, override, romPaths, frames, outDir, activeRelease),
  )
  const files = [...defaultFiles, ...overrideFiles]
  // Scene-suffixed artifact names of EVERY stored override (active or not) at a
  // given character name — the sweep candidates. Filtered against what was just
  // written, this removes exactly the artifacts of overrides that were disabled
  // or whose scene was unlinked (their data stays in the JSON; the files go).
  const overrideCsvNames = (name: string) =>
    character.sceneOverrides.map((o) =>
      poseAssetFileName({ ...character, name }, sceneOverrideSlug(o.scenePath)),
    )
  const overrideScriptNames = (name: string) =>
    character.sceneOverrides.flatMap((o) => {
      const base = characterScriptName({ ...character, name }, sceneOverrideSlug(o.scenePath))
      return [`ROM_${base}.dsa`, `Export_${base}.dsa`]
    })

  // Houdini deliverable(s) — <Name>_pose_asset.csv — live in the character's own folder.
  if (writeHoudini) {
    const houdiniFiles = files.filter((file) => file.target === 'houdini')
    await storage.writeFilesToFolder(outDir, houdiniFiles)
    const writtenHoudini = houdiniFiles.map((file) => file.fileName)
    // After a rename the PoseAsset filenames change too — drop the old-named
    // ones (default + per-scene) that traveled with the folder.
    if (previousName) {
      await storage.removeFilesFromFolder(
        outDir,
        [
          poseAssetFileName({ ...character, name: previousName }),
          ...overrideCsvNames(previousName),
        ].filter((name) => !writtenHoudini.includes(name)),
      )
    }
    // Drop the legacy-cased CSV (<name>_PoseAsset.csv) left by older versions —
    // the file is now <name>_pose_asset.csv — and the CSVs of overrides that no
    // longer generate.
    const legacyPose = poseAssetFileName(character).replace(/_pose_asset\.csv$/, '_PoseAsset.csv')
    await storage.removeFilesFromFolder(outDir, [
      legacyPose,
      ...overrideCsvNames(character.name).filter((name) => !writtenHoudini.includes(name)),
    ])
    // Record which DTH release the CSV was generated for (its era drives staleness).
    await storage.setGeneratedDthVersion(lib, id, activeRelease, location.definitionAbs)
  }

  // The PoseAsset CSV is delivered to the export dir by the generated Daz script
  // when it runs — it copies the CSV from the character folder into the resolved
  // export dir (scene subfolder included), next to the exporter's .abc/.dth. So
  // the studio no longer copies it to the export root here (the scene subfolder
  // isn't known until run time anyway).

  // The character script goes in its own <project>/<character>/ subfolder of the
  // shared scripts folder; the runtime it imports is installed once in the root.
  const dazFiles = files.filter((file) => file.target === 'daz')
  let scriptsDir: string | null = null
  let scriptsError: string | null = null
  if (writeDaz && !settings.dazLibraryFolder) {
    scriptsError = 'Set “My DAZ 3D Library” to install the character script'
  } else if (writeDaz) {
    const root = storage.studioScriptsDir(settings.dazLibraryFolder)
    const charDir = storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name)
    try {
      await storage.copyRuntimeFiles(root)
      await storage.writeFilesToFolder(charDir, dazFiles)
      // Drop the other script variant when the combined/split choice changed, and
      // the scan script when Daz Products is turned off: keep only the .dsa names
      // just written (<base>, ROM_<base>, Export_<base>, Scan_Products_<slug>).
      // Scene-override scripts sweep the same way — the candidates of every
      // stored override minus what was just written, so disabling an override
      // (or unlinking its scene) retires its scripts.
      const dazBase = characterScriptName(character)
      const writtenDaz = dazFiles.map((file) => file.fileName)
      await storage.removeFilesFromFolder(
        charDir,
        [
          `${dazBase}.dsa`,
          `ROM_${dazBase}.dsa`,
          `Export_${dazBase}.dsa`,
          `Export_Hair_${dazBase}.dsa`,
          // Legacy name (pre-Hair rename) — never in the written set now, so it's
          // always swept from a character folder that still has the old script.
          `Export_Groom_${dazBase}.dsa`,
          `Open_Scene_${dazBase}.dsa`,
          `Scan_Products_${characterSlug(character)}.dsa`,
          ...overrideScriptNames(character.name),
        ].filter((name) => !writtenDaz.includes(name)),
      )
      // Migration: older versions wrote the script flat in the root — drop this
      // character's flat-layout script (current + previous name) if it lingers.
      await storage.removeFilesFromFolder(root, [
        `${characterScriptName(character)}.dsa`,
        ...(previousName ? [`${characterScriptName({ ...character, name: previousName })}.dsa`] : []),
      ])
      // After a rename the character subfolder name changes — remove the stale one.
      if (previousName) {
        const oldCharDir = storage.studioCharScriptsDir(
          settings.dazLibraryFolder,
          project.name,
          previousName,
        )
        if (oldCharDir !== charDir && (await exists(oldCharDir))) {
          await remove(oldCharDir, { recursive: true })
        }
      }
      scriptsDir = charDir
    } catch (error) {
      scriptsError = error instanceof Error ? error.message : String(error)
    }
  }
  return { outDir, files, scriptsDir, scriptsError }
}

/** One character's outcome in a {@link refreshAllAssets} run. */
export interface RefreshResult {
  project: string
  character: string
  /** false = generation threw (e.g. an asset couldn't be measured). */
  ok: boolean
  /** Generation error (when !ok) or a soft warning (e.g. scripts skipped). */
  detail?: string
}

export interface RefreshSummary {
  /** Characters actually (re)generated this run (= regenerated + failed). */
  total: number
  regenerated: number
  failed: number
  /** Characters left untouched because nothing of theirs was out of date (only on a
   *  targeted refresh; a forced full refresh regenerates everyone, so 0). */
  skipped: number
  /** Per-artifact counts of what was actually (re)written — so the UI can say
   *  exactly what happened, not just "N characters". */
  counts: {
    /** Character definitions migrated + re-saved (schema was out of date). */
    migrated: number
    /** Characters whose Daz scripts (ROM/Export) were regenerated. */
    scripts: number
    /** Characters whose PoseAsset CSV was regenerated. */
    csv: number
  }
  results: Array<RefreshResult>
  /** Outcome of refreshing the bundled DTH runtime files (null = not refreshed this
   *  run — no DAZ library, or no character needed its scripts rewritten). */
  runtime: { ok: boolean; detail?: string } | null
}

/**
 * Re-generate the derived artifacts across the in-scope projects (this window's
 * active project, or every known project from Home — see {@link projectsForSweep}),
 * **selectively**:
 *  - If anything is out of date, each character regenerates only its affected
 *    artifact(s) — `runtime` → the bundled runtime files + that character's Daz
 *    scripts (their call API may have changed); `csv` → the PoseAsset CSV (its DTH
 *    era changed); `schema` → migrate + re-save the JSON, then regenerate both
 *    (a migration can change generated output). Characters with nothing stale are
 *    skipped.
 *  - If nothing is out of date (the user clicked Refresh anyway), it's a forced
 *    full refresh: every character regenerates everything.
 * Per-character failures are collected, not thrown, so one bad character can't
 * abort the sweep.
 */
export async function refreshAllAssets(): Promise<RefreshSummary> {
  const settings = await storage.getSettings()
  const hasDazLibrary = Boolean(settings.dazLibraryFolder)
  const catalog = await fetchPoseAssets()
  const activeRelease = catalog.error ? '' : catalog.version
  const opts = { hasDazLibrary, hasDthRelease: activeRelease !== '' }
  const app = { schema: CHARACTER_SCHEMA_VERSION, runtime: RUNTIME_VERSION, dthRelease: activeRelease }

  // Pass 1 — gather every character with its staleness, so we can tell a targeted
  // refresh (some mismatch → regenerate only what's affected) from a forced full
  // refresh (nothing stale, the user clicked anyway → regenerate everything).
  // Scope follows the window: the active project in a project window, every known
  // project (recents) from the Home window — see projectsForSweep.
  const projects = await projectsForSweep()
  const results: Array<RefreshResult> = []
  const items: Array<{ project: ProjectInfo; character: Character; targets: StaleTargets }> = []
  for (const project of projects) {
    let characters: Array<Character>
    try {
      characters = await storage.listCharacters(charsRoot(project))
    } catch (e) {
      results.push({
        project: project.name,
        character: '(project unreachable)',
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
      continue
    }
    for (const character of characters) {
      const runtimeVersion = hasDazLibrary
        ? await storage.readScriptRuntimeVersion(settings.dazLibraryFolder, project.name, character)
        : null
      const status: CharacterAssetStatus = {
        projectId: project.path,
        project: project.name,
        character: character.name,
        schemaVersion: character.schemaVersion,
        runtimeVersion,
        generatedDthVersion: character.generatedDthVersion,
      }
      items.push({ project, character, targets: characterStaleTargets(status, app, opts) })
    }
  }

  const force = !items.some((i) => i.targets.schema || i.targets.runtime || i.targets.csv)

  // Refresh the bundled runtime files once when scripts will be (re)written — any
  // runtime mismatch, or a forced full refresh.
  let runtime: RefreshSummary['runtime'] = null
  if (hasDazLibrary && (force || items.some((i) => i.targets.runtime))) {
    try {
      await storage.copyRuntimeFiles(storage.studioScriptsDir(settings.dazLibraryFolder))
      runtime = { ok: true }
    } catch (e) {
      runtime = { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  // Pass 2 — regenerate per character. A schema change regenerates both artifacts
  // (the migration can alter generated output); runtime → Daz scripts; csv → CSV.
  let skipped = 0
  const counts = { migrated: 0, scripts: 0, csv: 0 }
  for (const { project, character, targets } of items) {
    const regenSchema = force || targets.schema
    const regenDaz = force || targets.runtime || targets.schema
    const regenHoudini = force || targets.csv || targets.schema
    if (!regenSchema && !regenDaz && !regenHoudini) {
      skipped += 1
      continue
    }
    try {
      // A character read at an older schema is already migrated in-memory
      // (parseCharacter); re-saving stamps the current version, clearing the stale
      // state. Independent of the DAZ library.
      if (regenSchema && character.schemaVersion < CHARACTER_SCHEMA_VERSION) {
        await storage.saveCharacter(project, character, charsRoot(project))
        counts.migrated += 1
      }
      const res = await generateCharacterFiles({
        data: {
          projectId: project.path,
          id: character.id,
          targets: { daz: regenDaz, houdini: regenHoudini },
        },
      })
      // Scripts only count when they were actually written (no DAZ library → soft
      // scriptsError, nothing on disk); the CSV always writes to the project folder.
      if (regenDaz && !res.scriptsError) counts.scripts += 1
      if (regenHoudini) counts.csv += 1
      results.push({
        project: project.name,
        character: character.name,
        ok: true,
        detail: res.scriptsError ?? undefined,
      })
    } catch (e) {
      results.push({
        project: project.name,
        character: character.name,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const failed = results.filter((r) => !r.ok).length
  return {
    total: results.length,
    regenerated: results.length - failed,
    failed,
    skipped,
    counts,
    results,
    runtime,
  }
}

/** One character's local asset-version status in a {@link detectAssetVersions} run. */
export interface CharacterAssetStatus {
  projectId: string
  project: string
  character: string
  /** Schema version stored in the character's JSON definition. */
  schemaVersion: number
  /** Runtime version read from the character's generated Daz script — `null` when
   *  no script has been generated yet (or no DAZ library is configured). */
  runtimeVersion: number | null
  /** DTH release the character's PoseAsset CSV was last generated for (from the
   *  JSON's `generatedDthVersion`; '' when never generated). Staleness compares its
   *  CSV *era* (see {@link poseAssetCsvEra}), not the exact string. */
  generatedDthVersion: string
}

export interface AssetVersionReport {
  /** The versions the CURRENT app generates with. `dthRelease` is the active DTH
   *  release ('' when none is configured). */
  app: { schema: number; runtime: number; dthRelease: string }
  characters: Array<CharacterAssetStatus>
  total: number
  /** Distinct characters that need updating — an older definition schema (migrated
   *  by a re-save), an older/missing script runtime, or a CSV generated for a
   *  different DTH era than the active release. Refresh clears every cause. */
  staleCount: number
  /** A DAZ library is configured, so generated-script (runtime) versions can be
   *  checked and regenerated. Schema + CSV checks do NOT require it. */
  hasDazLibrary: boolean
  /** A DTH release is configured, so the CSV era can be compared. */
  hasDthRelease: boolean
  /** Some character is out of date → a Refresh is needed. Drives the banner and the
   *  startup redirect; Refresh fixes every cause (migrate + regenerate), so it
   *  converges (no redirect loop). */
  refreshNeeded: boolean
}

/** Which of a character's three artifact groups are out of date. */
export interface StaleTargets {
  /** Definition JSON is on an older schema — migrate + re-save (then regenerate). */
  schema: boolean
  /** Daz scripts (runtime + character scripts) are on an older/missing runtime. */
  runtime: boolean
  /** PoseAsset CSV was generated for a different DTH era — regenerate the CSV. */
  csv: boolean
}

/**
 * Which artifacts are out of date versus what the app now produces:
 *  - `schema`: JSON below CHARACTER_SCHEMA_VERSION.
 *  - `runtime`: script missing or older than RUNTIME_VERSION — judged only when a
 *    DAZ library is configured (no library → no scripts to compare).
 *  - `csv`: the CSV's DTH *era* differs from the active release's era — judged only
 *    when a DTH release is configured. Needs NO DAZ library: the CSV and its
 *    provenance live in the project folder / JSON.
 * Shared by detection, the Refresh table, and the selective refresh so all three
 * judge staleness identically.
 */
export function characterStaleTargets(
  c: CharacterAssetStatus,
  app: AssetVersionReport['app'],
  opts: { hasDazLibrary: boolean; hasDthRelease: boolean },
): StaleTargets {
  return {
    schema: c.schemaVersion < app.schema,
    runtime: opts.hasDazLibrary && (c.runtimeVersion === null || c.runtimeVersion < app.runtime),
    csv:
      opts.hasDthRelease &&
      poseAssetCsvEra(c.generatedDthVersion) !== poseAssetCsvEra(app.dthRelease),
  }
}

/** Whether a character is out of date in ANY of its three artifacts. */
export function isCharacterStale(
  c: CharacterAssetStatus,
  app: AssetVersionReport['app'],
  opts: { hasDazLibrary: boolean; hasDthRelease: boolean },
): boolean {
  const t = characterStaleTargets(c, app, opts)
  return t.schema || t.runtime || t.csv
}

/**
 * Detect, across the in-scope projects (this window's active project, or every
 * known project from Home — see {@link projectsForSweep}), which character-JSON
 * **schema**, generated **script runtime**, and **PoseAsset-CSV DTH release** each
 * character is on locally, versus what the current app produces. Schema + CSV come from
 * each JSON (the CSV's release is its `generatedDthVersion` provenance); the
 * runtime is read back from each character's generated Daz script header. Feeds the
 * Refresh assets page, the About summary, and the startup "refresh needed?" check.
 */
export async function detectAssetVersions(): Promise<AssetVersionReport> {
  const settings = await storage.getSettings()
  const hasDazLibrary = Boolean(settings.dazLibraryFolder)
  const catalog = await fetchPoseAssets()
  const activeRelease = catalog.error ? '' : catalog.version
  const hasDthRelease = activeRelease !== ''
  const app = { schema: CHARACTER_SCHEMA_VERSION, runtime: RUNTIME_VERSION, dthRelease: activeRelease }

  const characters: Array<CharacterAssetStatus> = []
  // Scope follows the window: the active project in a project window, every known
  // project (recents) from the Home window — see projectsForSweep.
  const projects = await projectsForSweep()
  for (const project of projects) {
    let chars: Array<Character>
    try {
      chars = await storage.listCharacters(charsRoot(project))
    } catch {
      continue // unreachable project — an actual refresh run surfaces the error
    }
    for (const character of chars) {
      const runtimeVersion = hasDazLibrary
        ? await storage.readScriptRuntimeVersion(settings.dazLibraryFolder, project.name, character)
        : null
      characters.push({
        projectId: project.path,
        project: project.name,
        character: character.name,
        schemaVersion: character.schemaVersion,
        runtimeVersion,
        generatedDthVersion: character.generatedDthVersion,
      })
    }
  }

  const staleCount = characters.filter((c) =>
    isCharacterStale(c, app, { hasDazLibrary, hasDthRelease }),
  ).length
  return {
    app,
    characters,
    total: characters.length,
    staleCount,
    hasDazLibrary,
    hasDthRelease,
    refreshNeeded: staleCount > 0,
  }
}

/**
 * Lightweight startup probe: true when generated scripts are out of date versus
 * this app's runtime (so the app should send the user to Refresh assets). Never
 * throws — any failure (no native layer, unreadable disk) reports "not needed".
 */
export async function isRefreshNeeded(): Promise<boolean> {
  try {
    return (await detectAssetVersions()).refreshNeeded
  } catch {
    return false
  }
}
