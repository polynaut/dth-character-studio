// Sequential `await` in a loop is this module's normal shape, not an oversight:
// it is ORDERED filesystem work — a step reads, moves or overwrites what the
// step before it wrote, and the rule's advice (`Promise.all`) would race those
// against each other. Scoped off for the file rather than repeated at each
// loop; a loop here that genuinely CAN run in parallel should use `Promise.all`
// on its own merits.
/* oxlint-disable no-await-in-loop */
import { exists, mkdir, readTextFile, remove, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { characterScriptName, RUNTIME_VERSION } from '@dth/rom'
import type { Character } from '@dth/rom'

import { characterFolderName } from '../library'
// The DTH Daz runtime is bundled into the app so the studio is self-contained —
// no external checkout to configure. It descends from soltude/DazToHue-Scripts
// but is studio-owned now. copyRuntimeFiles installs these (rewritten +
// dot-prefixed). Bump RUNTIME_VERSION (@dth/rom) when they change so Refresh
// assets flags characters whose generated scripts need regenerating.
import dthUtilsRuntime from '../runtime/DthUtils.dsa?raw'
import dthOptionsRuntime from '../runtime/DthOptions.dsa?raw'
import dthWorkflowRuntime from '../runtime/DthWorkflow.dsa?raw'
import dthProductsRuntime from '../runtime/DthProducts.dsa?raw'
import dthScanMorphsRuntime from '../runtime/DthScanMorphs.dsa?raw'
import dthScanFramesRuntime from '../runtime/DthScanFrames.dsa?raw'
import dthShellSurfacesRuntime from '../runtime/DthShellSurfaces.dsa?raw'
import dthKillAnimationRuntime from '../runtime/DthKillAnimation.dsa?raw'
import buildGenesisIndexScript from '../runtime/Build_Genesis_Index.dsa?raw'
import buildGenesisIndexBulkScript from '../runtime/Build_Genesis_Index_Bulk.dsa?raw'
import scanSceneBulkScript from '../runtime/Scan_Scene_Bulk.dsa?raw'
import scanFramesScript from '../runtime/Scan_Frames.dsa?raw'
import fixGraftShellSurfacesScript from '../runtime/Fix_Graft_Shell_Surfaces.dsa?raw'
import killAnimationScript from '../runtime/Kill_Animation.dsa?raw'
// Content Library artwork for the visible scripts (Daz's own convention:
// `<name>.png` at 91×91 is the thumbnail, `<name>.tip.png` at 256×256 the hover
// preview — verified against the stock Genesis 9 assets). `?inline` bundles them
// as base64 data URLs, so the install needs no asset fetch and the app stays a
// single self-contained binary.
import buildGenesisIndexIcon from '../runtime/Build_Genesis_Index.png?inline'
import buildGenesisIndexTip from '../runtime/Build_Genesis_Index.tip.png?inline'
import scanFramesIcon from '../runtime/Scan_Frames.png?inline'
import scanFramesTip from '../runtime/Scan_Frames.tip.png?inline'
import fixGraftShellSurfacesIcon from '../runtime/Fix_Graft_Shell_Surfaces.png?inline'
import fixGraftShellSurfacesTip from '../runtime/Fix_Graft_Shell_Surfaces.tip.png?inline'
import killAnimationIcon from '../runtime/Kill_Animation.png?inline'
import killAnimationTip from '../runtime/Kill_Animation.tip.png?inline'

import { dataUrlBytes, join } from './fs'
import { dataDir } from './app-data'

/**
 * The DTH runtime files the generated character script `include()`s. Copied from
 * the DazToHue-Scripts checkout into the studio's shared scripts folder, where
 * they're dot-prefixed (hidden) so the user-facing character scripts stand out.
 * DthWorkflow.dsa pulls in the other two (ScanKeyFrames is now merged into it),
 * so all three must sit together.
 */
/** The bundled DTH runtime files (name → raw source), installed by copyRuntimeFiles. */
const RUNTIME_FILES: Record<string, string> = {
  'DthUtils.dsa': dthUtilsRuntime,
  'DthOptions.dsa': dthOptionsRuntime,
  'DthWorkflow.dsa': dthWorkflowRuntime,
  // Product-scan runtime — used only by the generated Scan_Products_<Name>.dsa
  // (the Daz Products feature), but installed for every project (harmless when off).
  'DthProducts.dsa': dthProductsRuntime,
  // Morph/bone-index runtime — included by the VISIBLE Build_Genesis_Index.dsa
  // below; builds the stock figures per generation and scans them into the
  // per-generation index feeding the Morph-name + bone autocompletes.
  'DthScanMorphs.dsa': dthScanMorphsRuntime,
  // Keyframe-scanner runtime — included by DthWorkflow (debug/scanned-CSV paths)
  // AND by the visible Scan_Frames.dsa wrapper, which exports the open scene's
  // keyed frames as a CSV for the studio's "Import from CSV".
  'DthScanFrames.dsa': dthScanFramesRuntime,
  // Geoshell surface hygiene — included by the visible Fix_Graft_Shell_Surfaces.dsa
  // below. Switches off the surfaces a later geograft (STX nipples/navel) adds,
  // switched ON, to an existing Golden Palace / Dicktator shell.
  'DthShellSurfaces.dsa': dthShellSurfacesRuntime,
  // Timeline hygiene — included by the visible Kill_Animation.dsa below. Strips
  // every key off a scene and puts the range back to a default 0-30, which is
  // what turns an old ROM-animation scene back into an addable character scene.
  'DthKillAnimation.dsa': dthKillAnimationRuntime,
}

/**
 * The visible scan scripts, installed AS-IS at the DTH-Character-Studio root
 * (they run there, so they include the dot-prefixed runtime directly — no
 * `../../` rewrite), with the studio's app-data folder baked into their output
 * path at install time. Build_Genesis_Index builds + scans every generation's
 * stock figures into the per-generation morph/bone index behind the Morph-name
 * and bone autocompletes (it replaced the four per-generation
 * `Scan_Morphs_<Genesis>` wrappers, which are swept below); Scan_Frames exports
 * the open scene's keyed frames as a CSV for "Import from CSV".
 */
/** The visible index builder's file name — installed at the scripts-folder ROOT
 *  (it belongs to no character). Named here because Tools → Build Genesis Index
 *  hands this exact file to the Runner (`api/execute.ts`), and a literal in two
 *  places is a rename waiting to break the handoff silently. */
export const GENESIS_INDEX_SCRIPT = 'Build_Genesis_Index.dsa'

/** The Runner's dialog-free twin of {@link GENESIS_INDEX_SCRIPT} — what
 *  Tools → Build Genesis Index actually hands over (`api/execute.ts`). Hidden
 *  (dot-prefixed) at the same root: a Runner batch runs inside a possibly
 *  minimized Daz, where the visible script's dialogs are an invisible dead
 *  stop; double-clicking in the Content Library stays the interactive path. */
export const GENESIS_INDEX_BULK_SCRIPT = '.Build_Genesis_Index_Bulk.dsa'

const VISIBLE_SCAN_SCRIPTS: Record<string, string> = {
  [GENESIS_INDEX_SCRIPT]: buildGenesisIndexScript,
  'Scan_Frames.dsa': scanFramesScript,
  // Scene hygiene rather than a scan: switches off the foreign-geograft surfaces
  // on a Golden Palace / Dicktator geoshell (see DthShellSurfaces.dsa). Bakes in
  // no path — it reads and writes the open scene only.
  'Fix_Graft_Shell_Surfaces.dsa': fixGraftShellSurfacesScript,
  // Also scene hygiene, and the only DESTRUCTIVE visible script: it deletes a
  // scene's animation so an old ROM-animation scene can be added as a character
  // scene (the studio requires an empty timeline). Asks first, saves nothing,
  // bakes in no path.
  'Kill_Animation.dsa': killAnimationScript,
}

/** Root-level scripts installed like the visible ones (as-is + app-data path
 *  baked in) but under a HIDDEN name — automation entry points, not Content
 *  Library tiles, so they get no artwork and no un-prefixed copy. */
/** The per-scene worker of Tools → **Scan project** — the bulk scan's job file
 *  points one row per scene at this, and the sidecar config beside it
 *  (`SCAN_CONFIG_FILE` in `../execute-jobs.ts`) says what each scene is due for
 *  (scene morphs, products, or both — one open, both scans). Hidden at the same
 *  root and for the same reason as the index builder's bulk twin: it is an
 *  automation entry point, not a Content Library tile. */
export const SCAN_SCENE_BULK_SCRIPT = '.Scan_Scene_Bulk.dsa'

const HIDDEN_ROOT_SCRIPTS: Record<string, string> = {
  [GENESIS_INDEX_BULK_SCRIPT]: buildGenesisIndexBulkScript,
  [SCAN_SCENE_BULK_SCRIPT]: scanSceneBulkScript,
}

/**
 * Content Library artwork for those scripts, installed beside them. Daz picks a
 * script's thumbnail up purely by NAME — `<script base name>.png` for the 91×91
 * tile, `.tip.png` for the 256×256 hover preview — so these keys must track the
 * script names above; without them the tiles render as a generic broken-image
 * placeholder. Values are the bundled data URLs, decoded to bytes on install.
 */
const VISIBLE_SCRIPT_ICONS: Record<string, string> = {
  'Build_Genesis_Index.png': buildGenesisIndexIcon,
  'Build_Genesis_Index.tip.png': buildGenesisIndexTip,
  'Scan_Frames.png': scanFramesIcon,
  'Scan_Frames.tip.png': scanFramesTip,
  'Fix_Graft_Shell_Surfaces.png': fixGraftShellSurfacesIcon,
  'Fix_Graft_Shell_Surfaces.tip.png': fixGraftShellSurfacesTip,
  'Kill_Animation.png': killAnimationIcon,
  'Kill_Animation.tip.png': killAnimationTip,
}


/** Visible scripts earlier versions installed at the root that no longer exist
 *  — removed on install so a stale copy can't be run against the current
 *  runtime. The four `Scan_Morphs_<Genesis>` wrappers are folded into
 *  Build_Genesis_Index.dsa, which does every generation in one run. */
const RETIRED_VISIBLE_SCRIPTS = [
  'Scan_Morphs_G9.dsa',
  'Scan_Morphs_G8.1.dsa',
  'Scan_Morphs_G8.dsa',
  'Scan_Morphs_G3.dsa',
]

/** `<My DAZ 3D Library>/Scripts/DTH-Character-Studio` — the shared install root,
 *  holding the DTH runtime files (installed once) at its top level. */
export function studioScriptsDir(dazLibraryFolder: string): string {
  return join(dazLibraryFolder, 'Scripts', 'DTH-Character-Studio')
}

/** Per-PROJECT script folder: `<root>/<project>/` — the parent of every
 *  character's generated-script folder. Deleting a project removes it whole. */
export function studioProjectScriptsDir(dazLibraryFolder: string, projectName: string): string {
  return join(studioScriptsDir(dazLibraryFolder), characterFolderName(projectName))
}

/**
 * Per-character script folder: `<root>/<project>/<character>/`. The generated
 * `<Name>_<Genesis>.dsa` lives here and imports the runtime from the root two
 * levels up. Both segments are filesystem-sanitised from the display names.
 */
export function studioCharScriptsDir(
  dazLibraryFolder: string,
  projectName: string,
  characterName: string,
): string {
  return join(
    studioScriptsDir(dazLibraryFolder),
    characterFolderName(projectName),
    characterFolderName(characterName),
  )
}

/** Marker file (hidden like the runtime it describes) recording which runtime
 *  version — and which baked-in app-data folder — is installed at the root.
 *  Lets every save+generate skip rewriting the ~11 runtime scripts when the
 *  install is already current. Written LAST, so a failed/partial install never
 *  records success. */
const RUNTIME_MARKER_FILE = '.dth-runtime-installed'

/** Every file whose absence means the install is broken: the dot-prefixed
 *  runtime files plus the visible/hidden root scripts — exactly the writes that
 *  would fail {@link copyRuntimeFiles} if they couldn't land. The Content
 *  Library icons are deliberately NOT probed: their install is best-effort
 *  (cosmetic), so a permanently unwritable icon must not force the full
 *  install to re-run on every save forever. */
function expectedRuntimeFiles(destDir: string): Array<string> {
  return [
    ...Object.keys(RUNTIME_FILES).map((name) => join(destDir, `.${name}`)),
    ...Object.keys({ ...VISIBLE_SCAN_SCRIPTS, ...HIDDEN_ROOT_SCRIPTS }).map((name) =>
      join(destDir, name),
    ),
  ]
}

/**
 * Install the bundled DTH runtime files into `destDir` (the DTH-Character-Studio
 * root), creating it if missing. They're written dot-prefixed (`.DthWorkflow.dsa`
 * etc.) so they read as hidden, and the sibling `include()` references inside
 * them are rewritten so resolution still works from a character script two levels
 * deep — see the rewrite below. Overwrites so the runtime stays current with the
 * app version — but skips the whole write when the installed marker already
 * matches this app's RUNTIME_VERSION (and app-data path): the runtime files
 * only change with a RUNTIME_VERSION bump, so rewriting them on EVERY
 * save+generate was pure overhead.
 *
 * The marker only proves an install once COMPLETED — it says nothing about the
 * files still being there NOW (a user tidying the Scripts folder deletes them,
 * and Daz logs nothing on a failed include, so the breakage would be silent
 * while the studio reports "current"). So a matching marker is backed by a
 * cheap existence probe of every file the install writes; any missing file
 * re-runs the full install. Existence only — content corruption still needs
 * `force` (hashing every file on every save+generate is the overhead the
 * marker exists to avoid).
 *
 * `force` bypasses the marker skip outright (the marker is still re-stamped
 * LAST). The user-forced Tools → Refresh passes it so "refresh anyway"
 * genuinely repairs the install, corrupted-in-place files included.
 */
export async function copyRuntimeFiles(
  destDir: string,
  options?: { force?: boolean },
): Promise<void> {
  // The visible scan scripts get the app-data folder baked in below — it's part
  // of what "installed and current" means, so it joins the marker stamp.
  const appData = (await dataDir()).replace(/\\/g, '/')
  const markerPath = join(destDir, RUNTIME_MARKER_FILE)
  const stamp = `v${RUNTIME_VERSION}|${appData}`
  if (!options?.force) {
    try {
      if ((await readTextFile(markerPath)) === stamp) {
        // Marker current — but trust it only as far as the files actually
        // exist. An exists() that THROWS (unreachable share) reads as missing:
        // falling through to the install surfaces the real error instead of
        // silently reporting a runtime nobody can verify.
        const present = await Promise.all(
          expectedRuntimeFiles(destDir).map((path) => exists(path).catch(() => false)),
        )
        if (present.every(Boolean)) return // already current AND intact
      }
    } catch {
      // no marker (fresh/legacy/partial install) — do the full install below
    }
  }
  await mkdir(destDir, { recursive: true })
  for (const [name, raw] of Object.entries(RUNTIME_FILES)) {
    // The runtime files include each other via `dir_self.filePath("Dep.dsa")`,
    // where dir_self comes from getScriptFileName() — which, inside an include(),
    // is the TOP-LEVEL character script at <root>/<project>/<character>/, two
    // levels below this runtime root. So rewrite each sibling reference to the
    // dot-prefixed name AND climb `../../` back to the root where it lives
    // (mirrors the character script's own `../../.DthWorkflow.dsa` include).
    let content = raw
    for (const dep of Object.keys(RUNTIME_FILES)) {
      content = content.split(`"${dep}"`).join(`"../../.${dep}"`)
    }
    await writeTextFile(join(destDir, `.${name}`), content)
  }
  // The visible scan scripts: installed as-is (they run at this root — their
  // includes of the dot-prefixed runtime resolve right here), with the studio's
  // app-data folder baked into their output paths so the scans land where the
  // studio reads them (DzFile wants '/').
  for (const [name, raw] of Object.entries({ ...VISIBLE_SCAN_SCRIPTS, ...HIDDEN_ROOT_SCRIPTS })) {
    await writeTextFile(join(destDir, name), raw.split('__DTH_APPDATA_DIR__').join(appData))
  }
  // …and their Content Library artwork beside them, so the scripts show up as
  // real tiles instead of broken-image placeholders. Best-effort per file: an
  // icon that won't write is cosmetic, and must not fail the install (or leave
  // the marker unstamped, which would re-run the whole install forever).
  for (const [name, dataUrl] of Object.entries(VISIBLE_SCRIPT_ICONS)) {
    try {
      await writeFile(join(destDir, name), dataUrlBytes(dataUrl))
    } catch {
      // no thumbnail for this script — the script itself still runs
    }
  }
  // Clean up earlier non-hidden copies (and the now-merged ScanKeyFrames.dsa)
  // the studio installed before runtime files were dot-prefixed, plus the
  // visible scripts that have since been retired (see above).
  for (const legacy of [
    ...Object.keys(RUNTIME_FILES),
    'ScanKeyFrames.dsa',
    ...RETIRED_VISIBLE_SCRIPTS,
  ]) {
    const old = join(destDir, legacy)
    if (await exists(old)) await remove(old)
  }
  // Every file above landed — only now record the install as current.
  await writeTextFile(markerPath, stamp)
}

/** What {@link readScriptRuntimeInfo} learns from the script on disk. */
export interface ScriptRuntimeInfo {
  /** The `// DTH-Runtime: vN` integer; `0` when the script predates the marker. */
  version: number
  /** The DIM manifests folder the script's product-scan block was generated
   *  with; '' when the script scans nothing (generated while the setting was
   *  unset). Staleness compares it against the CURRENT setting — a scan block
   *  baked for a folder that moved (or for none at all) reads a dead database
   *  and would replace good results with all-unmatched noise. */
  scanDimPath: string
}

/**
 * Read a character's generated Daz script to learn what produced the scripts on
 * disk: the `// DTH-Runtime: vN` runtime marker plus the baked product-scan
 * arming (see {@link ScriptRuntimeInfo}); `null` when no script exists yet. The
 * DTH release is no longer stamped here — the scripts are release-independent
 * (tied to RUNTIME_VERSION only); the release the PoseAsset CSV was generated
 * for lives in the character JSON's `generatedDthVersion`.
 */
export async function readScriptRuntimeInfo(
  dazLibraryFolder: string,
  projectName: string,
  character: Character,
): Promise<ScriptRuntimeInfo | null> {
  const dir = studioCharScriptsDir(dazLibraryFolder, projectName, character.name)
  const base = characterScriptName(character)
  // The main ROM script is either combined (`<base>.dsa`) or, when the export is
  // split out, `ROM_<base>.dsa`. Either carries the runtime marker in its header
  // and, when armed, the embedded `dthProductScanConfig` scan block.
  for (const name of [`${base}.dsa`, `ROM_${base}.dsa`]) {
    const path = join(dir, name)
    if (await exists(path)) {
      const text = await readTextFile(path)
      const runtime = /DTH-Runtime:\s*v(\d+)/.exec(text)
      const dim = /"dimManifestPath":\s*"([^"]*)"/.exec(text)
      return { version: runtime ? Number(runtime[1]) : 0, scanDimPath: dim ? dim[1] : '' }
    }
  }
  return null
}
