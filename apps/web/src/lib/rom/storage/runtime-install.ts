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
import buildGenesisIndexScript from '../runtime/Build_Genesis_Index.dsa?raw'
import scanFramesScript from '../runtime/Scan_Frames.dsa?raw'
import fixGraftShellSurfacesScript from '../runtime/Fix_Graft_Shell_Surfaces.dsa?raw'
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
const VISIBLE_SCAN_SCRIPTS: Record<string, string> = {
  'Build_Genesis_Index.dsa': buildGenesisIndexScript,
  'Scan_Frames.dsa': scanFramesScript,
  // Scene hygiene rather than a scan: switches off the foreign-geograft surfaces
  // on a Golden Palace / Dicktator geoshell (see DthShellSurfaces.dsa). Bakes in
  // no path — it reads and writes the open scene only.
  'Fix_Graft_Shell_Surfaces.dsa': fixGraftShellSurfacesScript,
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
 * `force` bypasses that marker skip (the marker is still re-stamped LAST): the
 * marker only proves an install once COMPLETED — a runtime file deleted or
 * corrupted since would be skipped forever on the routine path. The user-forced
 * Tools → Refresh passes it so "refresh anyway" genuinely repairs the install.
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
      if ((await readTextFile(markerPath)) === stamp) return // already current
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
  for (const [name, raw] of Object.entries(VISIBLE_SCAN_SCRIPTS)) {
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

/**
 * Read the `// DTH-Runtime: vN` marker from a character's generated Daz script to
 * learn which runtime produced the scripts on disk: the integer `N`; `0` when a
 * script exists but predates the marker (an older runtime); `null` when no script
 * exists yet. The DTH release is no longer stamped here — the scripts are
 * release-independent (tied to RUNTIME_VERSION only); the release the PoseAsset
 * CSV was generated for lives in the character JSON's `generatedDthVersion`.
 */
export async function readScriptRuntimeVersion(
  dazLibraryFolder: string,
  projectName: string,
  character: Character,
): Promise<number | null> {
  const dir = studioCharScriptsDir(dazLibraryFolder, projectName, character.name)
  const base = characterScriptName(character)
  // The main ROM script is either combined (`<base>.dsa`) or, when the export is
  // split out, `ROM_<base>.dsa`. Either carries the runtime marker in its header.
  for (const name of [`${base}.dsa`, `ROM_${base}.dsa`]) {
    const path = join(dir, name)
    if (await exists(path)) {
      const runtime = /DTH-Runtime:\s*v(\d+)/.exec(await readTextFile(path))
      return runtime ? Number(runtime[1]) : 0
    }
  }
  return null
}
