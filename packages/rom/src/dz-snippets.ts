import { GENERATIONS } from './types'

import type { Character, GenesisVersion } from './types'

/**
 * Embedded DzScript text shared by the `.dsa` generators (dsa.ts): the reusable
 * snippet bodies plus the two encoders that make ARBITRARY user data safe to
 * embed in generated Daz Script source ({@link commentSafe}, {@link dazJson}).
 * Package-internal except {@link dazJson}, which the package index re-exports so
 * app code that embeds values into Daz Script (e.g. the open-scene bridge) uses
 * the ONE escaping rule instead of copying it.
 */

/** Indent every non-empty line of a generated-script block by one 4-space level. */
export function indentLines(block: string): string {
  return block
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n')
}

/**
 * The recursive "hide this node + all its children, remembering exactly what we
 * hid so it can be restored" DzScript snippet, at a 4-space base indent. Shared
 * by the ROM export's hide arm (dsa.ts `buildExportBlock`) and the standalone
 * groom export (`toGroomExportScriptDsa`) — the names are parameterised so
 * each keeps its own (`dthGroomHideTree`/`dthGroomHidden` vs `dthHideTree`/
 * `dthHidden`) while the body lives in ONE place. Callers re-indent via
 * {@link indentLines} where they need a deeper base.
 */
export function hideTreeSnippet(fnName: string, hiddenVar: string): string {
  return `    var ${hiddenVar} = [];
    var ${fnName} = function (oNode) {
        if (!oNode) return;
        var dthVisible = true;
        try { if (typeof oNode.isVisible == "function") dthVisible = oNode.isVisible(); } catch (eV) {}
        if (dthVisible) {
            try { oNode.setVisible(false); ${hiddenVar}.push(oNode); } catch (eH) {}
        }
        var dthKids = oNode.getNodeChildren(false);
        for (var dthC = 0; dthC < dthKids.length; dthC++) ${fnName}(dthKids[dthC]);
    };`
}

/**
 * The one "which scene is open" capture every scene-keyed lookup reads:
 * `dthOpenSceneFile`, taken ONCE at script start. Load-bearing since the
 * ROM-scene save (dsa.ts `romSceneSaveBlock`): a Daz save-as REPOINTS
 * `Scene.getFilename()` to the saved copy, and the export block's lookups
 * (subfolder map, groom list, CSV pick) run AFTER that save — reading live
 * would key them on `rom-animations/<stem>_ROM.duf` and miss every map.
 * Every carrier that embeds a scene-keyed snippet MUST emit this first.
 */
export function openSceneFileSnippet(): string {
  return `// The open scene's file, captured ONCE: the ROM-scene save (save-as) repoints
// Scene.getFilename(), so every scene-keyed lookup reads this capture instead.
var dthOpenSceneFile = String(Scene.getFilename());
`
}

/**
 * Resolves an open SAVED ROM ANIMATION back to the scene it was built from,
 * rewriting the {@link openSceneFileSnippet} capture in place — so everything
 * keyed on the open scene (the wrong-scene guard, the per-scene config delta,
 * the hair list, the export subfolder + name, the CSV pick) resolves as if the
 * source scene were open. It effectively is: a ROM animation IS that scene with
 * the ROM baked onto its timeline.
 *
 * DTH Export's "Export only" mode is what opens those files (its job rows point
 * at `rom-animations/<stem>_ROM.duf`), but every generated script carries this
 * — running any of them on a ROM animation by hand behaves the same way, where
 * it used to abort as a foreign scene. Map from {@link romAnimationSourceMap};
 * emit right after {@link openSceneFileSnippet}, before any lookup or the
 * guard CALL. Base indent 0.
 */
export function romAnimationSourceSnippet(romSourceMap: Record<string, string>): string {
  return `// A saved ROM animation (rom-animations/<stem>_ROM.duf) stands in for the scene
// it was built from — resolve it back, so every scene-keyed lookup below matches.
var dthRomSourceScenes = ${dazJson(romSourceMap, 2)};
var dthRomSourceHit = dthRomSourceScenes[String(dthOpenSceneFile).split("\\\\").join("/").toLowerCase()];
if (dthRomSourceHit) {
    print("DTH: the open file is the saved ROM animation of " + dthRomSourceHit);
    dthOpenSceneFile = dthRomSourceHit;
}
`
}

/**
 * The "nest the export dir under the open scene's OWN subfolder" DzScript
 * snippet, at base indent 0 (callers re-indent via {@link indentLines}). ONE
 * body for the ROM/Export scripts' export block and the standalone groom
 * export. The map (built by `sceneExportSubfolders`) is keyed by normalized
 * scene path; a scene missing from it falls back to the scene file's stem at
 * run time — the pre-v37 nesting, kept so an unexpected scene still exports
 * into its own folder rather than the root. Reads/writes the caller's
 * `dthExportDir` var and reads `dthOpenSceneFile` (emit
 * {@link openSceneFileSnippet} first — never Scene.getFilename() live, the
 * ROM-scene save repoints it before this runs).
 *
 * With `exportName` it also declares `dthExportName` — the name handed to the
 * exporter's `doExport`: the base {@link exporterFigureName}, suffixed with
 * the resolved subfolder so every scene's export files carry their scene
 * ("Kira" in "summertide/" exports as "Kira_Summertide" — each subfolder
 * segment's first letter capitalized, nesting slashes to underscores, commas
 * to spaces since a comma would split the CSV column the name lands in).
 * The PRIMARY scene is the exception: it exports into its subfolder like
 * every scene, but its files keep the bare base name ("Kira", never
 * "Kira_Primary") — the primary IS the character.
 *
 * The export dir itself is FLAT (schema v29): every scene lands directly in
 * `<exportPath>/<subfolder>/`. Between v27 and v29 a `houdiniProjectFolder`
 * could nest it under `<project>/dth-export` first — that coupling is gone.
 * The root sits in the character's houdini folder again (runtime v64), but as a
 * plain sibling of the `.hip` files, owned by nothing.
 */
export function sceneExportSubfolderSnippet(
  map: Record<string, string>,
  exportName?: { base: string; primarySceneKey: string },
): string {
  const nameLines =
    exportName === undefined
      ? ''
      : `var dthExportName = ${dazJson(exportName.base)};
if (dthExportSub != "" && dthExportSceneKey != ${dazJson(exportName.primarySceneKey)}) {
    var dthExportSuffix = dthExportSub.split(",").join(" ").split("/");
    for (var dthSfI = 0; dthSfI < dthExportSuffix.length; dthSfI++) {
        var dthSfSeg = dthExportSuffix[dthSfI];
        if (dthSfSeg != "") dthExportSuffix[dthSfI] = dthSfSeg.charAt(0).toUpperCase() + dthSfSeg.substring(1);
    }
    dthExportName = dthExportName + "_" + dthExportSuffix.join("_");
}
`
  return `var dthExportSubByScene = ${dazJson(map)};
var dthExportSceneKey = dthOpenSceneFile.split("\\\\").join("/").toLowerCase();
var dthExportSub = dthExportSubByScene[dthExportSceneKey] || "";
if (dthExportSub == "" && dthExportSceneKey != "") {
    dthExportSub = new DzFileInfo(dthOpenSceneFile).completeBaseName();
}
${nameLines}if (dthExportSub != "") dthExportDir = dthExportDir + "/" + dthExportSub;
`
}

/**
 * The "which hair items belong to the OPEN scene" resolution: embed the
 * per-scene groom map and look up the open scene's entry by its forward-slash
 * lowercased absolute path. ONE body for the ROM/Export script's export
 * bracket and the standalone groom export (the two used to carry
 * byte-duplicated copies) — a normalization tweak must land in both or the
 * scripts disagree on which scene has a groom list. Base indent 4 (both
 * callers embed at that level). Reads `dthOpenSceneFile` ({@link
 * openSceneFileSnippet} — this lookup runs after the ROM-scene save).
 */
export function groomSceneLookupSnippet(groomMap: Record<string, Array<string>>): string {
  return `    var dthGroomByScene = ${dazJson(groomMap)};
    var dthGroomScene = dthOpenSceneFile.split("\\\\").join("/").toLowerCase();
    var dthGroomLabels = dthGroomByScene[dthGroomScene] || [];`
}

/**
 * The per-scene CONFIG selection the one character script embeds: a map of
 * normalized scene path → the config delta for that scene (a few overridden
 * fields — new `extraFrames` for a ROM override, the G9 identity dials for an
 * identity override), plus the lookup that merges the OPEN scene's delta onto
 * `dthCharacterConfig` before the build. One script serves every linked scene:
 * the primary builds the base config; an outfit scene whose Hair/ROM/G9 panels
 * were overridden swaps in just those fields. Same scene-key normalization as
 * {@link groomSceneLookupSnippet} — a change to one must land in the other, or
 * the two disagree on which scene is open. Base indent 0; must run AFTER the
 * `var dthCharacterConfig = …;` it mutates AND after {@link
 * openSceneFileSnippet} + {@link romAnimationSourceSnippet}: it reads the
 * `dthOpenSceneFile` capture, never `Scene.getFilename()` live — a saved ROM
 * animation resolves back to its SOURCE scene there, and reading live would
 * key the lookup on `rom-animations/<stem>_ROM.duf`, miss the delta, and build
 * the BASE frame layout while the export block (capture-keyed) delivers the
 * override scene's CSV: the exact artifact desync the product exists to
 * prevent.
 */
export function sceneConfigLookupSnippet(sceneConfigMap: Record<string, unknown>): string {
  return `var dthSceneOverrides = ${dazJson(sceneConfigMap, 2)};
var dthOpenScene = dthOpenSceneFile.split("\\\\").join("/").toLowerCase();
var dthSceneDelta = dthSceneOverrides[dthOpenScene];
if (dthSceneDelta) {
    for (var dthOk in dthSceneDelta) {
        if (dthSceneDelta.hasOwnProperty(dthOk)) dthCharacterConfig[dthOk] = dthSceneDelta[dthOk];
    }
    print("DTH: per-scene override applied for " + dthOpenScene);
}
`
}

/**
 * The wrong-scene guard every per-character script leads with: running Kira's
 * ROM/export/scan against some OTHER character's open scene used to apply
 * everything silently. Declares `dthSceneLinkError()` — '' when the open scene
 * is one of the character's linked scenes (same normalization as the other
 * scene lookups: backslashes → '/', lowercased — a change to one must land in
 * all), else a ready-to-show message naming the open scene and the linked
 * ones; the caller aborts on it. A definition without linked scenes can't
 * validate, so the guard always passes there (legacy/sceneless definitions).
 * Base indent 0.
 */
export function sceneGuardSnippet(
  character: Pick<Character, 'name' | 'scenePath' | 'extraScenes'>,
): string {
  const scenes = [character.scenePath, ...character.extraScenes]
    .map((s) => s.trim())
    .filter(Boolean)
  const keys = scenes.map((s) => s.replace(/\\/g, '/').toLowerCase())
  const names = scenes.map((s) => s.replace(/\\/g, '/').split('/').pop() ?? s)
  return `var dthLinkedScenes = ${dazJson(keys, 2)};
function dthSceneLinkError() {
    if (dthLinkedScenes.length == 0) return "";
    // The CAPTURE (dthOpenSceneFile), never Scene.getFilename(): a saved ROM
    // animation has already been resolved back to its source scene there
    // (romAnimationSourceSnippet), and it is a legitimate stand-in for that
    // scene — the live filename would read as foreign and refuse to run.
    var dthOpenPath = String(dthOpenSceneFile).split("\\\\").join("/").toLowerCase();
    for (var dthLsI = 0; dthLsI < dthLinkedScenes.length; dthLsI++) {
        if (dthLinkedScenes[dthLsI] == dthOpenPath) return "";
    }
    var dthOpenName = dthOpenPath ? String(dthOpenPath.split("/").pop()) : "(unsaved scene)";
    return "The open Daz scene is not linked to " + ${dazJson(character.name)} + " - nothing was applied.\\n\\nOpen scene: " + dthOpenName + "\\n\\nThis script runs only on:\\n" + ${dazJson(names.map((n) => `• ${n}`).join('\n'))};
}
`
}

/**
 * The scene → PoseAsset-CSV-name lookup the export block uses to deliver the
 * RIGHT CSV for the open scene: a ROM-override scene has its own scene-suffixed
 * CSV, every other scene rides the base one. Emitted only when at least one
 * linked scene overrides the ROM. Declares `dthCsvName` (the base name),
 * reassigning it when the open scene has an override CSV. Base indent 0.
 * Reads `dthOpenSceneFile` ({@link openSceneFileSnippet} — this lookup runs
 * after the ROM-scene save).
 */
export function sceneCsvLookupSnippet(baseCsvName: string, sceneCsvMap: Record<string, string>): string {
  return `var dthCsvName = ${dazJson(baseCsvName)};
var dthCsvByScene = ${dazJson(sceneCsvMap, 2)};
var dthCsvScene = dthOpenSceneFile.split("\\\\").join("/").toLowerCase();
if (dthCsvByScene[dthCsvScene]) dthCsvName = dthCsvByScene[dthCsvScene];
`
}

/**
 * Strip the characters that could break OUT of a `//` comment line in a generated
 * Daz script — CR/LF and the Unicode line separators U+2028/U+2029 that Daz's
 * ECMAScript engine also treats as line terminators. Without this, a crafted
 * `character.name` (a shared malicious definition — the product's whole premise is
 * sharing definitions) could end the comment and inject executable DzScript.
 */
// U+2028/U+2029 are JS/Daz line terminators, so they can't appear literally in
// this source (they'd break the line) — build the class with fromCharCode.
const COMMENT_LINE_TERMINATORS = new RegExp(
  '[\r\n' + String.fromCharCode(0x2028, 0x2029) + ']+',
  'g',
)
export function commentSafe(value: string): string {
  return value.replace(COMMENT_LINE_TERMINATORS, ' ')
}

/**
 * JSON.stringify for embedding into generated Daz Script SOURCE. JSON leaves
 * U+2028/U+2029 raw inside string literals, but Daz's ES3-era engine treats them
 * as line terminators (the same class {@link commentSafe} closes for comments) —
 * a shared definition carrying one would produce an unterminated string literal
 * and the whole generated script would fail to parse. Escape them so every
 * embedded value stays single-line-safe. Use THIS, never bare JSON.stringify,
 * wherever a value lands inside generated `.dsa` source.
 */
export function dazJson(value: unknown, space?: number): string {
  // \u#### ESCAPES in the regexes, never the literal characters — U+2028/29 are
  // line terminators in THIS source too (see COMMENT_LINE_TERMINATORS above).
  return JSON.stringify(value, null, space)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Standalone-script snippet: resolve `dthFig` (or `varName`) to the character's
 * figure — the selection's root when it matches the generation's source ASSET
 * (rename-proof; an unreadable asset URI keeps the tolerant old behavior), else
 * the scene's first matching root figure, auto-selected. The variable is null
 * only when the scene has no such figure; the caller emits its own error UI for
 * that. `varName` lets a script that already resolved `dthFig` (the standalone
 * Export_) coexist with a second resolution elsewhere (the ROM script's inline
 * hair pass) — the snippet's helper names are fixed, so emit it at most ONCE
 * per script.
 */
export function figureAutoSelectSnippet(genesis: GenesisVersion, varName = 'dthFig'): string {
  // The rename-proof figure identity lives in GENERATIONS (one table row per
  // generation) — mirrors the runtime's v28 auto-select, which only the ROM
  // script gets via the include.
  const files = dazJson(GENERATIONS[genesis].assetFiles)
  return `var ${varName} = Scene.getPrimarySelection();
while (${varName} && ${varName}.getNodeParent()) ${varName} = ${varName}.getNodeParent();
var dthAssetFiles = ${files};
var dthAssetPath = function (oNode) {
    try {
        if (oNode && typeof oNode.getAssetUri == "function") {
            var dthUri = oNode.getAssetUri();
            return String(dthUri && typeof dthUri.getFilePath == "function" ? dthUri.getFilePath() : dthUri).toLowerCase();
        }
        // DS6 has no getAssetUri() method - the assetUri PROPERTY is how the
        // runtime's auto-select succeeds there (measured; do not drop this).
        if (oNode && oNode.assetUri != undefined) return String(oNode.assetUri).toLowerCase();
    } catch (eA) {}
    return "";
};
var dthMatchesAsset = function (sPath) {
    for (var dthAi = 0; dthAi < dthAssetFiles.length; dthAi++) {
        if (sPath.indexOf("/" + dthAssetFiles[dthAi]) >= 0 || sPath == dthAssetFiles[dthAi]) return true;
    }
    return false;
};
// The unreadable-asset tolerance applies ONLY to actual figures - a selected
// non-figure (a prop, Environment Options, ...) must never be accepted.
var dthFigIsFigure = ${varName} && (${varName}.inherits("DzFigure") || ${varName}.inherits("DzSkeleton"));
var dthSelPath = dthFigIsFigure ? dthAssetPath(${varName}) : null;
if (dthSelPath == null || (dthSelPath != "" && !dthMatchesAsset(dthSelPath))) {
    // No/non-figure/wrong-asset selection - find the scene's ${genesis} figure
    // by ASSET identity (labels are user-renamable; the source .dsf is not).
    var dthFound = null;
    for (var dthFi = 0; dthFi < Scene.getNumNodes(); dthFi++) {
        var dthCand = Scene.getNode(dthFi);
        if (!dthCand || dthCand.getNodeParent()) continue;
        if (!dthCand.inherits("DzFigure") && !dthCand.inherits("DzSkeleton")) continue;
        if (dthMatchesAsset(dthAssetPath(dthCand))) { dthFound = dthCand; break; }
    }
    if (dthFound) {
        print("Auto-selected the ${genesis} figure: " + dthFound.getLabel());
        Scene.selectAllNodes(false);
        dthFound.select(true);
        Scene.setPrimarySelection(dthFound);
    }
    // A wrong selection never survives - no match means fail loud downstream.
    ${varName} = dthFound;
}
`
}
