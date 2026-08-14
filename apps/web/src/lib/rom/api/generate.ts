import { exists, mkdir, readDir, readTextFile, remove, rename, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import {
  EXPORT_FOLDERS_FILE,
  EXPORT_PROGRESS_FILE,
  expectedSceneExportFolders,
  parseExportFoldersRecord,
  staleExportFolders,
} from '../execute-jobs.ts'
import { CHARACTER_INTERNAL_FILES, relocatableInternals } from '../character-internals.ts'

import { normalizePathLower } from '#/lib/path.ts'
import { normalizeRelFolder } from '../library'
import {
  PRIMARY_SCENE_SUBFOLDER,
  characterExportRoot,
  deriveScenesRootRel,
  suggestSceneSubfolder,
} from '#/lib/scene-subfolder.ts'
import { withBusyCursor } from '../../busy-cursor.ts'

import {
  activeSceneOverrides,
  BUILD_ROM_ANIMATION_SCRIPT,
  BULK_ROM_EXPORT_SCRIPT,
  characterScriptName,
  characterSlug,
  generateAll,
  genRomIncludes,
  jcmIsBaseRom,
  LEGACY_ROM_ANIMATIONS_FOLDER,
  orphanedRomAnimations,
  ROM_ANIMATIONS_FOLDER,
  mergeSceneOverride,
  poseAssetFileName,
  resolveRomPaths,
  sceneOverrideSlug,
  sceneRomArmed,
} from '@dth/rom'
import * as storage from '../storage'
import { relativeInside } from '../storage/fs'
import { copyDazScene } from './attachments'
import { clearImageSrcCache, rebuildAvatarMaster, upscaleStoredAvatar } from './avatars'
import { carryStoredProductsToMeta, ingestProductScans, pruneProductScans } from './products'
import { relocateExportRoot } from './export-root'
import { poseAssetFramesSchema, sceneWearablesSchema } from './native-types'
import { hipRefPrefixFor } from '#/lib/scene-subfolder.ts'
import { sweepExportJunctions, sweepHoudiniProjectDirs } from './houdini'
import { CHARACTER_SCHEMA_VERSION, poseAssetCsvEra, RUNTIME_VERSION } from '@dth/rom'
import {
  basename,
  cacheCharacterLocation,
  characterLocationCache,
  charScopeInput,
  charsRoot,
  dirname,
  fetchPoseAssets,
  fetchPoseAssetsCurrent,
  joinPath,
  locateCharacter,
  projectsForSweep,
  resolveProject,
  sweepTargets,
} from './core'

import type { Character, PresetFrames, RomPaths } from '@dth/rom'
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

/** Measured `.duf` frame counts, keyed on `path|<mtime>:<size>`. A `.duf`'s frame
 *  count is deterministic per file version, so this spares re-parsing tens of MB of
 *  DSON JSON on every hover-preload / generate. Self-invalidating: a replaced `.duf`
 *  (a new DTH release) has a fresh mtime:size, so a stale entry is never served.
 *  Only successful measures are cached (an error may be a transient locked file). */
const measuredFramesCache = new Map<string, MeasuredFrames>()

/** Measure the frame length of each `.duf` via the native command (through a cheap
 *  mtime|size cache). The native result is parsed through the contract schema (not a
 *  bare cast), so a Rust-side shape change throws HERE instead of desyncing frames. */
async function measureFrames(paths: Array<string>): Promise<Map<string, MeasuredFrames>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const out = new Map<string, MeasuredFrames>()
  const stamps = new Map<string, string>()
  const need: Array<string> = []
  // Cheap revalidation (one stat per path) gates the expensive native parse.
  await Promise.all(
    unique.map(async (path) => {
      let stamp = ''
      try {
        const info = await stat(path)
        const mtime = info.mtime?.getTime()
        if (mtime !== undefined) stamp = `${mtime}:${info.size}`
      } catch {
        // unstattable → force a fresh measure so it errors meaningfully downstream
      }
      stamps.set(path, stamp)
      const cached = stamp ? measuredFramesCache.get(`${path}|${stamp}`) : undefined
      if (cached) out.set(path, cached)
      else need.push(path)
    }),
  )
  if (need.length > 0) {
    const results = z
      .array(poseAssetFramesSchema)
      .parse(await invoke('pose_asset_frames', { paths: need }))
    for (const r of results) {
      const measured = { frames: r.frames, error: r.error }
      out.set(r.path, measured)
      const stamp = stamps.get(r.path)
      if (stamp && !r.error) measuredFramesCache.set(`${r.path}|${stamp}`, measured)
    }
  }
  return out
}

/** The fitted (conformed) items of a scene `.duf` — the groom-suggestion source
 *  for the character editor. Best-effort by design: outside the desktop app, or
 *  when the scene can't be read, it returns an empty list with the reason in
 *  `error` — suggestions degrade, the editor never breaks. */
export async function sceneWearables({ data }: { data: unknown }) {
  const input = z.object({ scenePath: z.string().min(1) }).parse(data)
  if (!isTauri())
    return empty('not running in the desktop app')
  try {
    return sceneWearablesSchema.parse(await invoke('scene_wearables', { path: input.scenePath }))
  } catch (error) {
    return empty(error instanceof Error ? error.message : String(error))
  }
  function empty(error: string): z.infer<typeof sceneWearablesSchema> {
    return { items: [], figure: null, figures: [], animationFrames: 0, error }
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
 * The stale-artifact sweep candidates that may actually be removed: `candidates`
 * minus the just-written `written` names, compared case-INSENSITIVELY. On
 * Windows both `exists` and `remove` resolve names case-insensitively, so a
 * candidate differing from a written file only by case — a case-only rename
 * (kira → Kira; `characterSlug` preserves case) — would pass a case-sensitive
 * filter and then delete the very file that was just written.
 */
export function removalSweepNames(
  candidates: Array<string>,
  written: Array<string>,
): Array<string> {
  const writtenLower = new Set(written.map((name) => name.toLowerCase()))
  return candidates.filter((name) => !writtenLower.has(name.toLowerCase()))
}

/**
 * Compiles the character into its DTH artifacts and writes them to two places:
 *  - the Houdini PoseAsset CSV → the character's folder in the project's hidden
 *    meta folder (`.dcsmeta/characters/<folder>` — `storage.characterMetaDir`),
 *    where the studio's other per-character files live too, and
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
  /** Leftover `dth-exports` junctions removed by this generation's sweep (the
   *  retired junction feature) — Refresh assets reports them per character. */
  sweptJunctions: Array<string>
  /** Empty leftover `houdini-project` folders removed by this generation (the
   *  folder retired in v0.68) — reported like the junctions above. */
  sweptProjectDirs: Array<string>
  /** Leftover `houdini-project` folders that were NOT removed because they
   *  hold something. The user's own output; theirs to look at and delete. */
  keptProjectDirs: Array<string>
  /** App-internal files this generation relocated out of the character folder
   *  into `.dcsmeta/characters/<folder>` (the one-time v0.68 move) — reported
   *  per character by Refresh assets. Empty once a character has migrated. */
  movedInternals: Array<string>
}> {
  const { projectId, id, previousName, targets } = generateInput.parse(data)
  // Which artifact groups to (re)write. The editor's Generate writes both; a
  // selective Refresh asks for only the Daz scripts (runtime change) or only the
  // Houdini CSV (DTH-era change).
  const writeDaz = targets?.daz ?? true
  const writeHoudini = targets?.houdini ?? true
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  // Resolve the character's location ONCE — through the session cache (a hit
  // costs one exists()), falling back to the full scan — and reuse it for the
  // read, the output folder, and the generated-version write below. Those
  // storage calls used to each run their own full scan (O(N) per save; O(N²)
  // over a Refresh-assets sweep).
  let location = await locateCharacter(lib, id)
  let character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!character) {
    // The cached file no longer holds this character (replaced/moved under us) —
    // drop the entry and let one full scan decide.
    characterLocationCache.delete(`${lib}|${id}`)
    location = await storage.getCharacterPath(lib, id)
    character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
    if (location) cacheCharacterLocation(lib, id, location)
  }
  if (!location || !character) throw new Error(`Character ${id} not found`)
  // Where this character's app-internal files live: the project's hidden meta
  // folder, keyed on the character's own folder (`.dcsmeta/characters/Ita`).
  // Everything the studio writes for itself goes there — the run log, the
  // Execute stamps, the export-folder record and the PoseAsset CSV(s) — so the
  // character folder holds only the user's own files plus the definition.
  const metaDir = storage.characterMetaDir(project.path, location.relFolder, character.id)
  // …and the one-time move of the copies older builds left in the character
  // folder root. Runs before anything is written, on every generation, so a
  // character migrates on its next save and a whole library on one Refresh
  // (relocateCharacterInternals is also called on Refresh's SKIP path, so a
  // character with nothing stale still sheds its leftovers).
  const movedInternals = await relocateCharacterInternals(
    project.path,
    location,
    character,
    previousName,
  )
  // Scene-suffixed PoseAsset names of EVERY stored override (active or not) at a
  // given character name, and the legacy-cased CSV older versions wrote — the
  // stale-artifact sweep's share of the owned-names rule the relocation uses.
  const overrideCsvNames = (name: string) => overrideCsvNamesFor(character, name)
  const legacyPose = legacyPoseName(character)
  // A scene-less character (created without a Daz scene; the editor is locked
  // until the primary is linked) generates NOTHING — its artifacts would embed
  // an empty scene. Every generation path funnels through here (save, create,
  // Refresh assets), so this one guard keeps them all quiet.
  if (!character.scenePath) {
    return {
      outDir: location.folderAbs,
      files: [],
      scriptsDir: null,
      scriptsError: null,
      sweptJunctions: [],
      sweptProjectDirs: [],
      keptProjectDirs: [],
      movedInternals,
    }
  }
  // Exact ROM paths from the active release's pose scan; {} when the folder is
  // unavailable — the script then falls back to DthOptions resolution. The
  // CURRENT-settings variant: another window may have switched the active DTH
  // release since this window's catalog was scanned.
  const catalog = await fetchPoseAssetsCurrent()
  const romPaths = catalog.error ? {} : resolveRomPaths(character, catalog)
  // Frame lengths measured live from the actual .duf assets (hard-errors if an
  // included block can't be read — never a wrong-length ROM).
  const frames = await resolvePresetFrames(character, catalog)
  // The character's own folder — the anchor for its scenes, Houdini projects and
  // export root (NOT for the generated CSV, which lives in `metaDir` above).
  const outDir = await storage.getCharacterFolder(lib, id, location.folderAbs)
  // The meta folder has to exist before the scripts that write into it run: the
  // runtime's run log lands there whether or not this pass wrote a CSV.
  // Best-effort — a failure here surfaces on the write below, not now.
  try {
    await mkdir(metaDir, { recursive: true })
  } catch {
    // an unwritable meta folder fails loudly at the CSV write, with a real path
  }
  // Stamp the generating studio version into the script header for traceability.
  const versioned = { ...character, studioVersion: await storage.studioVersion() }
  // The active DTH release selects the PoseAsset CSV era/variant (the Daz scripts
  // are release-independent — tied to RUNTIME_VERSION only).
  const activeRelease = catalog.error ? '' : catalog.version
  const settings = await storage.getSettings()
  // The product scan is armed by the DIM manifests folder alone: that folder IS
  // the product database, so having it means the scan can name products, and not
  // having it means the scan could only ever list raw assets. The per-project
  // "Daz Products" toggle no longer gates the scanning — it only decides whether
  // the character page shows the tab that reads the results. So a scan runs, and
  // its results are picked up, whether or not anybody is looking at them.
  const scanProducts = settings.dimManifestsFolder.trim()
    ? {
        dimManifestPath: settings.dimManifestsFolder,
        outputDir: await storage.productScanDir(project.id, character.id),
        dazLibraryFolder: settings.dazLibraryFolder,
      }
    : undefined
  // Every ROM/export run also SCANS the scene it just verified, so the morph
  // index (and, with Daz Products on, the product results) stay current off the
  // app's core flow alone — no separate Tools pass to remember. Both scans are
  // best-effort inside the run: they must never fail an export that worked.
  const indexSync = {
    morphIndexDir: await storage.dataDir(),
    // What to file this scene's morphs under when its figures carry no readable
    // source asset — the character's own generation, which the studio has and
    // the scan (in Daz Studio 4) could not derive.
    genesis: character.genesis,
    // The SAME config the standalone Scan_Products script gets, plus the
    // identity it needs, so the two paths cannot drift apart.
    ...(scanProducts
      ? {
          products: {
            ...scanProducts,
            characterId: character.id,
            characterName: character.name,
            genesis: character.genesis,
          },
        }
      : {}),
  }
  // Per-scene rom paths + preset-block frames. A scene that overrides mode / preset
  // asset / custom JCM path resolves DIFFERENT `.duf` assets and block lengths than the
  // base — which the pure core can't recompute (the catalog lookup + native `.duf`
  // measurement live here). Resolve them over each merged character so the per-scene
  // config delta (and its CSV) carry the right paths/frames. Keyed by the normalized
  // scene path, matching the runtime scene lookup + buildSceneConfigMap. Only ROM-armed
  // overrides change sections; identity/groom/jcm-only ones ride the base paths/frames.
  const sceneRomPaths: Record<string, RomPaths> = {}
  const sceneFrames: Record<string, PresetFrames> = {}
  for (const override of activeSceneOverrides(versioned)) {
    if (!sceneRomArmed(override)) continue
    const key = override.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    if (!key) continue
    const merged = mergeSceneOverride(versioned, override)
    sceneRomPaths[key] = catalog.error ? {} : resolveRomPaths(merged, catalog)
    sceneFrames[key] = await resolvePresetFrames(merged, catalog)
  }
  // The character's scenes ROOT (charFolder-relative rule shared with the
  // scenes UI — lib/scene-subfolder.ts): each scene's export nests under its
  // own subfolder below it. A primary linked outside the character folder
  // leaves it undefined — the export block then falls back to stem-named
  // subfolders per scene.
  const primaryDir = dirname(versioned.scenePath)
  const primaryRel =
    normalizePathLower(primaryDir) === normalizePathLower(outDir)
      ? ''
      : relativeInside(outDir, primaryDir)
  const scenesRootAbs =
    primaryRel === null
      ? undefined
      : joinPath(outDir, deriveScenesRootRel(primaryRel, project.dazSubdir))
  // The project-relative emit decision: bone-scale reference-skeleton paths are
  // written `$JOB`-anchored (`$JOB/<houdiniSubdir>/daz-export/…` — runtime v64;
  // `<dazSubdir>/dth-exports` in v63, `$HIP/../…` before that, and no junctions
  // since v0.63) only when ONE prefix is provably right for every linked `.hip`:
  // all inside the character folder, and the export root inside it too
  // (`hipRefPrefixFor`). Anything else falls back to absolute paths for this
  // character rather than shipping refs that cannot resolve. The style knob
  // stays PER PROJECT (the `.dcsp`, Settings → Project).
  const hipRefPrefix =
    project.houdiniPathStyle !== 'absolute'
      ? hipRefPrefixFor(versioned.houdiniProjects, outDir, versioned.exportPath)
      : ''
  // Leftover sweep from the retired junction feature: every generation removes
  // the `dth-exports` reparse points the old code planted (reparse-point-safe;
  // real folders are never touched). Best-effort — a locked link waits for the
  // next save — and reported per character by Tools → Refresh assets.
  const sweptJunctions = await sweepExportJunctions(versioned, outDir, project.houdiniSubdir).catch(
    () => [] as Array<string>,
  )
  // Same idea for the `houdini-project` folder retired in v0.68: it could never
  // collect Houdini's output ($HIP is derived from where the .hip sits, and Set
  // Project only sets $JOB), so it is removed — but ONLY when empty. A pre-v0.64
  // project had $JOB pointed at it and may hold real caches; that is the user's
  // output, so a non-empty one is kept and reported instead.
  const { removed: sweptProjectDirs, kept: keptProjectDirs } = await sweepHoudiniProjectDirs(
    outDir,
    project.houdiniSubdir,
  ).catch(() => ({ removed: [] as Array<string>, kept: [] as Array<string> }))
  // The ONE character script embeds every linked scene's overrides and selects
  // the open scene at run time; generateAll also mints a per-scene PoseAsset CSV
  // for each ROM-override scene (Houdini has no runtime to select frames). Both
  // destinations get them below.
  const files = generateAll(
    versioned,
    romPaths,
    frames,
    metaDir,
    activeRelease,
    scanProducts,
    sceneRomPaths,
    sceneFrames,
    scenesRootAbs,
    hipRefPrefix,
    indexSync,
    // The Runner-v1.2.0 verbose progress log the generated carriers append
    // their finished steps to — the same app-data file the export handoff
    // writes into the job (execute.ts). Machine-specific by design, like the
    // baked CSV-delivery path.
    await storage.dataPath(EXPORT_PROGRESS_FILE),
  )
  // Scene-suffixed SCRIPT names of every stored override (active or not) — the
  // sweep candidates. Filtered against what was just written, this removes the
  // LEGACY per-scene ROM/Export scripts from before the one-script model (always,
  // since they're no longer generated). The CSV twin is `overrideCsvNames` above.
  const overrideScriptNames = (name: string) =>
    character.sceneOverrides.flatMap((o) => {
      const base = characterScriptName({ ...character, name }, sceneOverrideSlug(o.scenePath))
      return [`ROM_${base}.dsa`, `Export_${base}.dsa`]
    })

  // Houdini deliverable(s) — <Name>_pose_asset.csv — live in the character's meta
  // folder, whose absolute path the generated export script carries so it can
  // copy the right CSV into the resolved export dir when it runs.
  if (writeHoudini) {
    const houdiniFiles = files.filter((file) => file.target === 'houdini')
    await storage.writeFilesToFolder(metaDir, houdiniFiles)
    const writtenHoudini = houdiniFiles.map((file) => file.fileName)
    // After a rename the PoseAsset filenames change too — drop the old-named
    // ones (default + per-scene) that traveled with the meta folder.
    if (previousName) {
      await storage.removeFilesFromFolder(
        metaDir,
        removalSweepNames(
          [
            poseAssetFileName({ ...character, name: previousName }),
            ...overrideCsvNames(previousName),
          ],
          writtenHoudini,
        ),
      )
    }
    // Drop the legacy-cased CSV (<name>_PoseAsset.csv) left by older versions —
    // the file is now <name>_pose_asset.csv — and the CSVs of overrides that no
    // longer generate.
    await storage.removeFilesFromFolder(
      metaDir,
      removalSweepNames([legacyPose, ...overrideCsvNames(character.name)], writtenHoudini),
    )
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
      // Content Library artwork beside each script it belongs to (`<base>.png` +
      // `<base>.tip.png`). The names it actually wrote join the just-written set
      // below — otherwise the sweep, which lists the same names as candidates,
      // would delete the tiles the line above just produced.
      const writtenIcons = await storage.writeScriptIcons(charDir, dazFiles)
      // Drop the other script variant when the combined/split choice changed, and
      // the scan script when Daz Products is turned off: keep only the .dsa names
      // just written (<base>, ROM_<base>, Export_<base>, Scan_Products_<slug>).
      // Scene-override scripts sweep the same way — the candidates of every
      // stored override minus what was just written, so disabling an override
      // (or unlinking its scene) retires its scripts. Each icon-bearing script
      // name contributes its artwork twins as candidates too, so turning the
      // split (or hair export) off retires that script's tiles with it.
      const dazBase = characterScriptName(character)
      const iconBearing = [
        `ROM_${dazBase}.dsa`,
        `Export_${dazBase}.dsa`,
        `Export_Hair_${dazBase}.dsa`,
        // Slug only, no genesis suffix — the scan script is named for the
        // character alone. It belongs HERE rather than in the plain candidate
        // list below precisely because it carries artwork: turning Daz Products
        // off has to retire its tiles with it, or a script that no longer exists
        // keeps a Content Library tile pointing at nothing.
        `Scan_Products_${characterSlug(character)}.dsa`,
      ]
      const writtenDaz = [...dazFiles.map((file) => file.fileName), ...writtenIcons]
      await storage.removeFilesFromFolder(
        charDir,
        removalSweepNames(
          [
            `${dazBase}.dsa`,
            ...iconBearing,
            // The hidden bulk script exists only WITH an export dir — swept
            // here once the dir is cleared. The ROM-only sibling is always
            // written now; listing it keeps a future retirement sweepable.
            BULK_ROM_EXPORT_SCRIPT,
            BUILD_ROM_ANIMATION_SCRIPT,
            // Legacy name (pre-Hair rename) — never in the written set now, so it's
            // always swept from a character folder that still has the old script.
            `Export_Groom_${dazBase}.dsa`,
            `Open_Scene_${dazBase}.dsa`,
            ...overrideScriptNames(character.name),
            ...iconBearing.flatMap((name) => storage.scriptIconNames(name)),
          ],
          writtenDaz,
        ),
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
        // Case-only rename (kira → Kira): the two paths differ as strings but are
        // the SAME physical dir on Windows, so a case-sensitive `!==` would delete
        // the folder we just wrote the new scripts into. Compare case-insensitively.
        if (
          normalizePathLower(oldCharDir) !== normalizePathLower(charDir) &&
          (await exists(oldCharDir))
        ) {
          await remove(oldCharDir, { recursive: true })
        }
      }
      scriptsDir = charDir
    } catch (error) {
      scriptsError = error instanceof Error ? error.message : String(error)
    }
  }
  // The export root exists from character creation on — but a character created
  // before schema v29 only gets its derived path on the next save, so make sure
  // the folder is actually there before scripts that export into it run.
  // Best-effort: the exporter would create it too; this just keeps a freshly
  // migrated character's folder browsable straight away.
  const exportRoot = versioned.exportPath.trim()
  if (exportRoot) {
    try {
      await mkdir(exportRoot, { recursive: true })
    } catch {
      // a failing mkdir here must never fail the generation
    }
  }
  // The character's FINAL export folder (Houdini → Unreal), seeded at creation
  // beside the Daz and Houdini ones — created here too so characters that
  // predate the setting, or whose project renamed it, get theirs as well.
  // Best-effort for the same reason as above.
  try {
    const finalExport = normalizeRelFolder(project.exportSubdir)
    if (finalExport) await mkdir(joinPath(outDir, finalExport), { recursive: true })
  } catch {
    // an absent export folder is a nuisance, never a reason to fail a generate
  }
  await migrateRomAnimationFolders(versioned)
  await housekeepRomAnimations(versioned)
  await housekeepExportFolders(versioned, metaDir, scenesRootAbs)
  return {
    outDir,
    files,
    scriptsDir,
    scriptsError,
    sweptJunctions,
    sweptProjectDirs,
    keptProjectDirs,
    movedInternals,
  }
}

/**
 * Move the app's own per-character files out of the character folder root into
 * `.dcsmeta/characters/<folder>` — the one-time v0.68 relocation, run on every
 * generation because that is the one place every character passes through.
 *
 * `owned` is the exact list of names the studio writes for THIS character (see
 * {@link relocatableInternals}); nothing else in the folder is touched, so a
 * file the user put there can't be swept up by it. A destination that already
 * holds the name means this character has migrated and something wrote the old
 * path again (an older build sharing the project) — whichever copy is NEWER
 * wins (by mtime), because the old-path copy is then the fresher state that
 * build produced (a just-written run log, a regenerated CSV) and dropping it
 * would silently keep stale data authoritative. Unreadable mtimes fall back to
 * keeping the destination.
 *
 * Best effort throughout: a locked file (Daz mid-write, a CSV open in Excel)
 * stays put and the next generation retries it. Returns what actually moved.
 * Unguarded by `isTauri()` on purpose — the first `readDir` throws in a browser
 * build and lands in the same catch, which keeps the rule under test.
 */
/** Scene-suffixed PoseAsset names of EVERY stored override (active or not) at a
 *  given character name. Feeds the owned-names rule: the internals relocation
 *  and the stale-artifact sweep may only touch names the studio itself wrote. */
function overrideCsvNamesFor(character: Character, name: string): Array<string> {
  return character.sceneOverrides.map((o) =>
    poseAssetFileName({ ...character, name }, sceneOverrideSlug(o.scenePath)),
  )
}

/** The legacy-cased CSV (`<name>_PoseAsset.csv`) older versions wrote, before
 *  the file became `<name>_pose_asset.csv`. */
function legacyPoseName(character: Character): string {
  return poseAssetFileName(character).replace(/_pose_asset\.csv$/, '_PoseAsset.csv')
}

/**
 * The one-time move of app-internal files out of the character folder into its
 * `.dcsmeta/characters/<folder>` home. Shared by every generation AND by
 * Refresh assets' skip path — a character with nothing stale would otherwise
 * keep its leftovers until some other cause regenerated it.
 */
async function relocateCharacterInternals(
  projectPath: string,
  location: storage.CharacterLocation,
  character: Character,
  previousName?: string,
): Promise<Array<string>> {
  const metaDir = storage.characterMetaDir(projectPath, location.relFolder, character.id)
  return migrateCharacterInternals(location.folderAbs, metaDir, [
    ...CHARACTER_INTERNAL_FILES,
    legacyPoseName(character),
    poseAssetFileName(character),
    ...overrideCsvNamesFor(character, character.name),
    ...(previousName
      ? [
          poseAssetFileName({ ...character, name: previousName }),
          ...overrideCsvNamesFor(character, previousName),
        ]
      : []),
  ])
}

/** Whether `a` was modified more recently than `b`. Missing mtimes → false —
 *  the caller keeps its destination copy when age cannot be compared. */
async function newerThan(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([stat(a), stat(b)])
  if (!sa.mtime || !sb.mtime) return false
  return sa.mtime.getTime() > sb.mtime.getTime()
}

async function migrateCharacterInternals(
  charFolderAbs: string,
  metaDir: string,
  owned: ReadonlyArray<string>,
): Promise<Array<string>> {
  try {
    const listing = (await readDir(charFolderAbs)).filter((e) => e.isFile).map((e) => e.name)
    const present = relocatableInternals(listing, owned)
    if (present.length === 0) return []
    await mkdir(metaDir, { recursive: true })
    // Independent files — moved concurrently, each failing on its own.
    const moved = await Promise.all(
      present.map(async (name) => {
        try {
          const from = joinPath(charFolderAbs, name)
          const to = joinPath(metaDir, name)
          if (await exists(to)) {
            if (await newerThan(from, to)) {
              await remove(to)
              await rename(from, to)
            } else {
              await remove(from)
            }
          } else {
            await rename(from, to)
          }
          return name
        } catch {
          return '' // locked / in use — it relocates on a later generation
        }
      }),
    )
    return moved.filter(Boolean)
  } catch {
    // an unreadable character folder is never worth failing a generation over
    return []
  }
}

/**
 * Rename the pre-v48 hidden `.ROM_Animations` folder beside each linked scene
 * to `rom-animations`, so ROM animations already saved by an older build stay
 * findable instead of being silently orphaned by the rename.
 *
 * Runs on every generation, which is also when the scripts that write the new
 * name are (re)generated — the two must not disagree, or the studio would stat
 * `rom-animations/` while Daz kept filling `.ROM_Animations/`.
 *
 * Idempotent and conservative: nothing to do once renamed, and if BOTH folders
 * exist the old one is left alone rather than merged — two sets of saved ROM
 * scenes are the user's to reconcile, not ours. Best-effort throughout; a
 * locked folder must never fail the generation that triggered it.
 */
async function migrateRomAnimationFolders(character: Character): Promise<void> {
  if (!isTauri()) return
  // The distinct scene DIRECTORIES first — several scenes routinely share one,
  // and this pass is per folder, not per scene.
  const seen = new Set<string>()
  const dirs: Array<string> = []
  for (const scene of [character.scenePath, ...character.extraScenes]) {
    const norm = scene.trim().replace(/\\/g, '/')
    const slash = norm.lastIndexOf('/')
    if (slash < 0) continue
    const dir = norm.slice(0, slash)
    if (!dir || seen.has(dir.toLowerCase())) continue
    seen.add(dir.toLowerCase())
    dirs.push(dir)
  }
  // Independent folders — renamed concurrently, each failing on its own, the
  // same shape as `relocateCharacterInternals` above. Done in sequence this was
  // up to three round trips PER scene folder, on every generation, and the
  // folders it walks sit on whatever share the character does.
  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const from = `${dir}/${LEGACY_ROM_ANIMATIONS_FOLDER}`
        const to = `${dir}/${ROM_ANIMATIONS_FOLDER}`
        if (!(await exists(from))) return
        if (await exists(to)) return
        await rename(from, to)
      } catch {
        // a locked / in-use folder just keeps the old name until the next run
      }
    }),
  )
}

/**
 * ROM-animation housekeeping: retire saved ROM animations whose source scene no
 * longer goes by that name.
 *
 * A ROM animation is named after its source scene's stem, so renaming a scene
 * doesn't rename it — the next run writes a new one beside the old and the old
 * lingers forever (measured: one character folder holding both
 * `ItaDefault_G9_GP_ROM.*` and `Ita_G9_GP_ROM.*`, three files each, because Daz
 * saves two thumbnails alongside every scene).
 *
 * Scoped tightly, because this deletes: only inside a `rom-animations` folder
 * the studio owns, only files matching the studio's own `<stem>_ROM.<ext>`
 * naming, and only beside scenes the character STILL links. A scene the user
 * unlinked is never reached — its folder is orphaned rather than swept, the
 * same posture the export housekeeping takes toward a changed export dir.
 * Grouped by folder because two scenes can legitimately share one.
 */
async function housekeepRomAnimations(character: Character): Promise<void> {
  if (!isTauri()) return
  const byDir = new Map<string, { dir: string; stems: Array<string> }>()
  for (const scene of [character.scenePath, ...character.extraScenes]) {
    const norm = scene.trim().replace(/\\/g, '/')
    const slash = norm.lastIndexOf('/')
    if (slash < 0) continue
    const dir = norm.slice(0, slash)
    const stem = norm.slice(slash + 1).replace(/\.[^.]+$/, '')
    if (!dir || !stem) continue
    const key = dir.toLowerCase()
    const entry = byDir.get(key) ?? { dir, stems: [] }
    entry.stems.push(stem)
    byDir.set(key, entry)
  }
  for (const { dir, stems } of byDir.values()) {
    const folder = `${dir}/${ROM_ANIMATIONS_FOLDER}`
    try {
      if (!(await exists(folder))) continue
      const names = (await readDir(folder)).filter((e) => e.isFile).map((e) => e.name)
      for (const name of orphanedRomAnimations(names, stems)) {
        try {
          await remove(`${folder}/${name}`)
        } catch {
          // locked/open in Daz — it retires on a later run
        }
      }
    } catch {
      // an unreadable folder is never worth failing a generation over
    }
  }
}

/**
 * Export-folder housekeeping: the definition knows exactly which export
 * folders its layout comprises, so every generation records them
 * ({@link EXPORT_FOLDERS_FILE} in the character's meta folder) and deletes the
 * previously recorded ones that fell OUT of the layout — a renamed/cleared
 * Houdini project folder or a changed scene subfolder must not leave its old
 * export tree behind. Only ever deletes RECORDED folders inside the CURRENT
 * export dir ({@link staleExportFolders} — a changed export dir orphans its
 * folders rather than reaching into a location the character no longer points
 * at), then prunes emptied parent chains. Best effort: a failure here must
 * never fail the generation that triggered it.
 */
async function housekeepExportFolders(
  character: Character,
  metaDirAbs: string,
  scenesRootAbs?: string,
): Promise<void> {
  if (!isTauri()) return
  try {
    const exportDirAbs = character.exportPath.trim()
    const recordPath = joinPath(metaDirAbs, EXPORT_FOLDERS_FILE)
    const recorded = (await exists(recordPath))
      ? parseExportFoldersRecord(await readTextFile(recordPath))
      : null
    if (!exportDirAbs) {
      // Export turned off: nothing may be deleted (the folders are the user's
      // last exports, not stale layout), and the record itself is app data
      // with no referent anymore — drop it.
      if (recorded) await remove(recordPath)
      return
    }
    const expected = expectedSceneExportFolders(character, scenesRootAbs)
    // A stale folder whose delete fails (open in Explorer, permissions) stays
    // in the record, so the next generation retries it instead of forgetting it.
    const leftovers: Array<string> = []
    if (recorded) {
      for (const rel of staleExportFolders(recorded, exportDirAbs, expected)) {
        try {
          const abs = joinPath(exportDirAbs, rel)
          if (await exists(abs)) await remove(abs, { recursive: true })
          // A removed leaf can empty its parents (<proj>/dth-export/) — prune
          // upward until a non-empty (or missing) dir stops the walk.
          const segments = rel.split('/').slice(0, -1)
          while (segments.length > 0) {
            const dir = joinPath(exportDirAbs, segments.join('/'))
            if ((await readDir(dir)).length > 0) break
            await remove(dir)
            segments.pop()
          }
        } catch {
          leftovers.push(rel)
        }
      }
    }
    await storage.writeTextFileAtomic(
      recordPath,
      `${JSON.stringify(
        { version: 1, exportDir: exportDirAbs, folders: [...expected, ...leftovers] },
        null,
        2,
      )}\n`,
    )
  } catch {
    // best effort — never fail generation over housekeeping
  }
}

/**
 * Move a character's root-dwelling linked scene files into their own
 * subfolders — the primary into "primary", extras into sanitized-name folders
 * (the v26 layout; each scene's export nests under that name). Runs from the
 * REFRESH sweep only: physically moving files during a routine save would
 * surprise, and the v26 schema bump flags every pre-v26 character stale, so
 * one Refresh migrates users' whole libraries. Per-move save (repoint scene
 * paths + records + avatar source), so a failure mid-list — e.g. a scene
 * locked by an open Daz — leaves a consistent character behind. Scenes linked
 * outside the character folder or already in a subfolder are left alone.
 * Exported for its focused test (scene-subfolder-migration.test.ts).
 */
export async function ensureSceneSubfolders(
  project: ProjectInfo,
  lib: string,
  character: Character,
  location: storage.CharacterLocation,
): Promise<{ character: Character; moved: number }> {
  if (!character.scenePath) return { character, moved: 0 }
  const charFolder = location.folderAbs
  const primaryDir = dirname(character.scenePath)
  const primaryRel =
    normalizePathLower(primaryDir) === normalizePathLower(charFolder)
      ? ''
      : relativeInside(charFolder, primaryDir)
  // Primary linked outside the character folder — no root to normalize against.
  if (primaryRel === null) return { character, moved: 0 }
  const rootRel = deriveScenesRootRel(primaryRel, project.dazSubdir)
  const rootAbs = rootRel ? joinPath(charFolder, rootRel) : charFolder
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  // Subfolder names already in use below the root — a migrated scene must not
  // move into a sibling's folder (its export would collide there too).
  const taken = new Set<string>()
  for (const scene of linked) {
    const rel = relativeInside(rootAbs, dirname(scene))
    if (rel) taken.add(rel.toLowerCase())
  }
  let current: Character = { ...character }
  let moved = 0
  // The primary is first in `linked`, so it claims "primary" before any extra
  // whose sanitized name happens to be the same word.
  for (const scene of linked) {
    if (normalizePathLower(dirname(scene)) !== normalizePathLower(rootAbs)) continue
    const isPrimary = normalizePathLower(scene) === normalizePathLower(current.scenePath)
    let name = isPrimary
      ? PRIMARY_SCENE_SUBFOLDER
      : suggestSceneSubfolder(scene, character.name)
    if (
      taken.has(name.toLowerCase()) ||
      (!isPrimary && name.toLowerCase() === PRIMARY_SCENE_SUBFOLDER)
    ) {
      let n = 2
      while (taken.has(`${name} (${n})`.toLowerCase())) n += 1
      name = `${name} (${n})`
    }
    taken.add(name.toLowerCase())
    const movedPath = await copyDazScene({
      data: {
        projectId: project.path,
        characterId: current.id,
        scenePath: scene,
        subfolder: [rootRel, name].filter(Boolean).join('/'),
        deleteOriginal: true,
      },
    })
    const target = normalizePathLower(scene)
    const repoint = (p: string) => (normalizePathLower(p) === target ? movedPath : p)
    // Mutating is safe: `current` is either this function's own shallow copy or
    // the fresh object the previous iteration's save returned.
    current.scenePath = repoint(current.scenePath)
    current.extraScenes = current.extraScenes.map(repoint)
    current.imageScene = repoint(current.imageScene)
    current.sceneOverrides = current.sceneOverrides.map((o) => ({
      ...o,
      scenePath: repoint(o.scenePath),
    }))
    const saved = await storage.saveCharacter(project, current, lib)
    cacheCharacterLocation(lib, saved.character.id, saved.location)
    current = saved.character
    moved += 1
  }
  return { character: current, moved }
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

/** A definition saved by a NEWER build than this one — the one recoverable read
 *  problem. A reset re-saves it at the current schema, dropping the newer fields.
 *  In practice only development produces these (a released build only ever sees
 *  the schema move forward). */
export interface TooNewDefinition {
  project: string
  character: string
  path: string
  /** Schema version stored in the file. */
  storedVersion: number
  /** The highest schema version this build understands. */
  supportedVersion: number
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
    /** Forward-version definitions force-downgraded to the current schema (only on
     *  a `resetTooNew` run; the newer fields were dropped). */
    reset: number
    /** Characters whose Daz scripts (ROM/Export) were regenerated. */
    scripts: number
    /** Characters whose PoseAsset CSV was regenerated. */
    csv: number
    /** Stored avatars xBRZ-upscaled to 768² (were smaller — from before the
     *  upscale-on-write feature). Independent of the three regen axes above. */
    avatars: number
    /** Characters whose already-exported files were carried to the current
     *  export ROOT (the export-root move — see `relocateExportRoot`). Reported because
     *  it MOVES the user's gigabytes: silent is the wrong volume for that, and
     *  a run that says nothing about it reads as a run that did nothing. */
    exports: number
  }
  results: Array<RefreshResult>
  /** Definitions saved by a NEWER build, which this build can't read. On a normal
   *  run: every one found (the UI offers to reset them). On a `resetTooNew` run:
   *  only the ones that still couldn't be reset. Empty in the common case. */
  tooNew: Array<TooNewDefinition>
  /** Outcome of force-reinstalling the bundled DTH runtime files (a refresh
   *  always repairs them; null = no DAZ library configured, nothing to copy to). */
  runtime: { ok: boolean; detail?: string } | null
  /** houdini.env wiring: how many configured Houdini docs folders had their
   *  DAZ3D_LIB (re)written this run (0 = all were already current), plus
   *  per-folder failures. Null = prerequisites missing (no Daz library or no
   *  Houdini docs folder configured). */
  houdiniEnv: { updated: number; errors: Array<string> } | null
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
export function refreshAllAssets(
  /** `resetTooNew` force-downgrades definitions saved by a NEWER build back to
   *  this build's schema (dropping the newer fields) instead of reporting them —
   *  the explicit, opt-in recovery for a dev who ran a schema-bump branch.
   *  `rebuildAvatars` (Ctrl+Refresh) re-derives every scene-sourced avatar master
   *  from its scene's pristine tip (see rebuildSceneAvatar) so masters written by
   *  an older upscale pipeline pick up the current one. */
  opts: { resetTooNew?: boolean; rebuildAvatars?: boolean } = {},
): Promise<RefreshSummary> {
  // A full refresh regenerates every stale character across every known
  // project — minutes on large libraries; show the working cursor throughout.
  return withBusyCursor(refreshAllAssetsInner(opts))
}

/** Map `items` through an async `fn` with at most `limit` in flight — for
 *  batches of independent small file reads (per-character runtime probes) that
 *  used to be awaited strictly sequentially. */
async function mapWithConcurrency<T, R>(
  items: Array<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<R>> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Bounded fan-out for the per-character script-runtime reads. */
const RUNTIME_READ_CONCURRENCY = 8

/** Bounded fan-out for the per-character avatar upscales (Rust image work). */
const AVATAR_UPSCALE_CONCURRENCY = 8

async function refreshAllAssetsInner(refreshOpts: {
  resetTooNew?: boolean
  rebuildAvatars?: boolean
}): Promise<RefreshSummary> {
  const settings = await storage.getSettings()
  const hasDazLibrary = Boolean(settings.dazLibraryFolder)
  // houdini.env wiring rides every refresh: existing characters (and machines
  // configured before the feature) get DAZ3D_LIB without touching Settings —
  // effective on the next Houdini restart.
  const houdiniEnv =
    hasDazLibrary && (settings.houdiniDocsFolder.trim() || settings.extraHoudiniDocsFolders.length)
      ? await storage.ensureHoudiniEnvDazLib(settings)
      : null
  const catalog = await fetchPoseAssetsCurrent()
  const activeRelease = catalog.error ? '' : catalog.version
  const opts = {
    hasDazLibrary,
    hasDthRelease: activeRelease !== '',
    dimManifestsFolder: settings.dimManifestsFolder,
  }
  const app = { schema: CHARACTER_SCHEMA_VERSION, runtime: RUNTIME_VERSION, dthRelease: activeRelease }

  // Pass 1 — gather every character with its staleness, so we can tell a targeted
  // refresh (some mismatch → regenerate only what's affected) from a forced full
  // refresh (nothing stale, the user clicked anyway → regenerate everything).
  // Scope follows the window: the active project in a project window, every known
  // project (recents) from the Home window — see sweepTargets. The scan resolves
  // every character's LOCATION once; it's threaded through pass 2 and primed
  // into the session cache so the per-character generate doesn't re-walk the
  // library (the old sweep was O(N²) in library size).
  const { projects, unreachable } = await sweepTargets()
  const results: Array<RefreshResult> = []
  for (const u of unreachable) {
    results.push({ project: u.dir, character: '(project unreachable)', ok: false, detail: u.error })
  }
  const gathered: Array<{
    project: ProjectInfo
    lib: string
    character: Character
    location: storage.CharacterLocation
  }> = []
  // Forward-version files still unreadable at the end (a normal run lists them all;
  // a resetTooNew run keeps only the ones the downgrade couldn't repair).
  const tooNew: Array<TooNewDefinition> = []
  const nameFromPath = (p: string) => basename(p).replace(/\.json$/i, '')
  let resetCount = 0
  for (const project of projects) {
    const lib = charsRoot(project)
    let scan: Awaited<ReturnType<typeof storage.scanCharacterLibrary>>
    try {
      scan = await storage.scanCharacterLibrary(lib)
    } catch (e) {
      results.push({
        project: project.name,
        character: '(project unreachable)',
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
      continue
    }
    for (const problem of scan.problems) {
      // A file saved by a NEWER build is the one recoverable read problem. With
      // resetTooNew, force it down to this build's schema (dropping the newer
      // fields) and fold it back in as a normal character so pass 2 regenerates
      // it. Otherwise it stays a "reset me?" item, NOT a hard failure.
      if (problem.tooNew) {
        if (refreshOpts.resetTooNew) {
          try {
            const { character: reset, location } = await storage.resetDefinitionToCurrentVersion(
              project,
              problem.path,
              lib,
            )
            cacheCharacterLocation(lib, reset.id, location)
            gathered.push({ project, lib, character: reset, location })
            resetCount += 1
            continue
          } catch (e) {
            results.push({
              project: project.name,
              character: `(reset failed) ${nameFromPath(problem.path)}`,
              ok: false,
              detail: `${problem.path} — ${e instanceof Error ? e.message : String(e)}`,
            })
            // Fall through so it's still surfaced as a reset candidate below.
          }
        }
        tooNew.push({
          project: project.name,
          character: nameFromPath(problem.path),
          path: problem.path,
          storedVersion: problem.tooNew.storedVersion,
          supportedVersion: problem.tooNew.supportedVersion,
        })
        continue
      }
      // Genuine corruption (torn write / bad JSON / failed schema) is a character
      // the sweep CANNOT refresh — surface it as a failure, not "all good".
      results.push({
        project: project.name,
        character: `(unreadable) ${basename(problem.path)}`,
        ok: false,
        detail: `${problem.path} — ${problem.reason}`,
      })
    }
    for (const { character, location } of scan.entries) {
      cacheCharacterLocation(lib, character.id, location)
      gathered.push({ project, lib, character, location })
    }
  }

  // The per-character runtime probes are independent small reads — batch them.
  const runtimeInfos = await mapWithConcurrency(gathered, RUNTIME_READ_CONCURRENCY, (g) =>
    hasDazLibrary
      ? storage.readScriptRuntimeInfo(settings.dazLibraryFolder, g.project.name, g.character)
      : Promise.resolve(null),
  )
  const items = gathered.map((g, i) => {
    const status: CharacterAssetStatus = {
      projectId: g.project.path,
      project: g.project.name,
      character: g.character.name,
      schemaVersion: g.character.schemaVersion,
      runtimeVersion: runtimeInfos[i]?.version ?? null,
      generatedDthVersion: g.character.generatedDthVersion,
      hasScene: Boolean(g.character.scenePath),
      scanDimPath: runtimeInfos[i]?.scanDimPath ?? null,
    }
    return { ...g, targets: characterStaleTargets(status, app, opts) }
  })

  const force = !items.some((i) => i.targets.schema || i.targets.runtime || i.targets.csv)

  // Refresh the bundled runtime files — ALWAYS forced past the install marker on
  // this user-initiated path: Refresh is the "repair a deleted/corrupted runtime
  // file" button, and the ~11-file copy is cheap. Deriving `force` from "nothing
  // else stale" made a corrupted root runtime coexisting with any stale character
  // need TWO clicks (the first ran marker-gated, skipped the copy, and still
  // reported `runtime: { ok: true }`). The routine save+generate path
  // (generateCharacterFiles above) keeps the marker skip.
  let runtime: RefreshSummary['runtime'] = null
  if (hasDazLibrary) {
    try {
      await storage.copyRuntimeFiles(storage.studioScriptsDir(settings.dazLibraryFolder), {
        force: true,
      })
      runtime = { ok: true }
    } catch (e) {
      runtime = { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  // Pass 2 — regenerate per character. A schema change regenerates both artifacts
  // (the migration can alter generated output); runtime → Daz scripts; csv → CSV.
  let skipped = 0
  const counts = { migrated: 0, reset: resetCount, scripts: 0, csv: 0, avatars: 0, exports: 0 }
  for (const item of items) {
    const { project, lib, character, targets } = item
    // An export root whose stored path disagrees with its own derivation is a
    // REGEN cause, not a side repair: the relocation rewrites `exportPath`,
    // which the generated .dsa bakes — moving the files without regenerating
    // the scripts would leave every installed script exporting into the
    // vacated old root (recreating it) while the freshness checks watch the
    // new one. No staleness flag describes this (see relocateExportRoot), so
    // it is derived here, from the same compare the migration itself uses.
    const exportRootStale =
      item.location.relFolder !== '' &&
      character.exportPath.trim() !== '' &&
      (() => {
        const derived = characterExportRoot(item.location.folderAbs, project.houdiniSubdir)
        return (
          derived !== '' &&
          normalizePathLower(derived) !==
            normalizePathLower(character.exportPath.trim().replace(/\\/g, '/'))
        )
      })()
    const regenSchema = force || targets.schema
    const regenDaz = force || targets.runtime || targets.schema || exportRootStale
    const regenHoudini = force || targets.csv || targets.schema || exportRootStale
    if (!regenSchema && !regenDaz && !regenHoudini) {
      // Not stale ≠ nothing to do: a character skipped here would keep any
      // old-path internals (e.g. a scene-less one, whose runtime/csv can never
      // read stale) until some other cause regenerated it. The relocation is
      // idempotent and cheap — one readDir when there is nothing to move.
      await relocateCharacterInternals(project.path, item.location, character)
      // The export-root call here is the carry RETRY only — folders a partial
      // move left behind, retained in the record. A repoint routes through the
      // regen path via `exportRootStale` above, so this call never needs to
      // rewrite the definition; the fresh read guards the residual race (an
      // editor save landing since pass 1), because relocateExportRoot saves
      // the exact character object it is handed.
      const freshSkip = await storage.readCharacterAt(item.location.definitionAbs)
      if (freshSkip && freshSkip.id === character.id) {
        const retry = await relocateExportRoot(project, lib, freshSkip, item.location)
        if (retry.repointed || retry.carried) counts.exports += 1
      }
      skipped += 1
      continue
    }
    try {
      // Re-read the definition FRESH immediately before deciding to write: on a
      // big library pass 1's snapshot is minutes old by now, and re-saving it
      // would silently revert any save made in a project window mid-sweep. This
      // narrows the race to the same ms-wide window every other save has.
      let location = item.location
      let fresh = await storage.readCharacterAt(location.definitionAbs)
      if (!fresh || fresh.id !== character.id) {
        // Moved/renamed since pass 1 — re-locate once, then re-read.
        characterLocationCache.delete(`${lib}|${character.id}`)
        const relocated = await storage.getCharacterPath(lib, character.id)
        if (!relocated) {
          throw new Error('The character definition was moved or deleted during the refresh.')
        }
        location = relocated
        cacheCharacterLocation(lib, character.id, relocated)
        fresh = await storage.readCharacterAt(location.definitionAbs)
        if (!fresh || fresh.id !== character.id) {
          throw new Error('The character definition could not be re-read.')
        }
      }
      // A character read at an older schema is already migrated in-memory
      // (parseCharacter); re-saving stamps the current version, clearing the stale
      // state. Independent of the DAZ library. Only save if the FRESH read is
      // still stale — a mid-sweep editor save may have migrated it already.
      if (regenSchema && fresh.schemaVersion < CHARACTER_SCHEMA_VERSION) {
        // BEFORE the save, which strips the pre-v30 product fields: carry them
        // into the character's meta folder. The raw definition on disk is the
        // only place they still exist at this point.
        await carryStoredProductsToMeta(project, location.relFolder, character.id, location.definitionAbs)
        await storage.saveCharacter(project, fresh, lib, { location, character: fresh })
        counts.migrated += 1
      }
      // The EXPORT-ROOT relocation, BEFORE the generation below — which reads
      // the STORED `exportPath` and would otherwise re-emit the old folder into
      // every regenerated script, then stamp the new runtime version on top and
      // leave the character reading as up to date.
      //
      // Unconditional, like the internals relocation: it is triggered by a
      // stored path differing from the derived one, and NO staleness flag
      // describes that. In particular a `RUNTIME_VERSION` bump does not — the
      // refresh clears a stale runtime whether or not anything moved.
      const relocation = await relocateExportRoot(project, lib, fresh, location)
      if (relocation.repointed || relocation.carried) counts.exports += 1
      if (relocation.repointed) {
        fresh = (await storage.readCharacterAt(location.definitionAbs)) ?? fresh
      }
      // Take in anything the Daz product scan left for this character. Refresh is
      // the "bring everything in line" button, and a batch that scanned ten
      // characters would otherwise wait for each one's page to be opened.
      await ingestProductScans(project, location.relFolder, character.id)
      // And drop stored scans for scenes this character no longer links — the
      // same prune every save runs, so Refresh converges the store too.
      await pruneProductScans(project, location.relFolder, character.id, [
        fresh.scenePath,
        ...fresh.extraScenes,
      ])
      // v26 layout migration: move root-dwelling scene files into their
      // per-scene subfolders (primary → "primary", extras → sanitized names).
      // Soft-fails — a scene locked by an open Daz must not fail the whole
      // character's refresh; the export block's stem fallback keeps the old
      // layout working until the next Refresh completes the move.
      let sceneMoveNote: string | undefined
      try {
        const migrated = await ensureSceneSubfolders(project, lib, fresh, location)
        if (migrated.moved > 0) {
          sceneMoveNote = `moved ${migrated.moved} scene${migrated.moved === 1 ? '' : 's'} into subfolders`
        }
      } catch (e) {
        sceneMoveNote = `scene-subfolder migration incomplete (close Daz Studio and refresh again): ${
          e instanceof Error ? e.message : String(e)
        }`
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
      const junctionNote =
        res.sweptJunctions.length > 0
          ? `removed ${res.sweptJunctions.length} leftover dth-exports junction${
              res.sweptJunctions.length === 1 ? '' : 's'
            }`
          : undefined
      // The retired houdini-project folder: removed silently when empty (the
      // normal case — nothing ever wrote there), but a KEPT one is always
      // reported. It holds the user's own output and only they can decide it
      // is disposable, so it must not disappear from the report.
      const projectDirNote =
        res.sweptProjectDirs.length > 0 ? 'removed the empty houdini-project folder' : undefined
      const keptProjectDirNote =
        res.keptProjectDirs.length > 0
          ? `kept houdini-project — it is not empty (${res.keptProjectDirs.join(', ')})`
          : undefined
      // The one-time move of the app's own files into `.dcsmeta` — named
      // because it changes what the user sees in their character folder.
      const internalsNote =
        res.movedInternals.length > 0
          ? `moved ${res.movedInternals.length} app file${
              res.movedInternals.length === 1 ? '' : 's'
            } into .dcsmeta`
          : undefined
      // A partial export-folder move is retried on the next save/Refresh (the
      // failed folders stay in the record), but it must be VISIBLE now — the
      // usual cause is Houdini holding a file open, which only the user can fix.
      const exportMoveNote =
        relocation.leftBehind.length > 0
          ? `${relocation.leftBehind.length} export folder${
              relocation.leftBehind.length === 1 ? '' : 's'
            } couldn't be moved (file in use?) — will retry on the next Refresh`
          : undefined
      results.push({
        project: project.name,
        character: character.name,
        ok: true,
        detail:
          [
            sceneMoveNote,
            exportMoveNote,
            junctionNote,
            projectDirNote,
            keptProjectDirNote,
            internalsNote,
            res.scriptsError,
          ]
            .filter(Boolean)
            .join(' — ') || undefined,
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

  // Upgrade low-res avatars across every gathered character — independent of the
  // regen skip above, since avatar format is its own axis (a character with
  // nothing else stale still carries a 256² avatar from before this feature). xBRZ
  // upscales anything under 768² to 768² IN PLACE; idempotent, native-only,
  // best-effort. Clearing the data-URL cache after makes the UI pick up the new
  // bytes — the filename is unchanged, so nothing re-resolves on its own.
  // With `rebuildAvatars` (Ctrl+Refresh), masters are first re-derived from
  // their pristine source (the stored `.src` sibling, else the source scene's
  // tip) — an already-768² master is a no-op to the plain upscale, so rebuilding
  // is the only way old masters pick up pipeline improvements (e.g.
  // flatten-first). Avatars without a source fall through to the plain upscale.
  if (isTauri() && gathered.length > 0) {
    const touched = await mapWithConcurrency(
      gathered,
      AVATAR_UPSCALE_CONCURRENCY,
      async (g) =>
        (refreshOpts.rebuildAvatars && (await rebuildAvatarMaster(g.project.path, g.character))) ||
        upscaleStoredAvatar(g.project.path, g.character.image),
    )
    counts.avatars = touched.filter(Boolean).length
    if (counts.avatars > 0) clearImageSrcCache()
  }

  const failed = results.filter((r) => !r.ok).length
  return {
    total: results.length,
    regenerated: results.length - failed,
    failed,
    skipped,
    counts,
    results,
    tooNew,
    runtime,
    houdiniEnv,
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
  /** Whether a primary Daz scene is linked. A scene-less character (created
   *  without a scene, editor locked) generates nothing, so its script/CSV can
   *  never be stale — only its schema counts. */
  hasScene: boolean
  /** The DIM manifests folder baked into the script's product-scan block; ''
   *  when the script scans nothing, `null` when no script exists. Compared
   *  against the CURRENT setting — see {@link characterStaleTargets}. */
  scanDimPath: string | null
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

/** Judging opts for {@link characterStaleTargets}: which app-side inputs exist,
 *  plus the CURRENT DIM manifests folder (settings) for the scan-arming check. */
export interface StaleJudgeOpts {
  hasDazLibrary: boolean
  hasDthRelease: boolean
  /** `settings.dimManifestsFolder` — '' when unset. */
  dimManifestsFolder: string
}

/** Path equality the way the scan config compares: trimmed, forward slashes,
 *  case-insensitive (Windows paths). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * Which artifacts are out of date versus what the app now produces:
 *  - `schema`: JSON below CHARACTER_SCHEMA_VERSION.
 *  - `runtime`: script missing or older than RUNTIME_VERSION, or its baked
 *    product-scan arming no longer matches the DIM manifests setting (set after
 *    generation, cleared, or the folder moved — a stale baked path reads a dead
 *    product database and replaces good results with all-unmatched noise).
 *    Judged only when a DAZ library is configured (no library → no scripts).
 *  - `csv`: the CSV's DTH *era* differs from the active release's era — judged only
 *    when a DTH release is configured. Needs NO DAZ library: the CSV and its
 *    provenance live in the project folder / JSON.
 * Shared by detection, the Refresh table, and the selective refresh so all three
 * judge staleness identically.
 */
export function characterStaleTargets(
  c: CharacterAssetStatus,
  app: AssetVersionReport['app'],
  opts: StaleJudgeOpts,
): StaleTargets {
  return {
    schema: c.schemaVersion < app.schema,
    runtime:
      c.hasScene &&
      opts.hasDazLibrary &&
      (c.runtimeVersion === null ||
        c.runtimeVersion < app.runtime ||
        !samePath(c.scanDimPath ?? '', opts.dimManifestsFolder)),
    csv:
      c.hasScene &&
      opts.hasDthRelease &&
      poseAssetCsvEra(c.generatedDthVersion) !== poseAssetCsvEra(app.dthRelease),
  }
}

/** Whether a character is out of date in ANY of its three artifacts. */
export function isCharacterStale(
  c: CharacterAssetStatus,
  app: AssetVersionReport['app'],
  opts: StaleJudgeOpts,
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
  const catalog = await fetchPoseAssetsCurrent()
  const activeRelease = catalog.error ? '' : catalog.version
  const hasDthRelease = activeRelease !== ''
  const app = { schema: CHARACTER_SCHEMA_VERSION, runtime: RUNTIME_VERSION, dthRelease: activeRelease }

  // Scope follows the window: the active project in a project window, every known
  // project (recents) from the Home window — see projectsForSweep.
  const projects = await projectsForSweep()
  const gathered: Array<{ project: ProjectInfo; character: Character }> = []
  for (const project of projects) {
    let chars: Array<Character>
    try {
      chars = await storage.listCharacters(charsRoot(project))
    } catch {
      continue // unreachable project — an actual refresh run surfaces the error
    }
    for (const character of chars) gathered.push({ project, character })
  }
  // Independent small reads — batched (the sequential awaits dominated big libraries).
  const runtimeInfos = await mapWithConcurrency(gathered, RUNTIME_READ_CONCURRENCY, (g) =>
    hasDazLibrary
      ? storage.readScriptRuntimeInfo(settings.dazLibraryFolder, g.project.name, g.character)
      : Promise.resolve(null),
  )
  const characters: Array<CharacterAssetStatus> = gathered.map((g, i) => ({
    projectId: g.project.path,
    project: g.project.name,
    character: g.character.name,
    schemaVersion: g.character.schemaVersion,
    runtimeVersion: runtimeInfos[i]?.version ?? null,
    generatedDthVersion: g.character.generatedDthVersion,
    hasScene: Boolean(g.character.scenePath),
    scanDimPath: runtimeInfos[i]?.scanDimPath ?? null,
  }))

  const staleCount = characters.filter((c) =>
    isCharacterStale(c, app, {
      hasDazLibrary,
      hasDthRelease,
      dimManifestsFolder: settings.dimManifestsFolder,
    }),
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
