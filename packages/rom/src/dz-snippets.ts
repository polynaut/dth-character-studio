import { GENERATIONS } from './types'

import type { GenesisVersion } from './types'

/**
 * Embedded DzScript text shared by the `.dsa` generators (dsa.ts): the reusable
 * snippet bodies plus the two encoders that make ARBITRARY user data safe to
 * embed in generated Daz Script source ({@link commentSafe}, {@link dazJson}).
 * Package-internal — nothing here is re-exported from the package index.
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
 * The "nest the export dir under the OPEN scene's name" DzScript snippet, at
 * base indent 0 (callers re-indent via {@link indentLines}). ONE body for the
 * ROM/Export scripts' export block and the standalone groom export — the two
 * used to carry byte-duplicated copies differing only in indentation.
 * Reads/writes the caller's `dthExportDir` var.
 */
export function sceneSubfolderSnippet(): string {
  return `var dthSceneFile = Scene.getFilename();
if (dthSceneFile != "") {
    var dthSceneName = new DzFileInfo(dthSceneFile).completeBaseName();
    if (dthSceneName != "") dthExportDir = dthExportDir + "/" + dthSceneName;
}
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
 * Standalone-script snippet: resolve `dthFig` to the character's figure — the
 * selection's root when it matches the generation's source ASSET (rename-proof;
 * an unreadable asset URI keeps the tolerant old behavior), else the scene's
 * first matching root figure, auto-selected. `dthFig` is null only when the
 * scene has no such figure; the caller emits its own error UI for that.
 */
export function figureAutoSelectSnippet(genesis: GenesisVersion): string {
  // The rename-proof figure identity lives in GENERATIONS (one table row per
  // generation) — mirrors the runtime's v28 auto-select, which only the ROM
  // script gets via the include.
  const files = dazJson(GENERATIONS[genesis].assetFiles)
  return `var dthFig = Scene.getPrimarySelection();
while (dthFig && dthFig.getNodeParent()) dthFig = dthFig.getNodeParent();
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
var dthFigIsFigure = dthFig && (dthFig.inherits("DzFigure") || dthFig.inherits("DzSkeleton"));
var dthSelPath = dthFigIsFigure ? dthAssetPath(dthFig) : null;
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
    dthFig = dthFound;
}
`
}
