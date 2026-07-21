import { exporterFigureName, poseAssetFileName, referenceFrames, toPoseAssetCsv } from './csv'
import {
  commentSafe,
  dazJson,
  figureAutoSelectSnippet,
  groomSceneLookupSnippet,
  hideTreeSnippet,
  indentLines,
  sceneConfigLookupSnippet,
  sceneCsvLookupSnippet,
  sceneSubfolderSnippet,
} from './dz-snippets'
import { flattenRom, jcmIsBaseRom, presetSelections } from './frames'
import {
  activeSceneOverrides,
  mergeSceneOverride,
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
import type { ArtDirectionFrame, Character } from './types'

/**
 * The `.dsa` generators: the self-contained character/ROM script, the split
 * Export script, the groom (hair) export, the product scan — plus the
 * generateAll entry point that pairs them with the
 * PoseAsset CSV (csv.ts). Formats are taken from real files in
 * soltude/DazToHue-Scripts (ElectraG9_FBMs.json / .csv, DthWorkflowElectraG9.dsa)
 * and from the PoseAsset node CSV sample provided by mrpdean. Catalog/path
 * resolution lives in resolve.ts; reusable DzScript text in dz-snippets.ts.
 */

function morphJson(morph: { node: string; prop: string; value: number; base?: number; autoBase?: boolean }) {
  return {
    node: morph.node,
    prop: morph.prop,
    value: morph.value,
    ...(morph.base !== undefined ? { base: morph.base } : {}),
    ...(morph.autoBase ? { autoBase: true } : {}),
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
 *  character folder (fixed name — the studio reads it back to surface errors). */
export const ROM_RUN_LOG_FILE = 'dth_rom_run_log.json'

/**
 * The DTH-Exporter run + PoseAsset-CSV delivery, as a Daz Script block. Pure
 * native Daz API (no DTH runtime needed), so it works both appended to the ROM
 * script and as the body of a standalone Export script. Empty when no export dir
 * is set. The CSV copy is included only when the source folder is known
 * (charFolderAbs); the export nests under the open scene's name when
 * `exportSceneSubfolders` is on (resolved at run time).
 */
function buildExportBlock(
  character: Character,
  frames: PresetFrames | undefined,
  charFolderAbs: string | undefined,
  /** Scene → PoseAsset-CSV-name lookup: the ROM-override scenes whose delivered
   *  CSV is the scene-suffixed one. Empty ⇒ every scene rides the base CSV. */
  sceneCsvMap: Record<string, string> = {},
): string {
  const exportDir = character.exportPath.trim()
  if (!exportDir) return ''
  const refFrames = frames ? referenceFrames(character, frames).join(' ') : ''
  // ONE snippet body shared with the groom export (dz-snippets), re-indented to
  // this block's 4-space base — the two copies used to differ only in indent.
  const sceneSubfolderBlock = character.exportSceneSubfolders
    ? indentLines(sceneSubfolderSnippet())
    : ''
  // The CSV to deliver: the base name, or — when some linked scene overrides the
  // ROM — the open scene's scene-suffixed CSV, resolved at run time. Kept
  // self-contained (declares its own dthCsvScene) so the block works both
  // appended to the ROM script and as the standalone Export_ script.
  const csvNameBlock =
    Object.keys(sceneCsvMap).length === 0
      ? `    var dthCsvName = ${dazJson(poseAssetFileName(character))};`
      : indentLines(sceneCsvLookupSnippet(poseAssetFileName(character), sceneCsvMap).trimEnd())
  const csvCopyBlock = charFolderAbs
    ? `    // Copy the generated PoseAsset CSV next to the exporter output, resolving
    // the {{DTH_EXPORT_DIR}} token in any bone-scale reference-FBX path to the
    // real (run-time) export dir — Houdini's PoseAsset wants absolute paths, and
    // the dir (scene subfolder included) is only known now. Source is left intact
    // so the next scene's export can reuse it.
${csvNameBlock}
    var dthCsvSrcDir = new DzDir(${dazJson(charFolderAbs.replace(/\\/g, '/'))});
    if (dthCsvSrcDir.exists(dthCsvName)) {
        var dthCsvDstDir = new DzDir(dthExportDir);
        if (!dthCsvDstDir.exists()) dthCsvDstDir.mkpath(dthExportDir);
        var dthCsvDst = dthCsvDstDir.absoluteFilePath(dthCsvName);
        var dthCsvSrc = new DzFile(dthCsvSrcDir.absoluteFilePath(dthCsvName));
        if (dthCsvSrc.open(dthCsvSrc.ReadOnly)) {
            var dthCsvText = String(dthCsvSrc.read());
            dthCsvSrc.close();
            dthCsvText = dthCsvText.split("{{DTH_EXPORT_DIR}}").join(dthExportDir);
            var dthCsvOut = new DzFile(dthCsvDst);
            if (dthCsvOut.open(dthCsvOut.WriteOnly | dthCsvOut.Truncate)) {
                dthCsvOut.write(dthCsvText);
                dthCsvOut.close();
                print("Copied " + dthCsvName + " to " + dthCsvDst);
            } else print("Failed to write " + dthCsvName + " to " + dthCsvDst);
        } else print("Failed to read " + dthCsvName + " for copy.");
    } else {
        print("PoseAsset CSV not found in the character folder — nothing to copy.");
    }
`
    : ''
  // The export call + CSV delivery. With groom items listed it is wrapped in the
  // hide bracket below; without any, the emitted script is unchanged.
  const exportCore = `    dthExportAction.doExport(dthExportDir, ${dazJson(exporterFigureName(character))}, ${dazJson(refFrames)}, false);
${csvCopyBlock}`
  const groomMap = groomSceneMap(character)
  const indentBlock = indentLines
  const exportBody =
    Object.keys(groomMap).length === 0
      ? exportCore
      : `    // Hair items must stay OUT of the export. HIDE the item + all its
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
${groomSceneLookupSnippet(groomMap)}
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
        print("Hair item not found: " + dthGroomMissing + " - export skipped.");
        MessageBox.critical("The hair item \\"" + dthGroomMissing + "\\" was not found in the scene.\\n\\nCheck the Hair list in DTH Character Studio - the label must match Daz's Scene pane exactly - then run the export again.", "DTH Character Studio", "&OK");
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
    }
    }
`
  return `var dthExportAction = MainWindow.getActionMgr().findAction("DazToHueExporterAction");
if (dthExportAction) {
    var dthExportDir = ${dazJson(exportDir.replace(/\\/g, '/'))};
${sceneSubfolderBlock}${exportBody}} else {
    print("DazToHue Exporter Action not found — install the DTH Exporter Plugin v1.8.1+.");
}
`
}

/**
 * The character's per-SCENE groom lists as a lookup the generated script embeds:
 * normalized scene path (forward slashes, lowercased) → trimmed non-empty item
 * labels. Scenes without items are dropped — absence MEANS "this scene has no
 * groom to exclude". Hair is per-scene by presence: a scene's `groomScenes`
 * items ARE its hair (none listed → nothing excluded). THE single gate for the
 * export bracket.
 */
function groomSceneMap(character: Character): Record<string, Array<string>> {
  const map: Record<string, Array<string>> = {}
  for (const entry of character.groomScenes) {
    const key = entry.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    const labels = entry.nodes.map((n) => n.nodeLabel.trim()).filter((label) => label !== '')
    if (key !== '' && labels.length > 0) map[key] = labels
  }
  return map
}

/**
 * The run-time config deltas the ONE character script embeds: normalized scene
 * path → the handful of `dthCharacterConfig` fields the open scene overrides. A
 * ROM override contributes a fresh `extraFrames` (from the merged sections); an
 * identity override contributes the Genesis-9 dials (FACS detail / flexion /
 * UE5 tear UV, each honouring the same G9 gate as the base config). A scene with
 * no field to change is dropped. Same key normalization as {@link groomSceneMap}.
 */
function buildSceneConfigMap(character: Character): Record<string, Record<string, unknown>> {
  const g9Dials = GENERATIONS[character.genesis].hasStrengthDials
  const map: Record<string, Record<string, unknown>> = {}
  for (const override of activeSceneOverrides(character)) {
    const key = override.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    if (key === '') continue
    const delta: Record<string, unknown> = {}
    if (override.enabled) delta.extraFrames = buildFbmData(mergeSceneOverride(character, override))
    if (override.identity.enabled) {
      delta.FACsDetailStrength = g9Dials ? override.identity.facsDetailStrength : 0
      delta.FlexionStrength = g9Dials ? override.identity.flexionStrength : 0
      delta.bApplyUE5TearUV = character.genesis === 'G9' && override.identity.applyUE5TearUV
    }
    if (override.preserve.enabled) {
      // Full replacement of the base lists — always set BOTH keys, even empty, so
      // an armed scene that cleared a list overrides the base's (empty ⇒ preserve
      // nothing for this scene) instead of the base value riding through the merge.
      delta.preserveMorphs = override.preserve.morphs
      delta.preserveNodeTransforms = override.preserve.nodeTransforms
    }
    if (Object.keys(delta).length > 0) map[key] = delta
  }
  return map
}

/**
 * Scene → PoseAsset-CSV-name for every linked scene that overrides the ROM (and
 * so has its own scene-suffixed CSV, built from the merged sections). Keyed by
 * the open scene's normalized path, matching {@link buildSceneConfigMap}. The
 * export block (in the combined ROM script AND the split Export_ script)
 * resolves the CSV to deliver through this; an identity/groom-only scene isn't
 * here and rides the base CSV.
 */
function buildSceneCsvMap(character: Character): Record<string, string> {
  const map: Record<string, string> = {}
  for (const override of activeSceneOverrides(character)) {
    if (!sceneOverrideBuildsRom(override)) continue
    const key = override.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    if (key !== '') map[key] = poseAssetFileName(character, sceneOverrideSlug(override.scenePath))
  }
  return map
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
  /**
   * Absolute path of the character's folder — where the PoseAsset CSV is written
   * at generation time. When provided (the desktop app), the generated script
   * moves that CSV into the resolved export dir at run time. Omitted in pure/web
   * contexts, where the move block is skipped.
   */
  charFolderAbs?: string,
): GeneratedFile {
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
    // Run-log metadata: the runtime writes dth_rom_run_log.json (character
    // folder) after every run; the studio reads it back to surface problems.
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
  if (charFolderAbs) {
    config.runLogPath = `${charFolderAbs.replace(/\\/g, '/')}/${ROM_RUN_LOG_FILE}`
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
  if (character.preserveMorphs.length) config.preserveMorphs = character.preserveMorphs
  if (character.preserveNodeTransforms.length)
    config.preserveNodeTransforms = character.preserveNodeTransforms
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

  // Per-scene overrides folded into the ONE script: each linked scene with an
  // armed panel contributes a small run-time config delta (a ROM override → a
  // fresh extraFrames; an identity override → the G9 dials); a ROM override also
  // mints its own PoseAsset CSV (merged frames) the export block delivers by the
  // same scene lookup. The config lookup swaps the open scene's delta onto
  // dthCharacterConfig before the build — emitted only when some scene overrides
  // (else the config stands as the primary scene's).
  const sceneConfigMap = buildSceneConfigMap(character)
  const sceneCsvMap = buildSceneCsvMap(character)
  const sceneSelectBlock =
    Object.keys(sceneConfigMap).length > 0 ? `\n${sceneConfigLookupSnippet(sceneConfigMap)}` : ''

  // Optional auto-export: when an export directory is set, the ROM build is
  // followed by a DTH Exporter run. With `exportWithRomScript` (the default) that
  // export block is appended here — one combined script. Otherwise it's split off
  // into a standalone Export_ script (see toExportScriptDsa).
  const exportDir = character.exportPath.trim()
  const exportBlock =
    exportDir && character.exportWithRomScript !== false
      ? `            // Export to the DTH pipeline via the Exporter Plugin (v1.8.1+).
${buildExportBlock(character, frames, charFolderAbs, sceneCsvMap)
  .split('\n')
  .map((line) => (line ? `            ${line}` : line))
  .join('\n')}`
      : ''

  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH ROM for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.${sceneSelectBlock ? `
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
${sceneSelectBlock}
// Write a minimal run log so even a catastrophic failure reaches the studio.
function dthWriteFailureLog(sError) {
    try {
        if (!dthCharacterConfig.runLogPath) return;
        var dthLogFile = new DzFile(dthCharacterConfig.runLogPath);
        // One ORed mode arg — a second open() argument warns on DS6.
        if (dthLogFile.open(dthLogFile.WriteOnly | dthLogFile.Truncate)) {
            dthLogFile.write(JSON.stringify({
                logVersion: 1,
                character: dthCharacterConfig.characterName,
                runtimeVersion: dthCharacterConfig.runtimeVersion,
                studioVersion: dthCharacterConfig.studioVersion,
                finishedAt: new Date().toString(),
                finishedAtMs: new Date().getTime(),
                ok: false,
                errors: [String(sError)],
                failedMorphs: []
            }, null, 2));
            dthLogFile.close();
        }
    } catch (dthLogErr) { /* even the log failed — the dialog still fires */ }
}

// Short + generic on purpose: the details (which morph, which frame, why)
// belong in DTH Character Studio, which reads the run log back.
function dthFailureDialog() {
    MessageBox.critical(
        "Something went wrong while building the ROM.\\n\\nSwitch back to DTH Character Studio to see what failed.",
        "DTH Character Studio", "&OK");
}

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

// The include MUST stay at the top level: Daz resolves include() through its
// legacy-include mechanism, which fails inside try/catch ("URIError: Legacy Include").
var dir_self = new DzDir(new DzFileInfo(getScriptFileName()).path());
include(dir_self.filePath("../../.DthWorkflow.dsa"));

if (typeof ApplyDTHCharacter != "function") {
    // Runtime not loaded (moved/deleted library?) — report instead of crashing.
    dthWriteFailureLog("The DTH runtime (.DthWorkflow.dsa) could not be loaded. Reinstall it from DTH Character Studio: save the character, or Tools \\u2192 Refresh assets.");
    dthFailureDialog();
} else {
    try {
        var dthRomOk = ApplyDTHCharacter(dthCharacterConfig);
        // G9: retarget the tear shader's UV set to UE5 after the ROM (before any
        // export). No-op unless the character opted in.
        if (dthCharacterConfig.bApplyUE5TearUV) { dthApplyUE5TearUV(); }${exportBlock ? `
        // Export only when the ROM built CLEAN (runtime v20: failed morphs count
        // as failure too, not just hard aborts) — a broken ROM must never ship
        // a PoseAsset CSV/FBX as if it were good. Fix the problem and re-run.
        if (dthRomOk === true) {
${exportBlock}        }` : ''}
    } catch (dthErr) {
        // Unexpected exception — ApplyDTHCharacter couldn't log/report it itself.
        dthWriteFailureLog("Unexpected script error: " + dthErr);
        dthFailureDialog();
    }
}
`
  const baseName = characterScriptName(character)
  return { fileName: `ROM_${baseName}.dsa`, content, target: 'daz' }
}

/**
 * The standalone Export script (`Export_<Name>_<Genesis>.dsa`) — runs the DTH
 * Exporter on the ROM already built on the timeline and delivers the PoseAsset
 * CSV, without rebuilding the (slow) ROM. Generated only when an export dir is
 * set and `exportWithRomScript` is false. Native Daz API only — no runtime
 * include — so it must run after the ROM_ script in the same Daz session.
 * The `dthFig` figure auto-select comes from dz-snippets
 * ({@link figureAutoSelectSnippet}).
 */
export function toExportScriptDsa(
  character: Character,
  frames?: PresetFrames,
  charFolderAbs?: string,
): GeneratedFile {
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Export for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Runs the DTH Exporter on the ROM already built on the timeline and delivers
// the PoseAsset CSV — it does NOT rebuild the ROM. Run it after the ROM script
// (ROM_${characterScriptName(character)}.dsa) in the same Daz session.

${figureAutoSelectSnippet(character.genesis)}if (!dthFig) {
    MessageBox.critical("No ${character.genesis} figure found in the scene - load the character's scene and re-run.", "DTH Character Studio", "&OK");
} else {
${buildExportBlock(character, frames, charFolderAbs, buildSceneCsvMap(character))
  .split('\n')
  .map((line) => (line ? `    ${line}` : line))
  .join('\n')}}
`
  return {
    fileName: `Export_${characterScriptName(character)}.dsa`,
    content,
    target: 'daz',
  }
}

/**
 * The standalone Hair export script (`Export_Hair_<Name>_<Genesis>.dsa`) — the
 * "hair" (Daz's term; it becomes a "groom" only in Houdini/Unreal). The DTH
 * Groom Guide's "Export Alembic Groom Poses" step as one generated,
 * non-destructive script. Where the guide says "delete everything except the
 * body, add the hair", this script instead detaches every conformed follower
 * of the figure EXCEPT the OPEN scene's groom items (per-scene map, resolved
 * at run time like the export bracket) and the Genesis body-part figures,
 * calls the exporter's documented
 * `doExportAlembicGroomPoses(path, name, saveSettings=false)` (probed July 17:
 * a 2-arg call crashes Daz in the settings-save path — ALWAYS pass false, same
 * as the ROM doExport calls), and restores everything in a finally. Output:
 * `<Name>_groom_grooms.abc` next to the ROM artifacts (2 frames: rest + UE5
 * pose — Houdini's DazToHueGroom Import reads its hair groups from it).
 */
export function toGroomExportScriptDsa(character: Character): GeneratedFile {
  const exportDir = character.exportPath.trim().replace(/\\/g, '/')
  const groomMap = groomSceneMap(character)
  // The same snippet body the ROM/Export export block uses (dz-snippets), at
  // this script's base indent 0.
  const sceneSubfolderBlock = character.exportSceneSubfolders
    ? sceneSubfolderSnippet()
    : ''
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Hair Export for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// The Groom Guide's "Export Alembic Groom Poses" step, automated: detaches the
// non-groom wearables (the open scene's groom stays FITTED, as worn), exports
// the 2-frame groom Alembic via the DTH Exporter, restores the scene. Run it
// on the character's scene with the figure selected; the ROM is NOT needed.

var dthAction = MainWindow.getActionMgr().findAction("DazToHueExporterAction");
${figureAutoSelectSnippet(character.genesis)}if (!dthAction) {
    MessageBox.critical("DazToHue Exporter Action not found - install the DTH Exporter Plugin v2.0+.", "DTH Character Studio", "&OK");
} else if (!dthFig || !dthFig.inherits("DzNode")) {
    MessageBox.critical("No ${character.genesis} figure found in the scene - load the character's scene and re-run.", "DTH Character Studio", "&OK");
} else {
${groomSceneLookupSnippet(groomMap)}
    if (dthGroomLabels.length == 0) {
        MessageBox.information("The open scene has no hair list in DTH Character Studio - nothing to export. Open one of the character's scenes with hair items defined.", "DTH Character Studio", "&OK");
    } else {
        var dthExportDir = ${dazJson(exportDir)};
${sceneSubfolderBlock}        // HIDE the non-groom wearables (script Ctrl+click: node + children,
        // exact flags restored) — plugin 2.0+ skips hidden nodes. The groom
        // stays fitted AND visible, exported as worn.
${indentLines(hideTreeSnippet('dthHideTree', 'dthHidden'))}
        for (var dthI = 0; dthI < Scene.getNumNodes(); dthI++) {
            var dthN = Scene.getNode(dthI);
            if (!dthN || typeof dthN.getFollowTarget != "function") continue;
            var dthT = dthN.getFollowTarget();
            if (!dthT || String(dthT.getLabel()) != String(dthFig.getLabel())) continue;
            var dthLabel = String(dthN.getLabel());
            // Keep the groom (fitted AND visible, as worn) and the Genesis
            // body-part figures (eyes/mouth/tear ride with the body).
            var dthKeep = dthLabel.indexOf("Genesis") == 0;
            for (var dthK = 0; dthK < dthGroomLabels.length; dthK++) if (dthLabel == dthGroomLabels[dthK]) dthKeep = true;
            if (dthKeep) continue;
            print("Hair export - hiding: " + dthLabel);
            dthHideTree(dthN);
        }
        Scene.selectAllNodes(false);
        dthFig.select(true);
        Scene.setPrimarySelection(dthFig);
        try {
            dthAction.doExportAlembicGroomPoses(dthExportDir, ${dazJson(`${characterSlug(character)}_groom`)}, false);
            print("Hair exported to " + dthExportDir);
        } finally {
            // Restore the exact per-node visibility flags, even on a throw.
            for (var dthR = 0; dthR < dthHidden.length; dthR++) {
                try { dthHidden[dthR].setVisible(true); } catch (eR) {}
            }
            print("Hair export - shown again: " + dthHidden.length);
        }
    }
}
`
  return {
    fileName: `Export_Hair_${characterScriptName(character)}.dsa`,
    content,
    target: 'daz',
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

var dir_self = new DzDir(new DzFileInfo(getScriptFileName()).path());
include(dir_self.filePath("../../.DthProducts.dsa"));

DthScanProducts(${dazJson(config, 2)});
`
  return { fileName: `Scan_Products_${characterSlug(character)}.dsa`, content, target: 'daz' }
}

/**
 * The files written on save: the one self-contained character script (Daz) and
 * the PoseAsset CSV (Houdini), plus the optional split Export_ script and the
 * per-character product-scan script. Everything the character script needs (FBM
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
  /** Absolute character-folder path — see {@link toCharacterScriptDsa}. */
  charFolderAbs?: string,
  /** Active DTH release version at generation time (e.g. "2.4.3"). Only the CSV
   *  depends on the release — it selects the CSV era/variant (see
   *  {@link poseAssetCsvEra}); the Daz scripts are release-independent (tied to
   *  RUNTIME_VERSION only), so it isn't threaded into them. */
  dthReleaseVersion?: string,
  /** When set (the project enabled Daz Products), also emit the per-character
   *  `Scan_Products_<Name>.dsa`. The flag reaches the pure core only here — the
   *  core never imports host/app state. */
  scanProducts?: ScanProductsOptions,
): Array<GeneratedFile> {
  // With an export dir and exportWithRomScript off, the export is split into a
  // standalone Export_ script alongside the ROM_ script.
  const split = character.exportPath.trim() !== '' && character.exportWithRomScript === false
  // Groom lists + an export dir -> also the standalone groom (.abc) script.
  const groom =
    character.exportPath.trim() !== '' && Object.keys(groomSceneMap(character)).length > 0
  const era = poseAssetCsvEra(dthReleaseVersion ?? '')
  // A ROM-override scene builds different frames, so it gets its OWN PoseAsset
  // CSV from the merged sections; the one script's export block delivers the
  // right CSV by open scene. Identity/groom-only overrides keep the base frames
  // (their effect is a run-time config delta / the per-scene hair list), so they
  // ride the base CSV — no extra file.
  const overrideCsvs = activeSceneOverrides(character)
    .filter(sceneOverrideBuildsRom)
    .map((override) =>
      toPoseAssetCsv(mergeSceneOverride(character, override), frames, era, sceneOverrideSlug(override.scenePath)),
    )
  return [
    toCharacterScriptDsa(character, romPaths, frames, charFolderAbs),
    ...(split ? [toExportScriptDsa(character, frames, charFolderAbs)] : []),
    ...(groom ? [toGroomExportScriptDsa(character)] : []),
    ...(scanProducts ? [toScanProductsScriptDsa(character, scanProducts)] : []),
    toPoseAssetCsv(character, frames, era),
    ...overrideCsvs,
  ]
}
