import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'

import { characterScriptName } from '@dth/rom'
import type { Character } from '@dth/rom'

import { characterFolderName } from '../library'
// The DTH runtime (DazToHue-Scripts) is bundled into the app so the studio is
// self-contained — no external checkout to configure. copyRuntimeFiles installs
// these (rewritten + dot-prefixed). Keep them in sync with the DazToHue-Scripts
// source; bump RUNTIME_VERSION (@dth/rom) when they change so Refresh assets flags
// characters whose generated scripts need regenerating.
import dthUtilsRuntime from '../runtime/DthUtils.dsa?raw'
import dthOptionsRuntime from '../runtime/DthOptions.dsa?raw'
import dthWorkflowRuntime from '../runtime/DthWorkflow.dsa?raw'
import dthProductsRuntime from '../runtime/DthProducts.dsa?raw'
import dthScanMorphsRuntime from '../runtime/DthScanMorphs.dsa?raw'
import scanMorphsG9 from '../runtime/Scan_Morphs_G9.dsa?raw'
import scanMorphsG81 from '../runtime/Scan_Morphs_G8.1.dsa?raw'
import scanMorphsG8 from '../runtime/Scan_Morphs_G8.dsa?raw'
import scanMorphsG3 from '../runtime/Scan_Morphs_G3.dsa?raw'

import { join } from './fs'
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
  // Morph-scanner runtime — included by the VISIBLE Scan_Morphs_<Genesis>.dsa
  // wrappers below; feeds the Morph-name autocomplete's per-generation index.
  'DthScanMorphs.dsa': dthScanMorphsRuntime,
}

/**
 * The visible per-generation morph-scan scripts, installed AS-IS at the
 * DTH-Character-Studio root (they run there, so they include
 * `.DthScanMorphs.dsa` directly — no `../../` rewrite), with the studio's
 * app-data folder baked into their output path at install time.
 */
const SCAN_MORPH_SCRIPTS: Record<string, string> = {
  'Scan_Morphs_G9.dsa': scanMorphsG9,
  'Scan_Morphs_G8.1.dsa': scanMorphsG81,
  'Scan_Morphs_G8.dsa': scanMorphsG8,
  'Scan_Morphs_G3.dsa': scanMorphsG3,
}

/** `<My DAZ 3D Library>/Scripts/DTH-Character-Studio` — the shared install root,
 *  holding the DTH runtime files (installed once) at its top level. */
export function studioScriptsDir(dazLibraryFolder: string): string {
  return join(dazLibraryFolder, 'Scripts', 'DTH-Character-Studio')
}

/** `<My DAZ 3D Library>/Scripts/DazToHue-Scripts` — where the soltude/DazToHue-Scripts
 *  repo is downloaded + unpacked (Tools installer). Separate from the studio's own
 *  bundled DTH-Character-Studio runtime root above. */
export function daztohueScriptsDir(dazLibraryFolder: string): string {
  return join(dazLibraryFolder, 'Scripts', 'DazToHue-Scripts')
}

/** The commit SHA recorded in the installed DazToHue-Scripts version marker
 *  (`<daztohueScriptsDir>/.dth-version.json`, written by the Rust installer), or
 *  null when the scripts aren't installed / the marker is missing or unreadable.
 *  Living inside the install folder makes it the ground truth: delete the install
 *  and the marker goes with it, so we never claim something stale is installed. */
export async function readDazToHueScriptsCommit(dazLibraryFolder: string): Promise<string | null> {
  const lib = dazLibraryFolder.trim()
  if (!lib) return null
  try {
    const raw = await readTextFile(join(daztohueScriptsDir(lib), '.dth-version.json'))
    const parsed = JSON.parse(raw) as { commit?: unknown }
    return typeof parsed.commit === 'string' && parsed.commit ? parsed.commit : null
  } catch {
    return null // not installed, no marker, or unreadable — all "unknown locally"
  }
}

/** Whether a DazToHue-Scripts install exists on disk at all, regardless of whether
 *  it carries a version marker — lets the UI tell a pre-versioning install (files
 *  present, installed before we tracked commits) apart from no install at all. */
export async function daztohueScriptsPresent(dazLibraryFolder: string): Promise<boolean> {
  const lib = dazLibraryFolder.trim()
  if (!lib) return false
  try {
    return await exists(daztohueScriptsDir(lib))
  } catch {
    return false
  }
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

/**
 * Install the bundled DTH runtime files into `destDir` (the DTH-Character-Studio
 * root), creating it if missing. They're written dot-prefixed (`.DthWorkflow.dsa`
 * etc.) so they read as hidden, and the sibling `include()` references inside
 * them are rewritten so resolution still works from a character script two levels
 * deep — see the rewrite below. Overwrites so the runtime stays current with the
 * app version.
 */
export async function copyRuntimeFiles(destDir: string): Promise<void> {
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
  // The visible Scan_Morphs_<Genesis>.dsa scripts: installed as-is (they run at
  // this root — their include of `.DthScanMorphs.dsa` resolves right here), with
  // the studio's app-data folder baked into the JSON output path so the scan
  // lands where the Morph-name autocomplete reads it (DzFile wants '/').
  const appData = (await dataDir()).replace(/\\/g, '/')
  for (const [name, raw] of Object.entries(SCAN_MORPH_SCRIPTS)) {
    await writeTextFile(join(destDir, name), raw.split('__DTH_APPDATA_DIR__').join(appData))
  }
  // Clean up earlier non-hidden copies (and the now-merged ScanKeyFrames.dsa)
  // the studio installed before runtime files were dot-prefixed. Scan_Morphs
  // wrappers are exempt — they're MEANT to be visible.
  for (const legacy of [...Object.keys(RUNTIME_FILES), 'ScanKeyFrames.dsa']) {
    const old = join(destDir, legacy)
    if (await exists(old)) await remove(old)
  }
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
