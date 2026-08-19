import { exporterFigureName, poseAssetFileName, referenceFrames, toPoseAssetCsv } from './csv'
import { ROM_ANIMATIONS_FOLDER, romAnimationPath } from './rom-animation'
import {
  commentSafe,
  dazJson,
  figureAutoSelectSnippet,
  groomSceneLookupSnippet,
  hideTreeSnippet,
  indentLines,
  openSceneFileSnippet,
  sceneConfigLookupSnippet,
  sceneGuardSnippet,
  sceneCsvLookupSnippet,
  sceneExportSubfolderSnippet,
  romAnimationSourceSnippet,
} from './dz-snippets'

/** The hidden per-character BULK script the DTH Character Studio Runner
 *  executes on job-file runs (the studio's DTH Export button): always builds
 *  the ROM and always exports — skeleton/mesh AND every hair asset — no
 *  matter the manual-run toggles. Dot-prefixed so Daz's Content Library never
 *  shows it (docs/exporter-plugin-job-file.md). */
export const BULK_ROM_EXPORT_SCRIPT = '.Bulk_ROM_Export.dsa'
/** The hidden per-character ROM-ONLY script ("Open and Generate ROM
 *  Animation" on a scene card): builds the ROM and saves the reopenable
 *  `rom-animations/<stem>_ROM.duf` copy (runtime v42), but never exports —
 *  the mirror image of {@link BULK_ROM_EXPORT_SCRIPT}, which forces the
 *  export ON. Dot-prefixed so Daz's Content Library never shows it. */
export const BUILD_ROM_ANIMATION_SCRIPT = '.Build_ROM_Animation.dsa'
/** The hidden per-character EXPORT-ONLY script (DTH Export's "Export only"
 *  mode): runs the exporter + hair pass on the ROM already on the timeline —
 *  no rebuild. Its job rows open the SAVED ROM animation
 *  ({@link romAnimationPath}) rather than the source scene, which the embedded
 *  {@link romAnimationSourceMap} maps back so every scene-keyed lookup still
 *  resolves. Dot-prefixed so Daz's Content Library never shows it. */
export const BULK_EXPORT_ONLY_SCRIPT = '.Bulk_Export_Only.dsa'

/**
 * The saved-ROM-animation folder + path rule. Defined in `rom-animation.ts` —
 * an import-free leaf, so node-side tooling (the smoke fixtures) can reach the
 * real rule instead of restating it — and re-exported here, where generation
 * and every existing consumer already look for it.
 */
export { LEGACY_ROM_ANIMATIONS_FOLDER, ROM_ANIMATIONS_FOLDER, romAnimationPath } from './rom-animation'

/**
 * The saved ROM animations in one `rom-animations` folder that no longer belong
 * to any scene — the files to retire.
 *
 * A ROM animation is named after its SOURCE SCENE's stem (`<stem>_ROM.duf`),
 * so renaming a scene doesn't rename its ROM animation: the next run simply
 * writes a new one beside the old, and the old lingers forever. Daz saves two
 * thumbnails alongside each (`<name>.duf.png`, `<name>.tip.png`), so an orphan
 * is three files, not one.
 *
 * `fileNames` is the folder's listing, `expectedStems` the stems of the scenes
 * that actually live beside it (usually one; two scenes CAN share a folder).
 * Only files this studio writes are ever named — anything not matching
 * `<stem>_ROM.<ext>` is left alone, because the folder is the user's to keep
 * things in. Case-insensitive: Windows.
 */
export function orphanedRomAnimations(
  fileNames: ReadonlyArray<string>,
  expectedStems: ReadonlyArray<string>,
): Array<string> {
  const keep = new Set(expectedStems.map((stem) => stem.toLowerCase()))
  return fileNames.filter((name) => {
    // The base is everything up to the `_ROM` that ends the stem, judged
    // against the extension dot AFTER it — a scene stem may itself contain
    // dots ({@link romAnimationPath} stems on the LAST dot: "Kira.v2.duf" →
    // "Kira.v2_ROM.duf"), so slicing at the FIRST dot made every dotted
    // stem's ROM animation invisible to this sweep forever. Greedy, so a stem
    // that itself ends in "_ROM.something" still resolves to the outermost
    // marker.
    const match = /^(.*_rom)(\.|$)/i.exec(name)
    if (!match) return false
    const base = match[1]
    return !keep.has(base.slice(0, -'_ROM'.length).toLowerCase())
  })
}

/**
 * Normalized ROM-animation path → the linked scene it was built from, for every
 * linked scene. Embedded in each generated script so a run on a SAVED ROM
 * animation (DTH Export's "Export only" mode opens those, not the source
 * scenes) resolves its scene-keyed lookups — the wrong-scene guard, the
 * per-scene config delta, the hair list, the export subfolder, the CSV pick —
 * as the source scene, which is what the ROM animation is: that scene with the
 * ROM baked onto its timeline.
 */
export function romAnimationSourceMap(
  character: Pick<Character, 'scenePath' | 'extraScenes'>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const scene of [character.scenePath, ...character.extraScenes]) {
    const clean = scene.trim().replace(/\\/g, '/')
    if (clean === '') continue
    map[romAnimationPath(clean).toLowerCase()] = clean
  }
  return map
}
import { flattenRom, jcmIsBaseRom, presetSelections } from './frames'
import {
  activeSceneOverrides,
  mergeSceneOverride,
  sceneHairExportEnabled,
  sceneOverrideBuildsRom,
  sceneOverrideSlug,
} from './scene-override'
import {
  characterSkinning,
  characterSlug,
  GENERATIONS,
  jcmMorphModForRuntime,
  poseAssetCsvEra,
  RUNTIME_VERSION,
} from './types'

import type { GeneratedFile } from './csv'
import type { PresetFrames } from './frames'
import type { RomPaths } from './resolve'
import type { ArtDirectionFrame, Character, Morph } from './types'

/**
 * The `.dsa` generators: the ROM script, the standalone Export script, the
 * groom (hair) export, the product scan (plus the Runner's hidden bulk
 * carriers, which are the same builders in their `bulk` shape) — plus the
 * generateAll entry point that pairs them with the
 * PoseAsset CSV (csv.ts). Formats are taken from real files in
 * soltude/DazToHue-Scripts (ElectraG9_FBMs.json / .csv, DthWorkflowElectraG9.dsa)
 * and from the PoseAsset node CSV sample provided by mrpdean. Catalog/path
 * resolution lives in resolve.ts; reusable DzScript text in dz-snippets.ts.
 */

/**
 * Drop trailing '/' separators — the LINEAR form, and the only one this repo
 * uses.
 *
 * The obvious `p.replace(/\/+$/, '')` is a polynomial-backtracking regex
 * (CodeQL `js/polynomial-redos`, high): on a string of many slashes the engine
 * retries every split of the `+` against the anchor. These paths come from
 * stored character/settings data rather than literals, which is what makes it
 * an alert rather than a curiosity. `endsWith`/`slice` needs no backtracking.
 *
 * Written once here because the regex form has now been reintroduced twice
 * after being fixed — see `.ai/gotchas.md`.
 */
export function stripTrailingSlashes(path: string): string {
  let out = path
  while (out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/**
 * One morph as the runtime reads it: node/prop/value, nothing else. The
 * sawtooth floor is ALWAYS 0 since schema v34 / runtime v82 — the retired
 * `base`/`autoBase` floors could never export correctly (the DTH Exporter's
 * FBX pass excludes varying-keyed morphs from the base mesh, so a non-zero
 * floor made the Alembic and FBX bases drift apart; measured 2026-08-17).
 * A walked morph that is dialed non-zero at frame 0 now FAILS its frame in
 * the runtime instead (`checkDialedWalkedMorphs`, DthUtils.dsa).
 */
function morphJson(morph: Morph) {
  return {
    node: morph.node,
    prop: morph.prop,
    value: morph.value,
  }
}

/**
 * The extra-ROM-frame payload (meta + frames + optional groups) emitted as the
 * inline `config.extraFrames` of the single-file character script. Frames are
 * 0-based offsets from ROM start (first custom frame = 0; a ROM block reserves
 * its full frame count and the next section starts after it).
 */
export function buildFbmData(character: Character) {
  const flat = flattenRom(character.sections)

  // Groups with a non-individual generation method need a differently shaped
  // timeline (sustained keys instead of sawtooth) — emitted as an optional
  // `groups` array that DthUtils honors. Individual/default groups are
  // omitted entirely, keeping the format backward compatible.
  const groupRanges = new Map<string, { start: number; end: number; frame: (typeof flat)[0] }>()
  for (const frame of flat) {
    const range = groupRanges.get(frame.group.id)
    if (range) range.end = frame.frame
    else groupRanges.set(frame.group.id, { start: frame.frame, end: frame.frame, frame })
  }
  const groups = [...groupRanges.values()]
    .filter(({ frame }) => !['default', 'individual'].includes(frame.group.method))
    .map(({ start, end, frame }) => ({
      section: frame.section,
      name: frame.group.label || frame.name,
      method: frame.group.method,
      startFrame: start,
      endFrame: end,
    }))

  return {
    meta: {
      version: '1.0',
      description: `${character.name} Full Body Morphs - relative frame offsets from ROM start`,
    },
    frames: flat.map((frame) => ({
      frame: frame.frame,
      section: frame.section,
      name: frame.name,
      morphs: frame.morphs.map(morphJson),
    })),
    ...(groups.length > 0 ? { groups } : {}),
  }
}

/**
 * Per-character art-direction payload for a pre-made ROM block — the pre-made
 * GP/DK ROM frames (same shape as DazToHue-Scripts' GP9_ArtDirection.json /
 * DK9_ArtDirection.json), emitted inline as `config.gpArtDirection` /
 * `config.dkArtDirection` of the character script. Returns null when the
 * character has no art-direction morphs for that ROM.
 */
export function buildArtDirectionData(
  character: Character,
  rom: 'gp' | 'dk',
  section: 'GP9' | 'DK9',
  label: string,
  /** Measured length of this ROM block (PresetFrames.gp / .dk). Entries whose
   *  relative offset falls at or beyond it are DROPPED — the runtime would
   *  otherwise stamp their morphs at `startFrame + frame`, landing in the
   *  custom-frame range and corrupting a custom pose's exported deltas while the
   *  CSV still labels that frame as the custom pose. Undefined ⇒ unbounded (the
   *  pure/web path has no measurement and the runtime fails loud anyway). */
  blockLength?: number,
) {
  const frames = character.sections.GEN.artDirection
    .filter(
      (frame): frame is ArtDirectionFrame =>
        frame.rom === rom &&
        frame.morphs.length > 0 &&
        (blockLength === undefined || frame.frame < blockLength),
    )
    .sort((a, b) => a.frame - b.frame)
  if (frames.length === 0) return null
  return {
    meta: {
      version: '1.0',
      description: `${character.name} ${label} art direction - relative offsets from the ${section} ROM start`,
    },
    frames: frames.map((frame) => ({
      frame: frame.frame,
      section,
      name: frame.name,
      morphs: frame.morphs.map(morphJson),
    })),
  }
}

/**
 * File base name for the self-contained character script: `<Name>_<Genesis>`.
 * The optional `sceneSlug` yields the old `<Name>_<Genesis>_<Scene>` form that
 * per-scene ROM scripts used before the one-script model — kept only so the web
 * layer can name the legacy scene scripts it sweeps away (they are no longer
 * generated; the one script now selects the open scene's override at run time).
 */
export function characterScriptName(character: Character, sceneSlug?: string): string {
  return `${characterSlug(character)}_${character.genesis}${sceneSlug ? `_${sceneSlug}` : ''}`
}

/** File name of the ROM run log the generated Daz script writes into the
 *  character's `.dcsmeta` folder (fixed name — the studio reads it back there to
 *  surface errors, then deletes it). */
export const ROM_RUN_LOG_FILE = 'dth_rom_run_log.json'

/**
 * The INTERRUPT flag: its mere existence in the character's `.dcsmeta` folder
 * means "stop this character's export run at the next point where stopping is
 * safe".
 *
 * A file, for the same reason the whole Daz handoff is a file: nothing in this
 * pipeline can be signalled any other way. The studio drives Daz through a
 * plugin that watches the filesystem and Houdini through a headless hython it
 * spawned — neither has a channel back, and the DTH Exporter's and the HDA's
 * own export calls are synchronous and un-interruptible from outside. So the
 * two runtimes that DO belong to the studio (the generated `.dsa` carriers +
 * the DTH runtime, and `456.py`) poll for this one flag at every boundary
 * where abandoning the work leaves nothing half-written, and stop there.
 *
 * Per CHARACTER, not per app: two windows can be exporting two characters at
 * once, and interrupting one must not reach into the other. It lives beside
 * the run log ({@link ROM_RUN_LOG_FILE}) because both are app-written
 * per-character run state, and the generated scripts already carry that folder.
 *
 * The studio owns its lifetime and deletes it at every handoff and at every
 * run end — a leftover flag would silently skip runs, which is why every
 * runtime that honours it also says so loudly (run log + progress log + the
 * console), never just returns.
 */
export const EXPORT_CANCEL_FILE = '.dth_export_cancel'

/** The interrupt flag's absolute path for a character's meta folder — '' when
 *  there is none (a pure/web context with no filesystem behind it), which every
 *  consumer reads as "this script cannot be interrupted". ONE rule, so the
 *  studio's writer and the generated scripts' probe can never look at different
 *  files. */
export function cancelFlagPath(metaDirAbs?: string): string {
  return metaDirAbs ? `${metaDirAbs.replace(/\\/g, '/')}/${EXPORT_CANCEL_FILE}` : ''
}

/**
 * The per-item hair (groom) export loop — the heart of the Export_Hair flow,
 * shared verbatim by the standalone `Export_Hair_…` script — the visible
 * carrier — and the inline pass the bulk carriers put behind the main export.
 * For every label in `dthGroomLabels` it hides every OTHER wearable (the item
 * stays fitted), selects the figure, runs the exporter's documented
 * `doExportAlembicGroomPoses(path, name, false)` (a 2-arg call crashes Daz —
 * ALWAYS pass false) and restores the exact flags. Expects `dthGroomLabels` and
 * `dthExportDir` in scope; the figure / exporter-action / hide-tree variable
 * NAMES are parameterised so each host script keeps its own. Base indent 0;
 * `dthHx…` locals so it can sit inside blocks that already used the generic
 * loop names.
 */
function hairExportLoopSnippet(
  character: Character,
  v: { fig: string; action: string; hideTree: string; hidden: string },
): string {
  return `// Filename-safe slug for a hair item label (same rule as characterSlug).
function dthHairSlug(s) {
    var out = "";
    for (var dthSi = 0; dthSi < s.length; dthSi++) {
        var dthC = s.charAt(dthSi);
        if ((dthC >= "A" && dthC <= "Z") || (dthC >= "a" && dthC <= "z") || (dthC >= "0" && dthC <= "9") || dthC == "_") out += dthC;
    }
    return out || "Hair";
}
// Export EACH hair item ON ITS OWN: keep only that item (+ the Genesis
// body-part figures) fitted, HIDE every other wearable INCLUDING the other
// hair items (plugin 2.0+ skips hidden nodes), export as "<Name>_Hair_<item>",
// restore the exact flags — repeat per item.
for (var dthHxI = 0; dthHxI < dthGroomLabels.length; dthHxI++) {
    var dthKeepLabel = dthGroomLabels[dthHxI];
    ${v.hidden} = [];
    for (var dthHxN = 0; dthHxN < Scene.getNumNodes(); dthHxN++) {
        var dthHxNode = Scene.getNode(dthHxN);
        if (!dthHxNode || typeof dthHxNode.getFollowTarget != "function") continue;
        var dthHxT = dthHxNode.getFollowTarget();
        if (!dthHxT || String(dthHxT.getLabel()) != String(${v.fig}.getLabel())) continue;
        var dthHxLabel = String(dthHxNode.getLabel());
        // Keep the body-part figures (eyes/mouth/tear ride with the body)
        // and THIS hair item; hide everything else.
        if (dthHxLabel.indexOf("Genesis") == 0 || dthHxLabel == dthKeepLabel) continue;
        ${v.hideTree}(dthHxNode);
    }
    Scene.selectAllNodes(false);
    ${v.fig}.select(true);
    Scene.setPrimarySelection(${v.fig});
    try {
        var dthHairName = ${dazJson(`${characterSlug(character)}_Hair_`)} + dthHairSlug(dthKeepLabel);
        ${v.action}.doExportAlembicGroomPoses(dthExportDir, dthHairName, false);
        print("Hair exported: " + dthKeepLabel + " -> " + dthHairName);
    } finally {
        for (var dthHxR = 0; dthHxR < ${v.hidden}.length; dthHxR++) {
            try { ${v.hidden}[dthHxR].setVisible(true); } catch (eR) {}
        }
    }
}
print("Hair items exported: " + dthGroomLabels.length);
`
}

/**
 * The DTH-Exporter run + PoseAsset-CSV delivery, as a Daz Script block. Pure
 * native Daz API (no DTH runtime needed), so it works both appended to the ROM
 * script and as the body of a standalone Export script. Empty when no export dir
 * is set. The CSV copy is included only when the source folder is known
 * (`metaDirAbs`); the export ALWAYS nests under the open scene's own subfolder
 * ({@link sceneExportSubfolders} — resolved by the embedded map at run time).
 * The Export_Hair per-item pass rides right after the main export (same action,
 * same resolved dir) when `hairPass` is on — which is the Runner's hidden bulk
 * carriers only. The visible scripts keep hair in its own `Export_Hair_…`.
 */
function buildExportBlock(
  character: Character,
  frames: PresetFrames | undefined,
  /** The character's app-internal folder in the project's `.dcsmeta` — where the
   *  studio keeps the generated PoseAsset CSV(s) this block delivers (and where
   *  the run log below is written). Host-resolved; undefined in pure/web
   *  contexts, which drops the copy. */
  metaDirAbs: string | undefined,
  /** Scene → PoseAsset-CSV-name lookup: the ROM-override scenes whose delivered
   *  CSV is the scene-suffixed one. Empty ⇒ every scene rides the base CSV. */
  sceneCsvMap: Record<string, string> = {},
  /** The character's scenes-root folder (host-resolved) — see
   *  {@link sceneExportSubfolders}. Omitted ⇒ stem-per-scene fallback. */
  scenesRootAbs?: string,
  /**
   * This block is going into a script the RUNNER executes unattended (the
   * hidden bulk carriers). A modal dialog there does not warn anybody — it
   * blocks the batch on a click nobody is present to make, and every remaining
   * scene waits behind it. Unattended alerts therefore print only.
   */
  unattended = false,
  /**
   * Project-relative replacement for the export ROOT in bone-scale
   * reference-skeleton paths (e.g. `$HIP/daz-export`) — the HOST
   * computes it from where the linked `.hip`s live relative to the export
   * root (project "Houdini path style"); this pure core can't see the
   * filesystem, so it obeys, whatever variable the host anchors on. Empty =
   * absolute paths, the always-safe form.
   */
  hipRefPrefix = '',
  /** Per-scene preset-block frames for ROM-override scenes (the same map the
   *  per-scene CSVs are sized by) — the reference-skeleton frames below must
   *  follow the OPEN scene's merged walk, like the CSV it is delivered with. */
  sceneFrames: Record<string, PresetFrames> = {},
  /** Percents the block's steps report to the verbose progress log
   *  (`dthProgressLog` — the carrier emits the appender): the job row's step
   *  scale, e.g. 60/80/100 inside the 5-step bulk ROM+export, plus `begin` =
   *  the percent already reached when the block starts (start markers reuse
   *  the reached percents so the meter never runs ahead). Omitted = the
   *  block logs no progress (manual/legacy carriers). */
  progressPcts?: { begin: number; character: number; csv: number; hair: number },
  /**
   * Inline the Export_Hair per-item pass behind the main export. TRUE only for
   * the Runner's hidden bulk carriers, which must do the whole job in one
   * unattended pass. The VISIBLE scripts never inline it — hair is its own
   * `Export_Hair_…` script there, which is the whole point of the three-script
   * split. (Even when inlined the pass still obeys the per-scene "Export hair
   * items" switch at run time; this only decides whether it ships at all.)
   */
  hairPass = false,
): string {
  const exportDir = character.exportPath.trim()
  if (!exportDir) return ''
  const refFrames = frames ? referenceFrames(character, frames).join(' ') : ''
  // Reference-skeleton frames PER ROM-override scene: those scenes' CSVs bake
  // their bone-scale `_frame_<N>.fbx` paths from the MERGED walk, so telling
  // the exporter the base list would write FBXs the override CSV never
  // references while the frames it does reference are never written — the
  // HDA then imports a wrong or missing reference skeleton. Same scene set
  // and key normalization as {@link buildSceneCsvMap}.
  const refFramesByScene: Record<string, string> = {}
  for (const override of activeSceneOverrides(character)) {
    if (!sceneOverrideBuildsRom(character, override)) continue
    const key = override.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    if (key === '') continue
    const sceneWalk = sceneFrames[key] ?? frames
    if (!sceneWalk) continue
    const merged = referenceFrames(mergeSceneOverride(character, override), sceneWalk).join(' ')
    if (merged !== refFrames) refFramesByScene[key] = merged
  }
  const refFramesBlock =
    Object.keys(refFramesByScene).length === 0
      ? `    var dthRefFrames = ${dazJson(refFrames)};`
      : `    var dthRefFrames = ${dazJson(refFrames)};
    var dthRefFramesByScene = ${dazJson(refFramesByScene, 2)};
    var dthRefFramesKey = dthOpenSceneFile.split("\\\\").join("/").toLowerCase();
    if (dthRefFramesByScene[dthRefFramesKey] != undefined) dthRefFrames = dthRefFramesByScene[dthRefFramesKey];`
  // ONE snippet body shared with the groom export (dz-snippets), re-indented to
  // this block's 4-space base — the two copies used to differ only in indent.
  // The exporterFigureName base makes the snippet also declare dthExportName:
  // the doExport name, suffixed with the capitalized scene subfolder so each
  // scene's files carry their scene ("Kira_Summertide") instead of every
  // subfolder holding an identically-named "Kira" — except the PRIMARY scene,
  // whose files keep the bare name ("Kira", never "Kira_Primary").
  const sceneSubfolderBlock = indentLines(
    sceneExportSubfolderSnippet(
      sceneExportSubfolders(character, scenesRootAbs),
      {
        base: exporterFigureName(character),
        primarySceneKey: character.scenePath.trim().replace(/\\/g, '/').toLowerCase(),
      },
    ),
  )
  // The CSV to deliver: the base name, or — when some linked scene overrides the
  // ROM — the open scene's scene-suffixed CSV, resolved at run time. Kept
  // self-contained (declares its own dthCsvScene) so the block works both
  // appended to the ROM script and as the standalone Export_ script.
  const csvNameBlock =
    Object.keys(sceneCsvMap).length === 0
      ? `    var dthCsvName = ${dazJson(poseAssetFileName(character))};`
      : indentLines(sceneCsvLookupSnippet(poseAssetFileName(character), sceneCsvMap).trimEnd())
  // Bone-scale reference paths are written either absolute (dthExportDir as
  // resolved at run time) or project-relative via the host-computed prefix —
  // e.g. `$JOB/houdini/daz-export`, valid because `$JOB` is the character folder
  // and the layout below it is fixed. The swap is a
  // prefix exchange on the export ROOT, so whatever scene subfolder this run
  // resolved rides along untouched; an export dir that somehow isn't under
  // the root keeps the absolute path rather than producing a wrong one.
  const refDirBlock = hipRefPrefix
    ? `    var dthRefRootAbs = ${dazJson(exportDir.replace(/\\/g, '/'))};
    var dthRefDir = dthExportDir;
    if (dthExportDir.indexOf(dthRefRootAbs) === 0) {
        dthRefDir = ${dazJson(hipRefPrefix)} + dthExportDir.substr(dthRefRootAbs.length);
    }`
    : `    var dthRefDir = dthExportDir;`
  const csvCopyBlock = metaDirAbs
    ? `    // Copy the generated PoseAsset CSV next to the exporter output, resolving
    // the {{DTH_EXPORT_DIR}} + {{DTH_EXPORT_NAME}} tokens in any bone-scale
    // reference-FBX path to the export dir and figure name — the dir and name
    // (scene subfolder included) are only known now. Source is left intact
    // so the next scene's export can reuse it.
${csvNameBlock}
${refDirBlock}
    var dthCsvSrcDir = new DzDir(${dazJson(metaDirAbs.replace(/\\/g, '/'))});
    if (dthCsvSrcDir.exists(dthCsvName)) {
        var dthCsvDstDir = new DzDir(dthExportDir);
        if (!dthCsvDstDir.exists()) dthCsvDstDir.mkpath(dthExportDir);
        // Delivered under the export set's own base name (dthExportName — the
        // same scene-suffixed base as the .abc/.dth/.fbx beside it), so one
        // folder never mixes naming patterns. The SOURCE CSV in the studio's
        // own .dcsmeta folder keeps its studio name.
        var dthCsvDstName = dthExportName + "_pose_asset.csv";
        var dthCsvDst = dthCsvDstDir.absoluteFilePath(dthCsvDstName);
        var dthCsvSrc = new DzFile(dthCsvSrcDir.absoluteFilePath(dthCsvName));
        if (dthCsvSrc.open(dthCsvSrc.ReadOnly)) {
            var dthCsvText = String(dthCsvSrc.read());
            dthCsvSrc.close();
            dthCsvText = dthCsvText.split("{{DTH_EXPORT_DIR}}").join(dthRefDir);
            dthCsvText = dthCsvText.split("{{DTH_EXPORT_NAME}}").join(dthExportName);
            var dthCsvOut = new DzFile(dthCsvDst);
            if (dthCsvOut.open(dthCsvOut.WriteOnly | dthCsvOut.Truncate)) {
                dthCsvOut.write(dthCsvText);
                dthCsvOut.close();
                print("Copied " + dthCsvName + " to " + dthCsvDst);
            } else dthExportAlert("The PoseAsset CSV could not be written to " + dthCsvDst + " - the Houdini import for this scene has no CSV until the export is re-run.");
        } else dthExportAlert("The PoseAsset CSV " + dthCsvName + " could not be read for delivery - the Houdini import for this scene has no CSV until the export is re-run.");
    } else {
        // Unusual but historically tolerated (a hand-cleaned .dcsmeta) — logged
        // so the studio's report shows it, no modal: the export itself succeeded
        // and DTH Export's delivered-CSV freshness check also flags it.
        print("PoseAsset CSV not found in " + ${dazJson(metaDirAbs.replace(/\\/g, '/'))} + " - nothing to copy.");
        dthExportLogProblem("The PoseAsset CSV " + dthCsvName + " was not found in the studio's data folder - save the character in DTH Character Studio to regenerate it, then re-run the export.");
    }
`
    : ''
  // Clear THIS set's previous output before the exporter runs. Measured
  // 2026-08-11 (DS4 exporter plugin 2.0.2, DS 4.24): a scripted doExport whose
  // output files already exist SKIPS the per-frame ROM walk and rewrites them
  // as a single static frame — fresh mtimes, rest-pose content, no error
  // anywhere (26 s and an 8 MB Alembic against the same scene's 3.5 min and
  // 332 MB into an empty folder). Deleting the old set first forces the real
  // walk; DS6 never skipped, and a fresh set also stops stale files (a renamed
  // hair item's grooms, a changed frame layout's reference skeletons)
  // lingering beside it. Only the set's OWN name patterns are removed —
  // anything else in the folder (a user's zip, another scene's set) is not
  // ours to touch. DzFile.remove + DzDir.entryList are the runtime's own
  // DS4-proven idioms (DthProducts.dsa).
  const clearPreviousSetBlock = `    // Runtime v85: the sweep MOVES the previous set aside (".dthprev" suffix)
    // instead of deleting it. The DS4 skip-guard above only needs the expected
    // output NAMES absent before doExport; deleting outright meant a run that
    // failed AFTER this sweep — an exporter exception, a plugin refusal — left
    // the set's folder EMPTY (measured 2026-08-18: a failed re-export deleted
    // the primary set, and the Houdini project's auto-loading PoseAsset CSV
    // with it). dthFinishPreviousSet below gives the set back on failure and
    // drops the backups on success. DzDir.rename is capability-gated (its
    // presence is unmeasured on DS4): where it is missing or refuses, the old
    // destructive remove keeps the skip-guard intact — no worse than before.
    var dthPrevSuffix = ".dthprev";
    var dthOwnSetFile = function (dthName) {
        return dthName == dthExportName + ".dth" ||
            dthName == dthExportName + ".abc" ||
            dthName == dthExportName + ".fbx" ||
            dthName == dthExportName + "_base.fbx" ||
            dthName == dthExportName + "_experimental_rom.fbx" ||
            dthName == dthExportName + "_pose_asset.csv" ||
            (dthName.indexOf(dthExportName + "_Hair_") == 0 && dthName.indexOf("_grooms.abc") > 0);
    };
    var dthMoveAside = function (dthDirObj, dthName) {
        var dthPrevName = dthName + dthPrevSuffix;
        // A backup a FAILED run left behind is superseded the moment a live
        // file exists again - the live file is the newer good state.
        if (dthDirObj.exists(dthPrevName)) new DzFile(dthDirObj.absoluteFilePath(dthPrevName)).remove();
        if (typeof dthDirObj.rename == "function" && dthDirObj.rename(dthName, dthPrevName)) return true;
        return new DzFile(dthDirObj.absoluteFilePath(dthName)).remove();
    };
    // Success => purge this set's backups; failure => delete partial new
    // output and rename the backups back. Only THIS set's names are touched.
    var dthFinishPreviousSet = function (dthDirObj, dthRestore) {
        if (!dthDirObj.exists()) return;
        var dthNames = dthDirObj.entryList();
        for (var dthFi = 0; dthFi < dthNames.length; dthFi++) {
            var dthPrevName = String(dthNames[dthFi]);
            var dthCut = dthPrevName.length - dthPrevSuffix.length;
            if (dthCut <= 0 || dthPrevName.substring(dthCut) != dthPrevSuffix) continue;
            var dthLiveName = dthPrevName.substring(0, dthCut);
            if (dthLiveName.indexOf(dthExportName) != 0) continue;
            if (dthRestore) {
                if (dthDirObj.exists(dthLiveName)) new DzFile(dthDirObj.absoluteFilePath(dthLiveName)).remove();
                if (typeof dthDirObj.rename == "function") dthDirObj.rename(dthPrevName, dthLiveName);
            } else {
                new DzFile(dthDirObj.absoluteFilePath(dthPrevName)).remove();
            }
        }
    };
    var dthOldSetDir = new DzDir(dthExportDir);
    var dthOldRefDir = new DzDir(dthExportDir + "/Reference Skeletons");
    if (dthOldSetDir.exists()) {
        var dthOldNames = dthOldSetDir.entryList();
        var dthCleared = 0;
        for (var dthCi = 0; dthCi < dthOldNames.length; dthCi++) {
            var dthOldName = String(dthOldNames[dthCi]);
            if (!dthOwnSetFile(dthOldName)) continue;
            if (dthMoveAside(dthOldSetDir, dthOldName)) dthCleared++;
        }
        if (dthOldRefDir.exists()) {
            var dthOldRefs = dthOldRefDir.entryList();
            for (var dthCr = 0; dthCr < dthOldRefs.length; dthCr++) {
                var dthOldRef = String(dthOldRefs[dthCr]);
                if (dthOldRef.indexOf(dthExportName + "_frame_") != 0) continue;
                if (dthMoveAside(dthOldRefDir, dthOldRef)) dthCleared++;
            }
        }
        if (dthCleared > 0) print("Moved " + dthCleared + " previous export file(s) aside in " + dthExportDir);
    }`
  // The export call + CSV delivery. With groom items listed it is wrapped in the
  // hide bracket below; without any, the emitted script is unchanged. The name
  // is the run-time dthExportName (scene-suffixed), never the bare base name;
  // the reference frames are the OPEN scene's (see refFramesBlock above).
  const exportCore = `${clearPreviousSetBlock}
${refFramesBlock}${
    // Start markers carry the percent ALREADY reached — the meter must not
    // jump ahead of finished work, only the status text moves.
    progressPcts ? `\n    dthProgressLog(${progressPcts.begin}, "exporting character");` : ''
  }
    try {
        dthExportAction.doExport(dthExportDir, dthExportName, dthRefFrames, false);
    } catch (dthExpErr) {
        dthExportThrew = dthExpErr;
    }
    // The exporter's own primary output landing is the success signal — its
    // return value is deliberately not read (every Daz build disagrees about
    // return values; same posture as the scene save-as above). Success drops
    // the backups the sweep took; failure deletes any partial new output and
    // puts the previous set back, so a failed run never costs the last good
    // export (measured 2026-08-18: it used to leave the folder empty).
    dthExportLanded = dthExportThrew === null && new DzFile(dthOldSetDir.absoluteFilePath(dthExportName + ".dth")).exists();
    dthFinishPreviousSet(dthOldSetDir, !dthExportLanded);
    dthFinishPreviousSet(dthOldRefDir, !dthExportLanded);
    if (dthExportThrew !== null) throw dthExportThrew;
    if (!dthExportLanded) {
        dthExportAlert("The DTH Exporter produced no " + dthExportName + ".dth - the previous export files were put back untouched.\\n\\nCheck Daz's log for the exporter's own error, then run the export again.");
    } else {${
      progressPcts ? `\n        dthProgressLog(${progressPcts.character}, "character exported");` : ''
    }${
      progressPcts && csvCopyBlock.trim()
        ? `\n        dthProgressLog(${progressPcts.character}, "delivering PoseAsset CSV");`
        : ''
    }
${indentLines(csvCopyBlock)}${
      progressPcts && csvCopyBlock.trim()
        ? `\n        dthProgressLog(${progressPcts.csv}, "PoseAsset CSV delivered");`
        : ''
    }
    }`
  const groomMap = groomSceneMap(character)
  const indentBlock = indentLines
  // Declared OUTSIDE the export core: with grooms the core runs inside the
  // dthRunExport function, and the hair pass — which must not run over a
  // failed main export — reads the verdict after that function returns.
  const exportPrelude = `    var dthExportThrew = null;
    var dthExportLanded = false;
`
  // The Export_Hair per-item pass appended after the main export, inside the
  // groom bracket (it needs this scene's labels). The figure resolves under its
  // OWN name — the standalone Export_ script already declares `dthFig`, and
  // this block has to work in either carrier.
  const hairPassCore = `        // The hair pass: the Export_Hair per-item export, right after the main
        // export — same action, same (scene-resolved) export dir. Per-scene
        // switch first ("Export hair items", off by default on non-primary
        // scenes), then gated on the main export having LANDED: over a
        // restored previous set the grooms would mix one run's hair with
        // another run's body.
        if (!dthHairExportOn) {
            print("Hair export is switched off for this scene - skipped.");
        } else if (!dthExportLanded) {
            print("Main export did not land - hair export skipped.");
        } else {${
          progressPcts
            ? `\n        dthProgressLog(${csvCopyBlock.trim() ? progressPcts.csv : progressPcts.character}, "exporting hair items");`
            : ''
        }
${indentBlock(indentBlock(figureAutoSelectSnippet(character.genesis, 'dthHairFig').trimEnd()))}
        if (!dthHairFig) {
            print("No ${character.genesis} figure found - hair export skipped.");
        } else {
${indentBlock(indentBlock(indentBlock(hairExportLoopSnippet(character, { fig: 'dthHairFig', action: 'dthExportAction', hideTree: 'dthGroomHideTree', hidden: 'dthGroomHidden' }).trimEnd())))}
        }${progressPcts ? `\n        dthProgressLog(${progressPcts.hair}, "hair items exported");` : ''}
        }
`
  // `hairPass` decides whether the pass ships at all: only the Runner's hidden
  // bulk carriers inline it (one unattended pass does the whole job). The
  // visible Export_ script leaves hair to the standalone `Export_Hair_…`.
  const hairPassBlock = hairPass ? hairPassCore : ''
  const exportBody =
    Object.keys(groomMap).length === 0
      ? `${exportPrelude}${exportCore}`
      : `${exportPrelude}    // Hair items must stay OUT of the export. HIDE the item + all its
    // children (the script equivalent of Ctrl+clicking the eye icon) and restore
    // the exact per-node flags after. The DTH Exporter Plugin unparents any hidden
    // child node before exporting and reparents it after, so hiding excludes it
    // from BOTH the FBX and the alembic. (History: we briefly unfit+unparented in
    // the script ourselves, because Daz's own FBX exporter ignores visibility on
    // fitted followers — the plugin now does that unparent internally, so the
    // script only has to hide.) The lists are per scene (outfit scenes carry
    // different hair); a scene without an entry exports as-is.
    var dthRunExport = function () {
${indentBlock(indentBlock(exportCore))}    };
${groomSceneLookupSnippet(groomMap)}${
          hairPass
            ? `
    // The per-scene "Export hair items" switch, resolved for the OPEN scene
    // like the labels above. Only the hair PASS asks — the hide bracket below
    // keeps hiding the items either way (they must stay out of the main
    // export regardless of whether they also export on their own) — so it is
    // emitted only where that pass is, which is the bulk carriers.
    var dthHairExportByScene = ${dazJson(hairExportScenes(character))};
    var dthHairExportOn = dthHairExportByScene[dthGroomScene] === true;`
            : ''
        }
${hideTreeSnippet('dthGroomHideTree', 'dthGroomHidden')}
    if (dthGroomLabels.length == 0) {
        print("No hair list for the open scene - exporting as-is.");
        dthRunExport();
    } else {
    var dthGroomNodes = [];
    var dthGroomMissing = "";
    for (var dthGi = 0; dthGi < dthGroomLabels.length; dthGi++) {
        var dthGroomNode = Scene.findNodeByLabel(dthGroomLabels[dthGi]);
        if (!dthGroomNode) { dthGroomMissing = dthGroomLabels[dthGi]; break; }
        dthGroomNodes.push(dthGroomNode);
    }
    if (dthGroomMissing != "") {
        // A typo must not silently ship a hair-polluted export - fail loud, fix, re-run.
        dthExportAlert("The hair item \\"" + dthGroomMissing + "\\" was not found in the scene.\\n\\nCheck the Hair list in DTH Character Studio - the label must match Daz's Scene pane exactly - then run the export again.");
    } else {
        for (var dthGd = 0; dthGd < dthGroomNodes.length; dthGd++) dthGroomHideTree(dthGroomNodes[dthGd]);
        print("Hair nodes hidden for the export: " + dthGroomHidden.length);
        try {
            dthRunExport();
        } finally {
            // Restore the exact per-node visibility flags, even when the
            // export itself throws.
            for (var dthGr = 0; dthGr < dthGroomHidden.length; dthGr++) {
                try { dthGroomHidden[dthGr].setVisible(true); } catch (eR) {}
            }
            print("Hair nodes shown again: " + dthGroomHidden.length);
        }
${hairPassBlock}    }
    }
`
  // Resolving the exporter takes TWO lookups, and the difference between them
  // is the difference between two very different failures.
  //
  // Daz Studio 6's plugin registers class `DazToHueExporterAction`, which
  // findAction (a CLASS-name lookup) finds. Daz Studio 4's plugin registers
  // class `ExporterAction`, name `DazToHue_Action` — so findAction misses it and
  // the script used to conclude "not installed" for a plugin sitting right
  // there. Worse, it then said nothing at all (measured on a live DS4 run: one
  // DEBUG line in Daz's log, and a ROM that reported success).
  //
  // Finding it is not enough to export, though. Being callable from Daz script
  // is a DAZ STUDIO 6 plugin feature (announced with exporter 1.8.1); the Daz
  // Studio 4 build registers its action normally and exposes only inherited
  // DzAction members. Measured on a DS4 install reporting 2.0.1 in its own
  // dialog: the action carries 28 methods, none named doExport, and a sweep of
  // ALL 912 registered actions plus the global script scope found no doExport*
  // anywhere — `trigger()` just opens the dialog for manual use.
  // So the gate is the CAPABILITY (`typeof doExport == "function"`), never the
  // action's presence, and the three states get three answers.
  // ONE alert channel for the whole export block, with two outputs.
  //
  // The RUN LOG always. A dialog reaches whoever is sitting there; the studio's
  // report reaches them whenever they come back, and it is the ONLY channel the
  // Runner's unattended carriers have — without it a bulk run on a Daz that
  // cannot export completes every scene, exports nothing, and says nothing.
  // Written here rather than through the runtime's logRunError because the
  // Export_ carriers don't include the runtime at all.
  //
  // The DIALOG only when a human ran it. A modal inside a Runner carrier warns
  // nobody and blocks the batch on a click that never comes.
  const runLogPath = metaDirAbs
    ? `${metaDirAbs.replace(/\\/g, '/')}/${ROM_RUN_LOG_FILE}`
    : ''
  const alertHelper = `var dthExportLogPath = ${dazJson(runLogPath)};
// Append a problem to the studio's run log, preserving whatever the ROM run
// already recorded there (its ok flag, frame count and failed morphs).
var dthExportLogProblem = function (dthLogMsg) {
    if (dthExportLogPath == "") return;
    try {
        var dthLogRec = null;
        var dthLogIn = new DzFile(dthExportLogPath);
        if (dthLogIn.exists() && dthLogIn.open(dthLogIn.ReadOnly)) {
            var dthLogTxt = String(dthLogIn.read());
            dthLogIn.close();
            try { dthLogRec = JSON.parse(dthLogTxt); } catch (dthLogParseErr) { dthLogRec = null; }
        }
        if (!dthLogRec || typeof dthLogRec != "object") {
            // No ROM ran this time — an export-only carrier. Nothing succeeded,
            // so the run itself is the failure.
            dthLogRec = { logVersion: 1, character: ${dazJson(character.name)}, ok: false, errors: [], failedMorphs: [] };
        }
        if (dthLogRec.runs && dthLogRec.runs.length) {
            // A v2 log (the ROM run just wrote it, merged BY SCENE): the studio
            // reads runs[].errors and every-run-ok — a top-level push here is
            // INVISIBLE to it, which is how a bulk run with a broken exporter
            // used to complete every scene, export nothing, and say nothing.
            // File the failure under the open scene's own run entry.
            var dthLogKey = String(typeof dthOpenSceneFile != "undefined" ? dthOpenSceneFile : "").split("\\\\").join("/").toLowerCase();
            var dthLogRun = null;
            for (var dthLri = 0; dthLri < dthLogRec.runs.length; dthLri++) {
                var dthLrEntry = dthLogRec.runs[dthLri];
                if (!dthLrEntry) continue;
                if (String(dthLrEntry.scene ? dthLrEntry.scene : "").split("\\\\").join("/").toLowerCase() == dthLogKey) dthLogRun = dthLrEntry;
            }
            if (!dthLogRun) dthLogRun = dthLogRec.runs[dthLogRec.runs.length - 1];
            if (!dthLogRun.errors) dthLogRun.errors = [];
            dthLogRun.errors.push(String(dthLogMsg));
            dthLogRun.ok = false;
            dthLogRec.ok = false;
        } else {
            if (!dthLogRec.errors) dthLogRec.errors = [];
            dthLogRec.errors.push(String(dthLogMsg));
            // An export failure is never an ok run — the v1 reader takes both
            // fields at face value.
            dthLogRec.ok = false;
        }
        dthLogRec.finishedAt = new Date().toString();
        dthLogRec.finishedAtMs = new Date().getTime();
        var dthLogOut = new DzFile(dthExportLogPath);
        if (dthLogOut.open(dthLogOut.WriteOnly | dthLogOut.Truncate)) {
            dthLogOut.write(JSON.stringify(dthLogRec, null, 2));
            dthLogOut.close();
        }
    } catch (dthLogErr) {
        print("Could not record the export problem in the run log: " + dthLogErr);
    }
};
var dthExportAlert = function (dthAlertMsg) {
    print(dthAlertMsg);
    dthExportLogProblem(dthAlertMsg);${
      unattended
        ? ''
        : `
    MessageBox.critical(dthAlertMsg, "DTH Character Studio", "&OK");`
    }
};
`
  return `${alertHelper}var dthExportAction = MainWindow.getActionMgr().findAction("DazToHueExporterAction");
if (!dthExportAction) {
    // Daz Studio 4 names it differently — find it so "installed but not
    // scriptable" can be told apart from "not installed".
    var dthActionMgr = MainWindow.getActionMgr();
    var dthActionCount = dthActionMgr.getNumActions();
    for (var dthAi = 0; dthAi < dthActionCount; dthAi++) {
        var dthCandidate = dthActionMgr.getAction(dthAi);
        if (!dthCandidate) continue;
        var dthCandidateName = "";
        try { dthCandidateName = String(dthCandidate.name); } catch (dthNameErr) {}
        if (dthCandidateName == "DazToHue_Action") { dthExportAction = dthCandidate; break; }
    }
}
if (dthExportAction && typeof dthExportAction.doExport == "function") {
    var dthExportDir = ${dazJson(exportDir.replace(/\\/g, '/'))};
${sceneSubfolderBlock}${exportBody}} else if (dthExportAction) {
    dthExportAlert("The ROM was built, but the export did NOT run.\\n\\nThe DazToHue Exporter is installed here, but this build exposes no scripted export, so the studio cannot drive it. Being callable from Daz script is a feature of the Daz Studio 6 exporter plugin (1.8.1+).\\n\\nRun the ROM script from Daz Studio 6, or export by hand from the DazToHue Exporter dialog.\\n\\nThe ROM on the timeline is fine - only the export was skipped.");
} else {
    dthExportAlert("The ROM was built, but the export did NOT run.\\n\\nNo DazToHue Exporter is registered in Daz Studio " + App.version + ".\\n\\nInstall the DTH Exporter Plugin for this Daz version and restart Daz, then run the script again.\\n\\nThe ROM on the timeline is fine - only the export was skipped.");
}
`
}

/**
 * The character's per-SCENE hair lists as a lookup the generated script embeds:
 * normalized scene path (forward slashes, lowercased) → trimmed non-empty item
 * labels. Scenes without items are dropped — absence MEANS "this scene has no
 * groom to exclude". Hair is per-scene by presence: a scene record's `hair`
 * items ARE its hair (none listed → nothing excluded). THE single gate for the
 * export bracket.
 */
function groomSceneMap(character: Character): Record<string, Array<string>> {
  const map: Record<string, Array<string>> = {}
  for (const record of character.sceneOverrides) {
    const key = record.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    const labels = record.hair.map((n) => n.nodeLabel.trim()).filter((label) => label !== '')
    if (key !== '' && labels.length > 0) map[key] = labels
  }
  return map
}

/**
 * The per-scene "Export hair items" switch as the lookup the export block
 * embeds beside {@link groomSceneMap}: same normalized keys, `true` where the
 * DTH Export flow should run the hair pass ({@link sceneHairExportEnabled} —
 * stored choice, else on for the primary scene only). Only scenes that carry
 * hair get a key: the pass never runs without labels, so the map stays as
 * small as the groom map it gates.
 */
function hairExportScenes(character: Character): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const key of Object.keys(groomSceneMap(character))) {
    map[key] = sceneHairExportEnabled(character, key)
  }
  return map
}

/**
 * The run-time export base name (`dthExportName`) for ONE scene, given its
 * resolved export subfolder — the studio-side MIRROR of the snippet's rule
 * ({@link sceneExportSubfolderSnippet}): base {@link exporterFigureName},
 * suffixed with the subfolder — each '/'-segment's first letter capitalized,
 * segments joined by '_', commas to spaces — while the PRIMARY scene (and a
 * subfolder-less one) keeps the bare base. The export watch derives each
 * scene's delivered-CSV name from it (`<name>_pose_asset.csv` — the run-time
 * CSV copy names its destination the same way); a rule change must land in
 * both or the watch stats files that are never written.
 */
export function sceneExportName(
  character: Pick<Character, 'name' | 'scenePath'>,
  sceneKey: string,
  subfolder: string,
): string {
  const base = exporterFigureName(character)
  const primaryKey = character.scenePath.trim().replace(/\\/g, '/').toLowerCase()
  if (!subfolder || sceneKey === primaryKey) return base
  const suffix = subfolder
    .split(',')
    .join(' ')
    .split('/')
    .map((seg) => (seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg))
    .join('_')
  return `${base}_${suffix}`
}

/**
 * The per-scene EXPORT subfolder each linked scene's export nests under:
 * normalized scene path → the scene's own subfolder path below the character's
 * scenes ROOT (every scene has its own subfolder now — the primary's is
 * "primary", extras get a name seeded from the sanitized scene name at add
 * time; nested subfolders mirror as nested export folders). The HOST resolves
 * `scenesRootAbs` (charFolder + project dazSubdir rules — the pure core can't
 * know it) and threads it through {@link generateAll}.
 *
 * Fallback = the scene's file STEM (the pre-v37 per-scene-name nesting) for a
 * scene the root can't place: linked in place outside the root, still sitting
 * DIRECTLY in the root (legacy layout — the Refresh sweep moves those into
 * subfolders), no root threaded at all, or two scenes sharing one subfolder
 * (their exports must never overwrite each other). Same key normalization as
 * {@link groomSceneMap}.
 */
export function sceneExportSubfolders(
  character: Character,
  scenesRootAbs?: string,
): Record<string, string> {
  const norm = (p: string) => p.trim().replace(/\\/g, '/')
  const rootClean = scenesRootAbs ? stripTrailingSlashes(norm(scenesRootAbs)) : ''
  const rootPrefix = rootClean ? `${rootClean.toLowerCase()}/` : ''
  const linked = [character.scenePath, ...character.extraScenes].map(norm).filter(Boolean)
  // A scene's below-root FOLDER path ('' = directly in the root / outside it).
  const belowRootDir = (scene: string) => {
    if (!rootPrefix || !scene.toLowerCase().startsWith(rootPrefix)) return ''
    // Slice by prefix LENGTH so the original casing survives the lowercase match.
    return scene.slice(rootPrefix.length).split('/').slice(0, -1).join('/')
  }
  // Two scenes in the SAME subfolder would export onto each other — those fall
  // back to their stems (claims counted case-insensitively, Windows semantics).
  const claims = new Map<string, number>()
  for (const scene of linked) {
    const dir = belowRootDir(scene).toLowerCase()
    if (dir) claims.set(dir, (claims.get(dir) ?? 0) + 1)
  }
  const map: Record<string, string> = {}
  for (const scene of linked) {
    const key = scene.toLowerCase()
    const dir = belowRootDir(scene)
    const stem = (scene.split('/').pop() ?? scene).replace(/\.[^.]+$/, '')
    const name = dir && claims.get(dir.toLowerCase()) === 1 ? dir : stem
    if (key !== '' && name !== '') map[key] = name
  }
  return map
}

/**
 * The run-time config deltas the ONE character script embeds: normalized scene path
 * → the `dthCharacterConfig` fields the open scene overrides. Section-derived fields
 * (includes, extra frames, art direction, preset paths/lengths) come from DIFFING the
 * scene's full {@link buildCharacterConfig} against the base; identity dials, preserve
 * lists, JCM mods and frame-0 morphs are emitted explicitly (so a cleared list still overrides). A
 * scene with no field to change is dropped. Same key normalization as {@link groomSceneMap}.
 */
// Config keys that are DERIVED from the (merged) sections — diffed per scene against
// the base config, so ANY section change (mode / preset / art direction / enable /
// custom rows / custom path) reaches the runtime. Excludes identity / preserve / jcm:
// those aren't section-derived, and they're emitted explicitly below so a cleared
// array still OVERRIDES the base (the shallow runtime copy can only set keys, never
// delete them). A key the merged config OMITS — a preset block a scene turned off —
// is left stale on the base config but never read: its bIncludeX flag (which IS in
// this list) gates the read, so `bIncludeGP:false` neutralizes a stale `gpArtDirection`.
const SCENE_CONFIG_DIFF_KEYS = [
  'bIncludeJCM',
  'bIncludeFAC',
  'bIncludeDK',
  'bIncludeGP',
  'bIncludePhysics',
  'extraFrames',
  'gpArtDirection',
  'dkArtDirection',
  'jcmRomPath',
  'mouthRomPath',
  'gpRomPath',
  'dkRomPath',
  'physRomPath',
  'presetFrames',
] as const

function buildSceneConfigMap(
  character: Character,
  baseConfig: Record<string, unknown>,
  romPaths: RomPaths,
  frames: PresetFrames | undefined,
  metaDirAbs: string | undefined,
  sceneRomPaths: Record<string, RomPaths>,
  sceneFrames: Record<string, PresetFrames>,
): Record<string, Record<string, unknown>> {
  const g9Dials = GENERATIONS[character.genesis].hasStrengthDials
  const map: Record<string, Record<string, unknown>> = {}
  for (const override of activeSceneOverrides(character)) {
    const key = override.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    if (key === '') continue
    const delta: Record<string, unknown> = {}
    // Section-derived keys: the DIFF of the scene's full config (built over the merged
    // character with its own re-resolved rom paths + preset-block frames) vs the base.
    const merged = buildCharacterConfig(
      mergeSceneOverride(character, override),
      sceneRomPaths[key] ?? romPaths,
      sceneFrames[key] ?? frames,
      metaDirAbs,
    )
    for (const k of SCENE_CONFIG_DIFF_KEYS) {
      const value = merged[k]
      if (value === undefined) continue // can't unset via shallow copy; bIncludeX gates it
      if (JSON.stringify(value) !== JSON.stringify(baseConfig[k])) delta[k] = value
    }
    // The one omitted-key case the bIncludeX gate does NOT cover: a scene that
    // CLEARS art direction while keeping the block ON. The merged config then
    // omits gp/dkArtDirection with bIncludeGP/DK still true, the shallow copy
    // can't unset the base's key, and the runtime would stamp the base's
    // art-direction morphs onto the very scene the user cleared. Emit an
    // explicit null — the runtime's truthiness gate (`if (options["gpArtDirection"])`)
    // then skips it.
    for (const [k, gate] of [
      ['gpArtDirection', 'bIncludeGP'],
      ['dkArtDirection', 'bIncludeDK'],
    ] as const) {
      if (merged[k] === undefined && baseConfig[k] !== undefined && merged[gate] === true) {
        delta[k] = null
      }
    }
    // Identity dials — not section-derived, emit explicitly (same G9 gate as the base).
    if (override.identity) {
      delta.FACsDetailStrength = g9Dials ? override.identity.facsDetailStrength : 0
      delta.FlexionStrength = g9Dials ? override.identity.flexionStrength : 0
      delta.bApplyUE5TearUV = character.genesis === 'G9' && override.identity.applyUE5TearUV
    }
    // Preserve node transforms — full replacement, emitted even empty, so an armed
    // scene that cleared the list overrides the base's (empty ⇒ preserve nothing).
    if (override.preserve) delta.preserveNodeTransforms = override.preserve.nodeTransforms
    // JCM "Modify frames" — full replacement, emitted even empty (delete-all); excluded
    // from the section diff above so a cleared list still overrides the base's.
    if (override.jcm) delta.jcmMorphMods = override.jcm.map(jcmMorphModForRuntime)
    // Frame-0 morphs — full replacement, emitted even empty (delete-all), the same
    // contract as the preserve lists.
    if (override.frameZero) delta.frameZeroMorphs = override.frameZero
    if (Object.keys(delta).length > 0) map[key] = delta
  }
  return map
}

/**
 * Scene → PoseAsset-CSV-name for every linked scene that overrides the ROM (and
 * so has its own scene-suffixed CSV, built from the merged sections). Keyed by
 * the open scene's normalized path, matching {@link buildSceneConfigMap}. The
 * export block (the standalone Export_ script and the hidden bulk carriers —
 * since v38 the ROM script carries no export) resolves the CSV to deliver
 * through this; an identity/groom-only scene isn't
 * here and rides the base CSV. Public: the studio's export watch derives each
 * scene's expected delivered-CSV path from the same lookup.
 */
export function buildSceneCsvMap(character: Character): Record<string, string> {
  const map: Record<string, string> = {}
  for (const override of activeSceneOverrides(character)) {
    if (!sceneOverrideBuildsRom(character, override)) continue
    const key = override.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    if (key !== '') map[key] = poseAssetFileName(character, sceneOverrideSlug(override.scenePath))
  }
  return map
}

/**
 * The FULL `dthCharacterConfig` object a character compiles to — every include
 * flag, preset-block length, rom path, inline extra-frame + art-direction dataset,
 * the identity dials, preserve lists and JCM mods. Pure derivation from
 * `(character, romPaths, frames, metaDirAbs)` — the last only supplying the run-log
 * path — so it's computed ONCE for the
 * base AND — over `mergeSceneOverride(...)` with the scene's re-resolved paths /
 * frames — per linked scene, whose config DELTA is the diff of the two
 * ({@link buildSceneConfigMap}). Keeping one builder is what lets a per-scene
 * mode / preset / art-direction / JCM change reach the runtime without the scene
 * map hand-re-deriving the include logic (which would drift from `presetSelections`).
 */
export function buildCharacterConfig(
  character: Character,
  romPaths: RomPaths = {},
  frames?: PresetFrames,
  metaDirAbs?: string,
): Record<string, unknown> {
  const { sections } = character
  // JCM custom mode: a user-supplied .duf path used as the base ROM, just like
  // a pre-defined asset (so it still drives bIncludeJCM + jcmRomPath).
  // Forward-slashed like the catalog paths — DzFile/DzDir want '/', and the picker
  // hands us a raw Windows path.
  const jcmCustomPath =
    sections.JCM.mode === 'custom'
      ? sections.JCM.customAssetPath.trim().replace(/\\/g, '/')
      : ''
  // GP/DK/Physics preset selection comes from the shared helper (single source);
  // JCM/FAC are the SUPERSET here — a custom `.duf` path also counts — so they
  // stay local rather than using the helper's preset-only jcmPreset/facPreset.
  const {
    includeGp: includeGP,
    includeDk: includeDK,
    physPreset: includePhysics,
  } = presetSelections(sections, character.gender)
  const includeJCM =
    sections.JCM.enabled && (sections.JCM.mode === 'preset' || jcmCustomPath !== '')
  // FAC frames live INSIDE the JCM base ROM (see facPresetSupport) — without a
  // base block there are no FAC frames, so bIncludeFAC true would tell the
  // runtime to expect frames that contribute nothing to presetEndFrame (a
  // config that lies to the runtime). The same rule is surfaced to the user as
  // a romValidationErrors config error (validation.ts); this gate keeps even a
  // bypassed save honest.
  const includeFAC =
    sections.FAC.enabled && sections.FAC.mode === 'preset' && jcmIsBaseRom(sections)

  const config: Record<string, unknown> = {
    genesis: character.genesis,
    gender: character.gender,
    // Run-log metadata: the runtime writes dth_rom_run_log.json (the character's
    // .dcsmeta folder) after every run; the studio reads it back to surface problems.
    characterName: character.name,
    runtimeVersion: RUNTIME_VERSION,
    studioVersion: character.studioVersion ?? '',
    bIncludeJCM: includeJCM,
    bIncludeFAC: includeFAC,
    bIncludeDK: includeDK,
    bIncludeGP: includeGP,
    bIncludePhysics: includePhysics,
    bDQS: characterSkinning(character) === 'dqs',
    // The FACS-detail/flexion strength dials only exist on Genesis 9 figures
    // (GENERATIONS[gen].hasStrengthDials) — 0 makes the runtime skip them (setting
    // them on a non-G9 figure would log a spurious "property not found" failure).
    FACsDetailStrength: GENERATIONS[character.genesis].hasStrengthDials
      ? character.facsDetailStrength
      : 0,
    FlexionStrength: GENERATIONS[character.genesis].hasStrengthDials ? character.flexionStrength : 0,
    // G9 only: switch the Genesis 9 Tear shader's UV set to "UE5" during the build
    // (an example UE5 tear UV only ships for Genesis 9).
    bApplyUE5TearUV: character.genesis === 'G9' && character.applyUE5TearUV,
  }
  // Measured preset-block lengths (base/gp/dk/phys), so the Daz runtime sizes
  // each block from the real .duf frame counts instead of hard-coded literals —
  // the two artifacts can't drift. Omitted only in pure/web contexts (no native
  // measurement); the runtime then fails loud rather than guessing.
  if (frames) config.presetFrames = frames
  if (metaDirAbs) {
    config.runLogPath = `${metaDirAbs.replace(/\\/g, '/')}/${ROM_RUN_LOG_FILE}`
    // The interrupt flag the DTH runtime polls between ROM blocks and inside
    // the frame-apply loop (see {@link EXPORT_CANCEL_FILE}). The carrier bakes
    // its own copy for its own probes; the runtime is a separate file that only
    // ever sees this config, so it needs the path handed to it.
    config.cancelPath = cancelFlagPath(metaDirAbs)
  }
  // Custom JCM path wins over the catalog-resolved one.
  const jcmRomPath = jcmCustomPath || romPaths.jcm
  if (jcmRomPath) config.jcmRomPath = jcmRomPath
  // The mouth companion only ever plays over base FAC frames — never emit it
  // when bIncludeFAC is off (e.g. a mouth resolved for a custom JCM that has no
  // base .duf yet), or the config would carry a pass with no frames to serve.
  if (includeFAC && romPaths.mouth) config.mouthRomPath = romPaths.mouth
  if (romPaths.gp) config.gpRomPath = romPaths.gp
  if (romPaths.dk) config.dkRomPath = romPaths.dk
  if (romPaths.phys) config.physRomPath = romPaths.phys
  if (character.preserveNodeTransforms.length)
    config.preserveNodeTransforms = character.preserveNodeTransforms
  if (character.frameZeroMorphs.length) config.frameZeroMorphs = character.frameZeroMorphs
  // Split each rule's signed drives[] back into the positive/negative lists the
  // runtime consumes (the stored model dropped the redundant selector).
  if (character.jcmMorphMods.length)
    config.jcmMorphMods = character.jcmMorphMods.map(jcmMorphModForRuntime)
  // All extra ROM frames inline (was <Name>_FBMs.json).
  config.extraFrames = buildFbmData(character)
  // Per-character art direction inline (was <Name>_<GP9|DK9>ArtDirection.json).
  const gpArt = includeGP
    ? buildArtDirectionData(character, 'gp', 'GP9', 'Golden Palace', frames?.gp)
    : null
  const dkArt = includeDK
    ? buildArtDirectionData(character, 'dk', 'DK9', 'Dicktator', frames?.dk)
    : null
  if (gpArt) config.gpArtDirection = gpArt
  if (dkArt) config.dkArtDirection = dkArt
  return config
}

/**
 * The one self-contained Daz script for a character: `ROM_<Name>_<Genesis>.dsa`.
 * It includes the DTH runtime (DthWorkflow.dsa, installed alongside it) and
 * makes a single `ApplyDTHCharacter(config)` call whose argument carries the
 * FULL character configuration AND all ROM morph definitions inline — replacing
 * the old wrapper + FBMs.json + CSV + art-direction JSON files.
 */
export function toCharacterScriptDsa(
  character: Character,
  romPaths: RomPaths = {},
  frames?: PresetFrames,
  metaDirAbs?: string,
  sceneRomPaths: Record<string, RomPaths> = {},
  sceneFrames: Record<string, PresetFrames> = {},
  scenesRootAbs?: string,
  /** `$HIP`-anchored prefix for bone-scale reference paths ('' = absolute) —
   *  see {@link buildExportBlock}. */
  hipRefPrefix = '',
  /** Scan-sync settings — see {@link IndexSyncOptions}. */
  indexSync?: IndexSyncOptions,
  /** See {@link buildRomScriptDsa}. */
  progressLogPath = '',
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): GeneratedFile {
  return buildRomScriptDsa(
    character,
    false,
    romPaths,
    frames,
    metaDirAbs,
    sceneRomPaths,
    sceneFrames,
    scenesRootAbs,
    hipRefPrefix,
    indexSync,
    progressLogPath,
    false,
    runtimeRootAbs,
  )
}

/**
 * The runtime-locating preamble emitted into every generated script that
 * `include()`s the hidden DTH runtime. `getScriptFileName()` is how a script
 * finds itself, and the runtime normally sits two levels up from its folder —
 * but on the FIRST row of a Runner batch in a cold-started Daz that call can
 * answer with one of Daz's OWN scripts instead (measured 2026-08-18: the
 * include then resolved into `DAZStudio4/resources/` and the row failed
 * "runtime missing" with the runtime installed and intact, while the next row
 * of the same batch worked). The studio knows the install root at generation
 * time, so it is baked in and probed whenever the relative answer has no
 * runtime. `include()` itself must stay at the TOP level (Daz's legacy-include
 * mechanism fails inside try/catch), which is why this resolves a DIRECTORY
 * for the include lines to use rather than wrapping the include.
 *
 * `probeFile` is the sentinel checked at each candidate root — the (hidden,
 * dot-prefixed) runtime file the emitting script includes first. The runtime
 * files install as one set, so any one of them stands for the root.
 */
function runtimeDirSnippet(runtimeRootAbs: string, probeFile: string): string {
  const baked = stripTrailingSlashes(runtimeRootAbs.replace(/\\/g, '/'))
  return `// Where the hidden DTH runtime lives — normally two levels up from this
// script's own folder, with the studio's baked install root as the fallback
// for the one measured way getScriptFileName() lies (the first row of a batch
// in a Daz still starting answers with a Daz-internal script; see the studio's
// dsa.ts runtimeDirSnippet).
var dthSelfDir = String(new DzFileInfo(getScriptFileName()).path());
var dthBakedRuntimeDir = ${dazJson(baked)};
function dthResolveRuntimeDir() {
    var sRel = "";
    try { sRel = String(new DzDir(dthSelfDir).filePath("../..")); } catch (dthRelErr) {}
    if (sRel != "" && (new DzFile(sRel + "/${probeFile}")).exists()) return sRel;
    if (dthBakedRuntimeDir != "" && (new DzFile(dthBakedRuntimeDir + "/${probeFile}")).exists()) return dthBakedRuntimeDir;
    // Neither candidate has the runtime — return the relative answer so the
    // include walks (and the failure report names) the normal location.
    return sRel;
}
var dthRuntimeDir = dthResolveRuntimeDir();`
}

/**
 * The whole runtime-locating block for the scan-only carriers (Export_/Groom_):
 * {@link runtimeDirSnippet} plus the include lines their `indexSync` calls for —
 * or NOTHING at all, because those two scripts include no runtime unless a scan
 * is attached. Emitting the parts separately left three blank lines in every
 * scan-less script, so the whole block (its surrounding blank lines included)
 * lives or dies together.
 *
 * The sentinel is `.DthUtils.dsa` in both cases: it is the first include when
 * `morphIndexDir` is set, and `.DthProducts.dsa` pulls it in itself otherwise —
 * and the runtime installs as one set, so any member stands for the root.
 */
function runtimeIncludeBlock(runtimeRootAbs: string, indexSync?: IndexSyncOptions): string {
  const scan = indexSync?.morphIndexDir
    ? '\ninclude(dthRuntimeDir + "/.DthUtils.dsa");\ninclude(dthRuntimeDir + "/.DthScanMorphs.dsa");'
    : ''
  const products = indexSync?.products ? '\ninclude(dthRuntimeDir + "/.DthProducts.dsa");' : ''
  if (!scan && !products) return ''
  return `\n${runtimeDirSnippet(runtimeRootAbs, '.DthUtils.dsa')}${scan}${products}\n`
}

/**
 * The verbose-progress appender emitted into the ROM/export carriers (inline —
 * the Export_ script has no runtime include, so nothing shared can carry it):
 * appends a Runner-v1.2.0 progress-log line `[<pct>] <scene stem>: <message>`
 * to the baked `dthProgressLogPath`. The percent scale is the job row's step
 * count (see the studio's `jobStepsForMode`); the Runner writes the scene-open
 * and terminal lines, these calls the interior steps. Best-effort and silent
 * by construction — progress must never fail a run — and a script generated
 * without a path no-ops entirely.
 */
function dthProgressSnippet(): string {
  return `// Verbose per-scene progress for the studio's live display (Runner v1.2.0
// contract): "[<percent>] <scene>: <message>" appended per finished step.
function dthProgressLog(nPct, sMsg) {
    try {
        if (typeof dthProgressLogPath == "undefined" || !dthProgressLogPath) return;
        var dthPStem = "scene";
        try {
            var dthPScene = (typeof dthOpenSceneFile != "undefined" && dthOpenSceneFile)
                ? String(dthOpenSceneFile) : String(Scene.getFilename());
            if (dthPScene) dthPStem = String(new DzFileInfo(dthPScene).completeBaseName());
        } catch (dthPStemErr) {}
        var dthPFile = new DzFile(dthProgressLogPath);
        if (dthPFile.open(dthPFile.Append)) {
            dthPFile.write("[" + Math.round(nPct) + "] " + dthPStem + ": " + sMsg + "\\n");
            dthPFile.close();
        }
    } catch (dthPErr) { /* progress is best-effort - never fail the run over it */ }
}
`
}

/**
 * The interrupt probe emitted into every generated carrier (inline, like
 * {@link dthProgressSnippet} — the Export_ script
 * includes no runtime, so nothing shared can carry it): "has the studio asked
 * this run to stop?", answered by the existence of the baked
 * {@link EXPORT_CANCEL_FILE}.
 *
 * A script generated WITHOUT a path (no meta folder — pure/test contexts) can
 * never be interrupted and never checks: `dthCancelPath` is `""` and the probe
 * returns false, so the emitted behaviour is exactly what it was before.
 *
 * The probe itself is best-effort — an unreadable flag reads as "not
 * cancelled", because the failure that matters is the opposite one: a false
 * positive would silently skip a run the user asked for.
 */
function dthCancelSnippet(): string {
  return `// Interrupt: the studio drops this flag file when the user stops a running
// DTH Export. Every carrier probes it at the points where abandoning the work
// leaves nothing half-written; the studio deletes it again when the run ends.
function dthCancelRequested() {
    try {
        if (typeof dthCancelPath == "undefined" || !dthCancelPath) return false;
        return new DzFile(dthCancelPath).exists();
    } catch (dthCErr) { return false; /* can't tell = keep working */ }
}
`
}

/**
 * The hidden BULK variant ({@link BULK_ROM_EXPORT_SCRIPT}) the DTH Character
 * Studio Runner executes on job-file runs (the studio's DTH Export button):
 * the SAME one-script build in its `bulk` shape — it always builds the ROM and
 * always exports, skeleton/mesh and every hair asset, in one unattended pass.
 * That is what `bulk` MEANS now: the visible per-character scripts are always
 * the three separate ones, and this carrier is the only one that combines them.
 * One builder ({@link toCharacterScriptDsa}'s), so the two can never drift; dot-prefixed
 * so Daz's Content Library never shows it. Only meaningful with an export dir
 * — generateAll emits it exactly then.
 */
export function toBulkRomExportScriptDsa(
  character: Character,
  romPaths: RomPaths = {},
  frames?: PresetFrames,
  metaDirAbs?: string,
  sceneRomPaths: Record<string, RomPaths> = {},
  sceneFrames: Record<string, PresetFrames> = {},
  scenesRootAbs?: string,
  /** `$HIP`-anchored prefix for bone-scale reference paths ('' = absolute) —
   *  see {@link buildExportBlock}. */
  hipRefPrefix = '',
  /** Scan-sync settings — see {@link IndexSyncOptions}. */
  indexSync?: IndexSyncOptions,
  /** See {@link buildRomScriptDsa}. */
  progressLogPath = '',
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): GeneratedFile {
  return buildRomScriptDsa(
    character,
    true,
    romPaths,
    frames,
    metaDirAbs,
    sceneRomPaths,
    sceneFrames,
    scenesRootAbs,
    hipRefPrefix,
    indexSync,
    progressLogPath,
    true,
    runtimeRootAbs,
  )
}

/**
 * The hidden ROM-ONLY variant ({@link BUILD_ROM_ANIMATION_SCRIPT}) the Runner
 * executes for a scene card's "Open and Generate ROM Animation": the same
 * one-script build in its NON-bulk shape, which carries no export — it builds
 * the ROM and (runtime v42) saves the reopenable
 * `rom-animations/<stem>_ROM.duf`, nothing else.
 * One builder ({@link toCharacterScriptDsa}'s), so it can never drift from the
 * visible ROM script; needs no export directory (the save doesn't either).
 */
export function toBuildRomAnimationScriptDsa(
  character: Character,
  romPaths: RomPaths = {},
  frames?: PresetFrames,
  metaDirAbs?: string,
  sceneRomPaths: Record<string, RomPaths> = {},
  sceneFrames: Record<string, PresetFrames> = {},
  scenesRootAbs?: string,
  /** Scan-sync settings — see {@link IndexSyncOptions}. */
  indexSync?: IndexSyncOptions,
  /** See {@link buildRomScriptDsa} — the ROM line reports 100 here (the
   *  rom-only job rows declare the 2-step scale). */
  progressLogPath = '',
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): GeneratedFile {
  const file = buildRomScriptDsa(
    character,
    false,
    romPaths,
    frames,
    metaDirAbs,
    sceneRomPaths,
    sceneFrames,
    scenesRootAbs,
    '', // export forced off — there are no reference paths to anchor
    indexSync,
    progressLogPath,
    // The RUNNER executes this one (a scene card's "Open and Generate ROM
    // Animation"), even though it is built with bulk = false — so it is
    // unattended, and a modal in it hangs the row forever.
    true,
    runtimeRootAbs,
  )
  // Hidden (dot-prefixed) → no Content Library tile, no icon artwork.
  return { fileName: BUILD_ROM_ANIMATION_SCRIPT, content: file.content, target: 'daz' }
}

/**
 * Keeping the studio's scan data in sync off the app's CORE flow: every ROM /
 * export run scans the scene it has just verified, so the Morph-name
 * autocomplete (and, with Daz Products on, the product results) stay current
 * without anyone remembering to run Tools → Scan project.
 *
 * Both scans are best-effort and never throw ({@link DthScanSceneMorphsQuiet} /
 * `DthScanProductsQuiet`): the run's job is the ROM and the export, and a scan
 * problem must never fail an export row that actually succeeded.
 */
export interface IndexSyncOptions {
  /** The studio's app-data folder — where `morphs_scenes_<G>.json` is written.
   *  '' disables the morph sync (pure/web contexts have no app-data path). */
  morphIndexDir: string
  /** The CHARACTER's generation, as the fallback for filing this scene's
   *  morphs when no figure in it can be identified from its source asset — a
   *  Daz Studio 4 reality, where the scan otherwise skipped every scene (see
   *  `DthScanSceneMorphs`). Omitted = detect-or-skip, as before. */
  genesis?: string
  /** The per-character `DthScanProducts` config, when the PROJECT has Daz
   *  Products enabled — the same object the standalone `Scan_Products_<Name>.dsa`
   *  bakes in, so the two paths cannot drift. Omitted = no product scan. */
  products?: ScanProductsOptions & { characterId: string; characterName: string; genesis: string }
}

/**
 * The scan calls emitted into a generated ROM/export script, at base indent 0.
 *
 * Placed AFTER the wrong-scene guard (never scan a scene this character doesn't
 * own) but BEFORE the ROM build, for two reasons: the scene is still pristine —
 * the truest picture of what it actually wears — and `Scene.getFilename()` has
 * not yet been repointed by the ROM save-as. Both calls are handed
 * `dthOpenSceneFile` regardless, which is the SOURCE scene even on an
 * "Export only" run that opened a saved ROM animation.
 */
function indexSyncSnippet(sync?: IndexSyncOptions): string {
  if (!sync || (!sync.morphIndexDir && !sync.products)) return ''
  // DzFile/DzDir want '/' on Windows — same normalization the export block and
  // the standalone scan script apply.
  const fwd = (path: string) => path.split('\\').join('/')
  const lines = [
    "// Keep the studio's scan data current off the app's core flow. Best",
    '// effort by construction: these never throw, so a scan problem cannot',
    '// fail a run whose ROM and export actually succeeded.',
  ]
  if (sync.morphIndexDir) {
    lines.push(
      'if (typeof DthScanSceneMorphsQuiet == "function") {',
      `    DthScanSceneMorphsQuiet(${dazJson(fwd(sync.morphIndexDir))}, dthOpenSceneFile, ${dazJson(sync.genesis ?? '')});`,
      '}',
    )
  }
  if (sync.products) {
    const cfg = {
      ...sync.products,
      dimManifestPath: fwd(sync.products.dimManifestPath),
      outputDir: fwd(sync.products.outputDir),
      dazLibraryFolder: fwd(sync.products.dazLibraryFolder),
    }
    lines.push(
      'if (typeof DthScanProductsQuiet == "function") {',
      `    var dthProductScanConfig = ${dazJson(cfg, 4)};`,
      '    dthProductScanConfig.scenePath = dthOpenSceneFile;',
      '    DthScanProductsQuiet(dthProductScanConfig);',
      '}',
    )
  }
  return `${lines.join('\n')}\n`
}

function buildRomScriptDsa(
  character: Character,
  /** The bulk variant: header + hidden file name differ, nothing else. */
  bulk: boolean,
  romPaths: RomPaths = {},
  frames?: PresetFrames,
  /**
   * Absolute path of the character's app-internal folder in the project's
   * `.dcsmeta` (`.dcsmeta/characters/<folder>`) — where the studio writes the
   * PoseAsset CSV at generation time, and where the runtime writes its run log.
   * When provided (the desktop app), the generated script copies that CSV into
   * the resolved export dir at run time. Omitted in pure/web contexts, where
   * both the copy block and the run log are skipped.
   */
  metaDirAbs?: string,
  /**
   * Per-scene re-resolved rom paths / preset-block frames, keyed by the scene's
   * normalized (lowercased '/'-path) key — the HOST resolves these from
   * `mergeSceneOverride(...)` because the catalog lookup + native `.duf` measurement
   * live outside the pure core. Omitted (or a scene missing) ⇒ that scene falls back
   * to the base `romPaths`/`frames`, so a per-scene preset/mode/path change without
   * host re-resolution would carry the base paths (see `buildSceneConfigMap`).
   */
  sceneRomPaths: Record<string, RomPaths> = {},
  sceneFrames: Record<string, PresetFrames> = {},
  /** The character's scenes-root folder (host-resolved) — sizes each scene's
   *  export subfolder; see {@link sceneExportSubfolders}. */
  scenesRootAbs?: string,
  /** `$HIP`-anchored prefix for bone-scale reference paths ('' = absolute) —
   *  see {@link buildExportBlock}. */
  hipRefPrefix = '',
  /** Scan-sync settings — see {@link IndexSyncOptions}. */
  indexSync?: IndexSyncOptions,
  /** The Runner-v1.2.0 verbose progress log this script appends its finished
   *  steps to (host-resolved app-data path; see {@link dthProgressSnippet}).
   *  '' = the script logs no progress. */
  progressLogPath = '',
  /**
   * Nobody is watching this run, so it must never open a modal — see the
   * no-modal note in the emitted `dthFailureDialog`. Defaults to `bulk` because
   * every bulk carrier is Runner-driven, but it is a SEPARATE flag on purpose:
   * `.Build_ROM_Animation.dsa` is executed by the Runner too and is built with
   * `bulk = false` (it wants the interactive script's shape, not the batch's),
   * so tying "no dialogs" to `bulk` left exactly that carrier able to hang a
   * run on a click nobody could make.
   */
  unattended = bulk,
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): GeneratedFile {
  const config = buildCharacterConfig(character, romPaths, frames, metaDirAbs)

  // Per-scene overrides folded into the ONE script: each linked scene with an armed
  // panel contributes a run-time config DELTA (the diff of its full config vs the
  // base — art direction, includes, extra frames, JCM mods, identity dials, …); a
  // scene whose FRAME LAYOUT differs also mints its own PoseAsset CSV the export block
  // delivers by the same scene lookup. The config lookup swaps the open scene's delta
  // onto dthCharacterConfig before the build (emitted only when some scene overrides;
  // else the config stands as the primary scene's).
  const sceneConfigMap = buildSceneConfigMap(
    character,
    config,
    romPaths,
    frames,
    metaDirAbs,
    sceneRomPaths,
    sceneFrames,
  )
  const sceneCsvMap = buildSceneCsvMap(character)
  const sceneSelectBlock =
    Object.keys(sceneConfigMap).length > 0 ? `\n${sceneConfigLookupSnippet(sceneConfigMap)}` : ''
  // Tells the RUNTIME the run is unattended, so its own end-of-build "problems
  // occurred" warning prints instead of opening a modal that would block every
  // row queued behind it (runtime v85 — the carrier's dthFailureDialog was
  // gated in v80, but ApplyDTHCharacter's tail warning wasn't: gating the
  // carrier TEXT never reached the runtime it include()s). Set AFTER the scene
  // deltas are diffed (they must never carry or strip it), and only when true,
  // so the visible attended script's config — and its modal — stay as they were.
  if (unattended) config.bUnattended = true

  // The auto-export rides the ROM build in the BULK carrier only — the one the
  // Runner executes unattended, which has to do the whole job in one pass. The
  // VISIBLE `ROM_…` script builds the ROM and stops: exporting is the standalone
  // `Export_…` script's job, and grooming the `Export_Hair_…` one's. That split
  // is unconditional now (it used to be the `exportWithRomScript` toggle), so a
  // re-export never costs a ROM rebuild.
  const exportDir = character.exportPath.trim()
  const exportBlock =
    exportDir && bulk
      ? `            // Export to the DTH pipeline via the Exporter Plugin (v1.8.1+).
${buildExportBlock(
  character,
  frames,
  metaDirAbs,
  sceneCsvMap,
  scenesRootAbs,
  bulk,
  hipRefPrefix,
  sceneFrames,
  // The 5-step scale (open 20 / ROM 40 / character 60 / CSV 80 / hair 100)
  // this carrier's job rows declare (`jobStepsForMode`), matching the real
  // runtime order: the CSV delivery sits inside the export core, the hair
  // pass runs after it.
  progressLogPath ? { begin: 40, character: 60, csv: 80, hair: 100 } : undefined,
  // This block only exists in the bulk carrier now, and that carrier always
  // exports hair too.
  true,
)
  .split('\n')
  .map((line) => (line ? `            ${line}` : line))
  .join('\n')}`
      : ''

  const scriptTitle = bulk
    ? `// DTH BULK ROM+Export for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// Executed by the DTH Character Studio Runner plugin on job-file runs (the
// studio's DTH Export button): always builds the ROM and always exports —
// skeleton/mesh AND every hair asset — in ONE unattended pass. The visible
// per-character scripts are the three separate ones (ROM_ / Export_ /
// Export_Hair_); this carrier is the only one that does everything at once.
// Dot-prefixed: hidden from the Content Library.`
    : `// DTH ROM for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.`

  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

${scriptTitle}${sceneSelectBlock ? `
// One script for every linked scene: it applies the open Daz scene's Hair / ROM
// / Genesis-9 overrides by file name at run time (see dthSceneOverrides below);
// the primary scene builds the base config.` : ''}
// DTH-Runtime: v${RUNTIME_VERSION}
// Self-contained: this single ApplyDTHCharacter() call carries the full
// character config AND all ROM morph definitions inline. It needs the DTH
// runtime (the hidden .DthWorkflow.dsa + .DthUtils.dsa + .DthOptions.dsa), which
// the studio installs ONCE in the DTH-Character-Studio root — two levels up from
// this script's <project>/<character>/ subfolder.

var dthCharacterConfig = ${dazJson(config, 2)};
// The verbose progress log (Runner v1.2.0) this run appends its finished
// steps to — '' when this script was generated without one.
var dthProgressLogPath = ${dazJson(progressLogPath)};
// The studio's interrupt flag for this character — '' when this script was
// generated without a meta folder (it is then uninterruptible, as before).
var dthCancelPath = ${dazJson(cancelFlagPath(metaDirAbs))};
// The wrong-scene guard: refuse to build when the OPEN scene isn't one of this
// character's linked scenes (see dthSceneLinkError below the config).
${sceneGuardSnippet(character)}
${openSceneFileSnippet()}${romAnimationSourceSnippet(romAnimationSourceMap(character))}${sceneSelectBlock}
// Write a minimal run log so even a catastrophic failure reaches the studio.
// MERGES like the runtime's writeRunLog (log v2 stores one entry per scene):
// in a batch, scene B's failure must never truncate away what scene A already
// recorded — the pre-v56 truncate here destroyed earlier scenes' failures
// right before the studio could ingest them.
function dthWriteFailureLog(sError) {
    try {
        if (!dthCharacterConfig.runLogPath) return;
        var dthPrevLog = null;
        var dthLogIn = new DzFile(dthCharacterConfig.runLogPath);
        if (dthLogIn.exists() && dthLogIn.open(dthLogIn.ReadOnly)) {
            var dthPrevTxt = String(dthLogIn.read());
            dthLogIn.close();
            try { dthPrevLog = JSON.parse(dthPrevTxt); } catch (ePrev) { dthPrevLog = null; }
        }
        // The scene this failure belongs to: the dthOpenSceneFile capture,
        // declared ABOVE this function (a saved ROM animation is already
        // resolved back to its source scene there) — the typeof guard is
        // belt-and-braces, falling back to the live filename.
        var dthFailScene = "";
        try {
            dthFailScene = (typeof dthOpenSceneFile != "undefined" && dthOpenSceneFile)
                ? String(dthOpenSceneFile) : String(Scene.getFilename());
        } catch (eScn) { /* unsaved scene */ }
        var dthFailSceneName = "";
        if (dthFailScene) {
            try { dthFailSceneName = String(new DzFileInfo(dthFailScene).completeBaseName()); } catch (eSn) {}
        }
        var dthNow = new Date();
        // ALWAYS log v2, previous log or not. The v1 fallback this replaced
        // carried no "scene" field, and the studio DELETES the transport log
        // when it ingests one — so the common case (a second run after the
        // studio has read the first) wrote its failure untagged, and the run
        // report showed a problem it could not attribute to any scene.
        var dthFailKey = dthFailScene.split("\\\\").join("/").toLowerCase();
        var dthKeepRuns = [];
        if (dthPrevLog && dthPrevLog.runs && dthPrevLog.runs.length) {
            // Replace THIS scene's entry, keep every other scene's — the same
            // rule as the runtime's writeRunLog. In a batch, scene B's failure
            // must never truncate away what scene A already recorded.
            for (var dthKi = 0; dthKi < dthPrevLog.runs.length; dthKi++) {
                var dthOldRun = dthPrevLog.runs[dthKi];
                if (!dthOldRun) continue;
                if (String(dthOldRun.scene ? dthOldRun.scene : "").split("\\\\").join("/").toLowerCase() == dthFailKey) continue;
                dthKeepRuns.push(dthOldRun);
            }
        }
        dthKeepRuns.push({
            character: dthCharacterConfig.characterName,
            runtimeVersion: dthCharacterConfig.runtimeVersion,
            studioVersion: dthCharacterConfig.studioVersion,
            finishedAt: dthNow.toString(),
            finishedAtMs: dthNow.getTime(),
            ok: false,
            errors: [String(sError)],
            failedMorphs: [],
            scene: dthFailScene,
            sceneName: dthFailSceneName
        });
        var dthOutRec = {
            logVersion: 2,
            ok: false,
            finishedAt: dthNow.toString(),
            finishedAtMs: dthNow.getTime(),
            character: dthCharacterConfig.characterName,
            runs: dthKeepRuns
        };
        var dthLogFile = new DzFile(dthCharacterConfig.runLogPath);
        // One ORed mode arg — a second open() argument warns on DS6.
        if (dthLogFile.open(dthLogFile.WriteOnly | dthLogFile.Truncate)) {
            dthLogFile.write(JSON.stringify(dthOutRec, null, 2));
            dthLogFile.close();
        }
    } catch (dthLogErr) { /* even the log failed — the dialog still fires */ }
}

// Short + generic on purpose: the details (which morph, which frame, why)
// belong in DTH Character Studio, which reads the run log back.
${unattended ? `// UNATTENDED: no modal, ever. The Runner drives this scene inside a Daz nobody
// is watching, so a dialog here waits forever for a click that never comes — and
// it blocks EVERY row behind it. Measured 2026-08-16 (DS 4.24): a Daz sitting on
// an unclicked modal is indistinguishable from a hung include — the log stops at
// "Loading script", no line is ever written after it, CPU goes flat, and the
// main window is merely disabled rather than obviously blocked. Hours went into
// hunting a runtime that was working perfectly. The failure log is already
// written by the caller; THAT is this script's channel.
function dthFailureDialog() {
    print("DTH Character Studio: the run failed - switch to the studio to see what failed.");
}` : `function dthFailureDialog() {
    MessageBox.critical(
        "Something went wrong while building the ROM.\\\\n\\\\nSwitch back to DTH Character Studio to see what failed.",
        "DTH Character Studio", "&OK");
}`}

// G9 only: switch the Genesis 9 Tear shader's UV set to "UE5" so DTH's Lacrimal
// Fluid material lines up (the UV set is a DzEnumProperty — set it by name through
// the material's UV-set control). Non-fatal: the ROM build proceeds regardless.
function dthApplyUE5TearUV() {
    try {
        var oTear = Scene.findNodeByLabel("Genesis 9 Tear");
        if (!oTear) {
            for (var i = 0; i < Scene.getNumNodes(); i++) {
                var oNode = Scene.getNode(i);
                if (String(oNode.getLabel()).toLowerCase().indexOf("tear") >= 0) { oTear = oNode; break; }
            }
        }
        if (!oTear || !oTear.getObject()) return;
        var oShape = oTear.getObject().getCurrentShape();
        if (!oShape) return;
        for (var m = 0; m < oShape.getNumMaterials(); m++) {
            var oCtrl = oShape.getMaterial(m).getUVSetControl();
            if (oCtrl) oCtrl.setValueFromString("UE5");
        }
    } catch (dthUvErr) { /* leave the tear UV as-is; the ROM build continues */ }
}

${dthProgressSnippet()}
${dthCancelSnippet()}
${runtimeDirSnippet(runtimeRootAbs, '.DthWorkflow.dsa')}
// The include MUST stay at the top level: Daz resolves include() through its
// legacy-include mechanism, which fails inside try/catch ("URIError: Legacy Include").
include(dthRuntimeDir + "/.DthWorkflow.dsa");${indexSync?.morphIndexDir ? `
include(dthRuntimeDir + "/.DthScanMorphs.dsa");` : ''}${indexSync?.products ? `
include(dthRuntimeDir + "/.DthProducts.dsa");` : ''}

// What to report when the include above left us without a runtime. The two
// causes need OPPOSITE advice, and only a probe can tell them apart: a file
// that isn't there wants a reinstall, while a file that IS there means Daz
// failed to load it — a retry, not a repair. Guessing "reinstall" for both
// sends the user to rebuild an install that was never broken.
function dthRuntimeMissingError() {
    var sPath = "";
    var bThere = false;
    try {
        sPath = dthRuntimeDir + "/.DthWorkflow.dsa";
        bThere = new DzFile(sPath).exists();
        // Tidy any '../../' out of the path before showing it - best effort,
        // the raw form is already correct.
        try { sPath = String(new DzFileInfo(sPath).absoluteFilePath()); } catch (dthAbsErr) {}
    } catch (dthRtErr) { /* couldn't even resolve it - the advice below still holds */ }
    if (bThere) {
        return "The DTH runtime could not be loaded, so the ROM was NOT built - nothing in this scene was changed.\\n\\nThe runtime file is where it belongs (" + sPath + "), so Daz failed to load it rather than to find it. Nothing is broken on disk: run the export again.";
    }
    // Name EVERY probed location plus where this script believed it was - the
    // one time this fired for real, that self-report (a Daz-internal path) WAS
    // the diagnosis, and a report without it can only be re-guessed at.
    var sWhere = "\\n\\nExpected it at: " + (sPath ? sPath : "the DTH-Character-Studio scripts folder");
    if (dthBakedRuntimeDir != "" && dthRuntimeDir != dthBakedRuntimeDir) {
        sWhere += "\\nAlso probed the studio's install root: " + dthBakedRuntimeDir + "/.DthWorkflow.dsa";
    }
    sWhere += "\\n(this script reported its own folder as: " + (dthSelfDir != "" ? dthSelfDir : "<empty>") + ")";
    return "The DTH runtime (.DthWorkflow.dsa) is missing, so the ROM was NOT built - nothing in this scene was changed." + sWhere + "\\n\\nReinstall it from DTH Character Studio: save the character, or Tools > Refresh assets.";
}

var dthSceneLinkErr = dthSceneLinkError();
if (dthSceneLinkErr) {
    // Wrong (or unsaved) scene open — refuse before touching anything, and log
    // it so the studio's run report names the aborted run too.
    dthWriteFailureLog(dthSceneLinkErr);
${unattended ? `    // No modal — see dthFailureDialog. A wrong-scene refusal is the single
    // most likely thing to greet an unattended batch, so it is also the most
    // expensive place to wait for a click.
    print("DTH Character Studio: " + dthSceneLinkErr);` : `    MessageBox.critical(dthSceneLinkErr, "DTH Character Studio", "&OK");`}
} else if (dthCancelRequested()) {
    // The studio interrupted the run before this row's turn came. The Runner
    // still opens each remaining scene and executes this script — it owns the
    // batch and cannot be told otherwise — so the row's whole job is to be
    // cheap and to SAY it was skipped: silently returning would let the studio
    // report a batch that never ran as a batch that ran.
    print("DTH Character Studio: the export was interrupted - this scene was skipped.");
    dthProgressLog(100, "skipped - the export was interrupted");
} else if (typeof ApplyDTHCharacter != "function") {
    // Runtime not loaded — report instead of crashing. WHY it isn't loaded
    // decides what the user should do, and only this script can tell: a failed
    // include() logs NOTHING in Daz, so without the probe below a one-off
    // failure leaves no evidence at all and the report can only guess
    // "reinstall" — advice that is simply wrong when the file is right there.
    dthWriteFailureLog(dthRuntimeMissingError());
    dthFailureDialog();
} else {
    try {
${indentLines(indentLines(indexSyncSnippet(indexSync)))}        // Start marker: the ROM build begins (the percent stays at the
        // scene-open step — only the status text moves until it finishes).
        dthProgressLog(${exportBlock ? 20 : 50}, "generating ROM");
        var dthRomOk = ApplyDTHCharacter(dthCharacterConfig);
        // G9: retarget the tear shader's UV set to UE5 after the ROM (before any
        // export). No-op unless the character opted in.
        if (dthCharacterConfig.bApplyUE5TearUV) { dthApplyUE5TearUV(); }
        // Keep the built ROM reopenable: save the scene as <stem>_ROM.duf into
        // the ${ROM_ANIMATIONS_FOLDER} subfolder BESIDE the source scene, BEFORE
        // any export — the user can open the generated ROM animation any time
        // later without the (slow) rebuild. Save-as repoints the open scene's
        // filename, which is why every scene-keyed lookup below reads the
        // dthOpenSceneFile capture, never Scene.getFilename(). Best effort: a
        // failed save must not stop the export.
        if (dthRomOk === true && dthOpenSceneFile != "") {
            try {
                var dthRomSceneInfo = new DzFileInfo(dthOpenSceneFile);
                var dthRomSaveDir = dthRomSceneInfo.path() + "/${ROM_ANIMATIONS_FOLDER}";
                var dthRomSaveDirObj = new DzDir(dthRomSaveDir);
                if (!dthRomSaveDirObj.exists()) dthRomSaveDirObj.mkpath(dthRomSaveDir);
                var dthRomSavePath = dthRomSaveDir + "/" + dthRomSceneInfo.completeBaseName() + "_ROM.duf";
                // DS4 saves through the content manager; DS6 dropped that
                // method and moved save-as onto Scene (probe-measured
                // 2026-07-30 — DzContentMgr.saveScene is a TypeError there).
                // DO NOT interpret the return value. Every Daz build disagrees
                // about it: the content manager has answered a plain bool, a
                // DzError where 0 IS success (DS6 — runtime v45 chased that
                // one), and void in DS4, which logged a perfectly good save as
                // a failure while Daz's own log said "Saved Scene".
                //
                // Existence alone is NOT the answer either: this file is
                // overwritten every run, so after the first one it is already
                // there and a FAILED save would report success while the stale
                // previous ROM sits on disk waiting to be exported as fresh.
                // The timestamp has to MOVE. A file that wasn't there before is
                // proof by itself; when neither timestamp can be read (an older
                // build without DzFileInfo.lastModified) existence is all we
                // have, so accept it rather than cry wolf.
                var dthRomInfoBefore = new DzFileInfo(dthRomSavePath);
                var dthRomExisted = dthRomInfoBefore.exists();
                var dthRomMsBefore = -1;
                if (dthRomExisted) {
                    try { dthRomMsBefore = dthRomInfoBefore.lastModified().getTime(); } catch (dthMsErr) {}
                }
                if (typeof App.getContentMgr().saveScene == "function") {
                    App.getContentMgr().saveScene(dthRomSavePath);
                } else if (typeof Scene.saveScene == "function") {
                    Scene.saveScene(dthRomSavePath);
                }
                var dthRomInfoAfter = new DzFileInfo(dthRomSavePath);
                var dthRomSaved = false;
                if (dthRomInfoAfter.exists()) {
                    if (!dthRomExisted) {
                        dthRomSaved = true;
                    } else {
                        var dthRomMsAfter = -1;
                        try { dthRomMsAfter = dthRomInfoAfter.lastModified().getTime(); } catch (dthMsErr2) {}
                        dthRomSaved =
                            (dthRomMsBefore < 0 || dthRomMsAfter < 0) || dthRomMsAfter != dthRomMsBefore;
                    }
                }
                if (dthRomSaved) {
                    print("ROM scene saved: " + dthRomSavePath);
                } else {
                    print("Could not save the ROM scene to " + dthRomSavePath + " - the file on disk is unchanged, so it still holds the PREVIOUS run's ROM.");
                }
            } catch (dthSaveErr) {
                print("ROM-scene save failed: " + dthSaveErr);
            }
        }
        // The ROM step is complete (build + reopenable save): 40% on the
        // 5-step export scale, 100% when this carrier's whole job IS the ROM.
        if (dthRomOk === true) {
            dthProgressLog(${exportBlock ? 40 : 100}, "ROM generated");
        }${exportBlock ? `
        // The last stop point of this scene, and the cheapest one: an interrupt
        // that landed while the ROM was building (or during the ROM-scene save,
        // past the runtime's own checkpoints) skips the export — minutes of
        // exporter work the user has just asked not to happen, at a boundary
        // where nothing has been written into the export folder yet. Probed
        // ONCE, so the gate below can't disagree with the message above it.
        var dthCancelledAfterRom = dthRomOk === true && dthCancelRequested();
        if (dthCancelledAfterRom) {
            print("DTH Character Studio: the export was interrupted - the ROM is built, the export was skipped.");
            dthProgressLog(40, "stopped after the ROM - the export was interrupted");
        }
        // Export only when the ROM built CLEAN (runtime v20: failed morphs count
        // as failure too, not just hard aborts) — a broken ROM must never ship
        // a PoseAsset CSV/FBX as if it were good. Fix the problem and re-run.
        if (dthRomOk === true && !dthCancelledAfterRom) {
${exportBlock}        }` : ''}
    } catch (dthErr) {
        // Unexpected exception — ApplyDTHCharacter couldn't log/report it itself.
        dthWriteFailureLog("Unexpected script error: " + dthErr);
        dthFailureDialog();
    }
}
`
  if (bulk) {
    // Hidden (dot-prefixed) → the Content Library never shows it: no tile.
    return { fileName: BULK_ROM_EXPORT_SCRIPT, content, target: 'daz' }
  }
  const baseName = characterScriptName(character)
  return {
    fileName: `ROM_${baseName}.dsa`,
    content,
    target: 'daz',
    // Always the plain ROM tile: this script builds the ROM and nothing else
    // now, so there is no combined variant left for the artwork to distinguish.
    icon: 'rom',
  }
}

/**
 * The standalone Export script (`Export_<Name>_<Genesis>.dsa`) — runs the DTH
 * Exporter on the ROM already built on the timeline and delivers the PoseAsset
 * CSV, without rebuilding the (slow) ROM. Generated whenever an export dir is
 * set — the export is ALWAYS its own script now. Native Daz API only — no runtime
 * include — so it must run after the ROM_ script in the same Daz session.
 * The `dthFig` figure auto-select comes from dz-snippets
 * ({@link figureAutoSelectSnippet}).
 */
export function toExportScriptDsa(
  character: Character,
  frames?: PresetFrames,
  metaDirAbs?: string,
  /** See {@link sceneExportSubfolders}. */
  scenesRootAbs?: string,
  /** Emitted for the Runner's unattended export-only carrier — suppresses the
   *  modal alerts, which would block a batch (see {@link buildExportBlock}). */
  unattended = false,
  /** `$HIP`-anchored prefix for bone-scale reference paths ('' = absolute) —
   *  see {@link buildExportBlock}. */
  hipRefPrefix = '',
  /** Scan-sync settings — see {@link IndexSyncOptions}. */
  indexSync?: IndexSyncOptions,
  /** Per-scene preset-block frames — see {@link buildExportBlock}. */
  sceneFrames: Record<string, PresetFrames> = {},
  /** The Runner-v1.2.0 verbose progress log — see {@link dthProgressSnippet}.
   *  '' = the script logs no progress. */
  progressLogPath = '',
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
  /** Inline the hair pass behind the main export — see {@link buildExportBlock}.
   *  Only the Runner's export-only bulk twin sets it; the VISIBLE Export_ script
   *  leaves hair to the standalone `Export_Hair_…`. */
  hairPass = false,
): GeneratedFile {
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Export for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Runs the DTH Exporter on the ROM already built on the timeline and delivers
// the PoseAsset CSV — it does NOT rebuild the ROM. Run it after the ROM script
// (ROM_${characterScriptName(character)}.dsa) in the same Daz session.
${runtimeIncludeBlock(runtimeRootAbs, indexSync)}
var dthProgressLogPath = ${dazJson(progressLogPath)};
// The studio's interrupt flag for this character — see EXPORT_CANCEL_FILE.
var dthCancelPath = ${dazJson(cancelFlagPath(metaDirAbs))};
${sceneGuardSnippet(character)}
${openSceneFileSnippet()}${romAnimationSourceSnippet(romAnimationSourceMap(character))}
${dthProgressSnippet()}
${dthCancelSnippet()}
${figureAutoSelectSnippet(character.genesis)}var dthSceneLinkErr = dthSceneLinkError();
if (dthSceneLinkErr) {
${unattended ? `    // No modal: the Runner drives this one. \`unattended\` used to reach only
    // the export block below, so the two guards that fire FIRST — and that a
    // batch is most likely to hit — could still stop everything on a dialog.
    print("DTH Character Studio: " + dthSceneLinkErr);` : `    MessageBox.critical(dthSceneLinkErr, "DTH Character Studio", "&OK");`}
} else if (dthCancelRequested()) {
    // Interrupted before this row's turn — skip the scene and say so (the
    // bulk carrier's twin; see the ROM script's branch for why it must speak).
    print("DTH Character Studio: the export was interrupted - this scene was skipped.");
    dthProgressLog(100, "skipped - the export was interrupted");
} else if (!dthFig) {
${unattended ? `    // print only: this carrier has no dthWriteFailureLog (that lives in the ROM
    // script), and the Runner's progress log below is what the studio reads.
    print("DTH Character Studio: no ${character.genesis} figure found in the scene - nothing was exported.");
    dthProgressLog(100, "no figure found - nothing was exported");` : `    MessageBox.critical("No ${character.genesis} figure found in the scene - load the character's scene and re-run.", "DTH Character Studio", "&OK");`}
} else {
${indentLines(indexSyncSnippet(indexSync))}${buildExportBlock(
    character,
    frames,
    metaDirAbs,
    buildSceneCsvMap(character),
    scenesRootAbs,
    unattended,
    hipRefPrefix,
    sceneFrames,
    // The 4-step scale (open 25 / character 50 / CSV 75 / hair 100) the
    // export-only job rows declare — no ROM step in this carrier.
    progressLogPath ? { begin: 25, character: 50, csv: 75, hair: 100 } : undefined,
    hairPass,
  )
  .split('\n')
  .map((line) => (line ? `    ${line}` : line))
  .join('\n')}}
`
  return {
    fileName: `Export_${characterScriptName(character)}.dsa`,
    content,
    target: 'daz',
    icon: 'export',
  }
}

/**
 * The hidden EXPORT-ONLY variant ({@link BULK_EXPORT_ONLY_SCRIPT}) the Runner
 * executes for DTH Export's "Export only" mode: the same standalone export
 * ({@link toExportScriptDsa}'s builder, so the two can never drift) with the
 * hair pass FORCED on — it exports skeleton/mesh and every hair asset from the
 * ROM already on the timeline, rebuilding nothing.
 *
 * Its job rows open the SAVED ROM animation instead of the source scene (that
 * is where the ROM lives); the embedded {@link romAnimationSourceMap} maps the
 * open file back, so the guard and every scene-keyed lookup behave as if the
 * source scene were open. Only meaningful with an export dir — generateAll
 * emits it exactly then, next to the bulk ROM script.
 */
export function toBulkExportOnlyScriptDsa(
  character: Character,
  frames?: PresetFrames,
  metaDirAbs?: string,
  scenesRootAbs?: string,
  /** `$HIP`-anchored prefix for bone-scale reference paths ('' = absolute) —
   *  see {@link buildExportBlock}. */
  hipRefPrefix = '',
  /** Scan-sync settings — see {@link IndexSyncOptions}. */
  indexSync?: IndexSyncOptions,
  /** Per-scene preset-block frames — see {@link buildExportBlock}. */
  sceneFrames: Record<string, PresetFrames> = {},
  /** See {@link buildRomScriptDsa}. */
  progressLogPath = '',
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): GeneratedFile {
  const built = toExportScriptDsa(
    character,
    frames,
    metaDirAbs,
    scenesRootAbs,
    // The Runner executes this one — no modals.
    true,
    hipRefPrefix,
    indexSync,
    sceneFrames,
    progressLogPath,
    runtimeRootAbs,
    // …and it does the WHOLE export in one pass, hair included.
    true,
  )
  // Hidden (dot-prefixed) → the Content Library never shows it: no tile.
  return { fileName: BULK_EXPORT_ONLY_SCRIPT, content: built.content, target: 'daz' }
}

/**
 * The standalone Hair export script (`Export_Hair_<Name>_<Genesis>.dsa`) — the
 * "hair" (Daz's term; it becomes a "groom" only in Houdini/Unreal). The DTH
 * Groom Guide's "Export Alembic Groom Poses" step as one generated,
 * non-destructive script for the OPEN scene's hair items (per-scene map, resolved
 * at run time like the export bracket). Exports **each hair item on its own**:
 * for every item it hides every other wearable (INCLUDING the other hair items;
 * plugin 2.0+ skips hidden nodes) leaving only that item + the Genesis body-part
 * figures fitted, calls the exporter's documented
 * `doExportAlembicGroomPoses(path, name, saveSettings=false)` (probed July 17:
 * a 2-arg call crashes Daz in the settings-save path — ALWAYS pass false), and
 * restores the exact per-node flags in a finally before the next item. Output:
 * one `<Name>_Hair_<item>_grooms.abc` per item next to the ROM artifacts (2
 * frames: rest + UE5 pose — Houdini's DazToHueGroom Import reads its hair groups
 * from it). Run it on the character's scene with the figure selected; ROM not needed.
 */
export function toGroomExportScriptDsa(
  character: Character,
  scenesRootAbs?: string,
  /** Scan-sync settings — see {@link IndexSyncOptions}. A groom export runs on
   *  a verified scene like every other export, so it keeps the scan data
   *  current too (the v55 contract). */
  indexSync?: IndexSyncOptions,
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): GeneratedFile {
  const exportDir = character.exportPath.trim().replace(/\\/g, '/')
  const groomMap = groomSceneMap(character)
  // The same snippet body the ROM/Export export block uses (dz-snippets), at
  // this script's base indent 0 (no exportName — hair keeps its own
  // <slug>_Hair_<item> names), so grooms land beside the main export in
  // <exportPath>/<scene-sub>/.
  const sceneSubfolderBlock = sceneExportSubfolderSnippet(
    sceneExportSubfolders(character, scenesRootAbs),
  )
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Hair Export for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// The Groom Guide's "Export Alembic Groom Poses" step, automated PER HAIR ITEM:
// for each of the open scene's hair items it hides every other wearable (the
// item stays FITTED, as worn), exports its 2-frame Alembic as <Name>_Hair_<item>
// via the DTH Exporter, restores the scene. Run it on the character's scene with
// the figure selected; the ROM is NOT needed.
${runtimeIncludeBlock(runtimeRootAbs, indexSync)}
${sceneGuardSnippet(character)}
${openSceneFileSnippet()}${romAnimationSourceSnippet(romAnimationSourceMap(character))}
var dthAction = MainWindow.getActionMgr().findAction("DazToHueExporterAction");
${figureAutoSelectSnippet(character.genesis)}var dthSceneLinkErr = dthSceneLinkError();
if (dthSceneLinkErr) {
    MessageBox.critical(dthSceneLinkErr, "DTH Character Studio", "&OK");
} else if (!dthAction) {
    MessageBox.critical("DazToHue Exporter Action not found - install the DTH Exporter Plugin v2.0+.", "DTH Character Studio", "&OK");
} else if (!dthFig || !dthFig.inherits("DzNode")) {
    MessageBox.critical("No ${character.genesis} figure found in the scene - load the character's scene and re-run.", "DTH Character Studio", "&OK");
} else {
${indentLines(indexSyncSnippet(indexSync))}${groomSceneLookupSnippet(groomMap)}
    if (dthGroomLabels.length == 0) {
        MessageBox.information("The open scene has no hair list in DTH Character Studio - nothing to export. Open one of the character's scenes with hair items defined.", "DTH Character Studio", "&OK");
    } else {
        var dthExportDir = ${dazJson(exportDir)};
${sceneSubfolderBlock}${indentLines(hideTreeSnippet('dthHideTree', 'dthHidden'))}
${indentLines(indentLines(hairExportLoopSnippet(character, { fig: 'dthFig', action: 'dthAction', hideTree: 'dthHideTree', hidden: 'dthHidden' }).trimEnd()))}
    }
}
`
  return {
    fileName: `Export_Hair_${characterScriptName(character)}.dsa`,
    content,
    target: 'daz',
    icon: 'export-hair',
  }
}
/** Inputs for the per-character product-scan script — both supplied by the host
 *  (the studio), never by the pure core. Present ⇔ the project opted into the
 *  Daz Products feature. */
export interface ScanProductsOptions {
  /** The DAZ Install Manager `ManifestFiles` folder the scan reads installed
   *  products from (app-global setting). May be '' — the runtime then warns and
   *  reports every asset as unmatched. */
  dimManifestPath: string
  /** Absolute path of the FOLDER the scan writes its per-scene CSVs into (app-derived,
   *  under app-local-data, keyed by project + character). The runtime names each CSV
   *  after the open Daz scene, so scanning different outfit scenes doesn't overwrite. */
  outputDir: string
  /** The DAZ content library root (settings `dazLibraryFolder`). Lets the scan read
   *  each matched product's content-metadata `.dsx` (under `Runtime/Support/`) to
   *  fill in the artist (and version, when present). May be '' — enrichment is then
   *  skipped and artist/version stay "Unknown". */
  dazLibraryFolder: string
}

/**
 * The per-character product-scan script (`Scan_Products_<Name>.dsa`). Run in Daz
 * with the character's scene already OPEN: it includes the DthProducts runtime
 * (installed alongside the other runtime files) and calls `DthScanProducts()`,
 * which analyses the open scene, matches used assets to installed DIM products,
 * and writes the result as a CSV named after the open scene inside `outputDir`. The
 * character's identity is embedded so the studio can locate + attribute the results,
 * and each scene gets its own CSV so outfit variants don't overwrite one another.
 * Emitted only when the project enables the Daz Products feature.
 */
export function toScanProductsScriptDsa(
  character: Character,
  opts: ScanProductsOptions,
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): GeneratedFile {
  // Forward-slash both paths (DzFile/DzDir want '/' on Windows; matches the
  // export block) — JSON.stringify still escapes any remaining backslashes.
  const config = {
    characterId: character.id,
    characterName: character.name,
    genesis: character.genesis,
    dimManifestPath: opts.dimManifestPath.replace(/\\/g, '/'),
    outputDir: opts.outputDir.replace(/\\/g, '/'),
    dazLibraryFolder: opts.dazLibraryFolder.replace(/\\/g, '/'),
  }
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Product Scan for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Analyses the scene CURRENTLY OPEN in Daz — open ${commentSafe(character.name)}'s scene first,
// then run this. It needs the DTH runtime (the hidden .DthProducts.dsa +
// .DthUtils.dsa), which the studio installs ONCE in the DTH-Character-Studio root
// — two levels up from this script's <project>/<character>/ subfolder. The found
// products are written as a CSV the studio reads back on the character page.

${sceneGuardSnippet(character)}
${openSceneFileSnippet()}${romAnimationSourceSnippet(romAnimationSourceMap(character))}
${runtimeDirSnippet(runtimeRootAbs, '.DthProducts.dsa')}
include(dthRuntimeDir + "/.DthProducts.dsa");

var dthSceneLinkErr = dthSceneLinkError();
if (dthSceneLinkErr) {
    // A wrong-scene scan would silently attribute another scene's products to
    // this character — refuse, like the ROM/export scripts.
    MessageBox.critical(dthSceneLinkErr, "DTH Character Studio", "&OK");
} else {
    DthScanProducts(${dazJson(config, 2)});
}
`
  return {
    fileName: `Scan_Products_${characterSlug(character)}.dsa`,
    content,
    target: 'daz',
    icon: 'scan-products',
  }
}

/**
 * The files written on save: the one self-contained character script (Daz) and
 * the PoseAsset CSV (Houdini), plus the Export_ script (whenever an export dir
 * is set) and the per-character product-scan script. Everything the character script needs (FBM
 * frames, art direction) is inlined via {@link buildFbmData} /
 * {@link buildArtDirectionData}. Every linked scene is served by the ONE
 * character script (it selects the open scene's overrides at run time); a
 * ROM-override scene additionally gets its own scene-suffixed PoseAsset CSV,
 * since its Houdini side (no runtime) can't select frames.
 */
export function generateAll(
  character: Character,
  romPaths: RomPaths,
  frames: PresetFrames,
  /** Absolute path of the character's `.dcsmeta` folder — see
   *  {@link toCharacterScriptDsa}. The PoseAsset CSVs below are written there. */
  metaDirAbs?: string,
  /** Active DTH release version at generation time (e.g. "2.4.3"). Only the CSV
   *  depends on the release — it selects the CSV era/variant (see
   *  {@link poseAssetCsvEra}); the Daz scripts are release-independent (tied to
   *  RUNTIME_VERSION only), so it isn't threaded into them. */
  dthReleaseVersion?: string,
  /** When set (the project enabled Daz Products), also emit the per-character
   *  `Scan_Products_<Name>.dsa`. The flag reaches the pure core only here — the
   *  core never imports host/app state. */
  scanProducts?: ScanProductsOptions,
  /** Per-scene re-resolved rom paths / preset-block frames (host-resolved from each
   *  `mergeSceneOverride(...)`), keyed by the scene's normalized path — see
   *  {@link toCharacterScriptDsa}. A scene's frames also size its per-scene CSV. */
  sceneRomPaths: Record<string, RomPaths> = {},
  sceneFrames: Record<string, PresetFrames> = {},
  /** The character's scenes-root folder, host-resolved (charFolder + the
   *  project's dazSubdir rules) — each scene's export nests under its own
   *  subfolder below this root; see {@link sceneExportSubfolders}. Omitted ⇒
   *  every scene falls back to stem-named export subfolders. */
  scenesRootAbs?: string,
  /** `$HIP`-anchored prefix for bone-scale reference paths ('' = absolute,
   *  project "Houdini path style"). See {@link buildExportBlock}. */
  hipRefPrefix = '',
  /** Scan-sync settings for the generated ROM/export scripts — see
   *  {@link IndexSyncOptions}. Omitted = the scripts scan nothing. */
  indexSync?: IndexSyncOptions,
  /** The Runner-v1.2.0 verbose progress log every generated carrier appends
   *  its finished steps to (host-resolved app-data path). '' = no progress. */
  progressLogPath = '',
  /** Absolute path of the DTH-Character-Studio scripts root the runtime is
   *  installed in (host-resolved) - baked into the generated script as the
   *  fallback for the one measured way getScriptFileName() lies; see
   *  {@link runtimeDirSnippet}. '' = no fallback (pure/web contexts). */
  runtimeRootAbs = '',
): Array<GeneratedFile> {
  // An export dir means the standalone Export_ script, always: the visible
  // scripts are one job each (ROM_ builds, Export_ exports, Export_Hair_ grooms),
  // never a combined one. The gate is the export dir alone now — the shape used
  // to be the `exportWithRomScript` toggle.
  const exportSet = character.exportPath.trim() !== ''
  // …and hair items on top of that -> also the standalone groom (.abc) script.
  // Still gated on the LABELS: a character with no hair listed anywhere has
  // nothing for that script to export, so it would only be a dead tile.
  const groom = exportSet && Object.keys(groomSceneMap(character)).length > 0
  const era = poseAssetCsvEra(dthReleaseVersion ?? '')
  const sceneKey = (scenePath: string) => scenePath.trim().replace(/\\/g, '/').toLowerCase()
  // A scene whose FRAME layout differs gets its OWN PoseAsset CSV from the merged
  // sections, sized by that scene's own preset-block frames (a per-scene preset/mode
  // change re-measures the blocks); the one script's export block delivers the right
  // CSV by open scene. Art-direction-/identity-/jcm-/groom-only overrides keep the base
  // frames (their effect is a run-time delta / hair list), so they ride the base CSV.
  const overrideCsvs = activeSceneOverrides(character)
    .filter((override) => sceneOverrideBuildsRom(character, override))
    .map((override) =>
      toPoseAssetCsv(
        mergeSceneOverride(character, override),
        sceneFrames[sceneKey(override.scenePath)] ?? frames,
        era,
        sceneOverrideSlug(override.scenePath),
      ),
    )
  return [
    toCharacterScriptDsa(
      character,
      romPaths,
      frames,
      metaDirAbs,
      sceneRomPaths,
      sceneFrames,
      scenesRootAbs,
      hipRefPrefix,
      indexSync,
      progressLogPath,
      runtimeRootAbs,
    ),
    ...(exportSet
      ? [
          toExportScriptDsa(
            character,
            frames,
            metaDirAbs,
            scenesRootAbs,
            false,
            hipRefPrefix,
            // The v55 contract — every ROM/export run scans the scene — holds
            // for the standalone export too.
            indexSync,
            sceneFrames,
            progressLogPath,
            runtimeRootAbs,
          ),
        ]
      : []),
    // The hidden bulk script the Runner executes on DTH Export runs — always
    // ROM + always full export, so it only exists WITH an export dir.
    ...(exportSet
      ? [
          toBulkRomExportScriptDsa(
            character,
            romPaths,
            frames,
            metaDirAbs,
            sceneRomPaths,
            sceneFrames,
            scenesRootAbs,
            hipRefPrefix,
            indexSync,
            progressLogPath,
            runtimeRootAbs,
          ),
          // …and its export-only twin (DTH Export's "Export only" mode): the
          // exporter + hair pass over an already-built ROM, no rebuild.
          toBulkExportOnlyScriptDsa(
            character,
            frames,
            metaDirAbs,
            scenesRootAbs,
            hipRefPrefix,
            indexSync,
            sceneFrames,
            progressLogPath,
            runtimeRootAbs,
          ),
        ]
      : []),
    // The hidden ROM-only script ("Open and Generate ROM Animation"): builds
    // the ROM + saves the rom-animations copy, never exports — so it exists
    // for every character (the save needs no export dir).
    toBuildRomAnimationScriptDsa(
      character,
      romPaths,
      frames,
      metaDirAbs,
      sceneRomPaths,
      sceneFrames,
      scenesRootAbs,
      indexSync,
      progressLogPath,
      runtimeRootAbs,
    ),
    ...(groom ? [toGroomExportScriptDsa(character, scenesRootAbs, indexSync, runtimeRootAbs)] : []),
    ...(scanProducts ? [toScanProductsScriptDsa(character, scanProducts, runtimeRootAbs)] : []),
    toPoseAssetCsv(character, frames, era),
    ...overrideCsvs,
  ]
}
