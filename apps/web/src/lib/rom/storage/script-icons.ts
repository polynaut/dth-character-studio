// Sequential `await` in a loop is this module's normal shape, not an oversight:
// it is ORDERED filesystem work — a step reads, moves or overwrites what the
// step before it wrote, and the rule's advice (`Promise.all`) would race those
// against each other. Scoped off for the file rather than repeated at each
// loop; a loop here that genuinely CAN run in parallel should use `Promise.all`
// on its own merits.
/* oxlint-disable no-await-in-loop */
import { writeFile } from '@tauri-apps/plugin-fs'

import type { GeneratedFile, ScriptIcon } from '@dth/rom'

// Content Library artwork for the GENERATED per-character scripts. File names
// match the `ScriptIcon` union in @dth/rom, so the tag a generated file carries
// maps to its bytes by plain lookup — nothing to keep in step by hand. `?inline`
// bundles them as base64 data URLs (no asset fetch under the strict CSP).
import romIcon from '../script-icons/rom.png?inline'
import romTip from '../script-icons/rom.tip.png?inline'
import romExportIcon from '../script-icons/rom-export.png?inline'
import romExportTip from '../script-icons/rom-export.tip.png?inline'
import exportIcon from '../script-icons/export.png?inline'
import exportTip from '../script-icons/export.tip.png?inline'
import exportHairIcon from '../script-icons/export-hair.png?inline'
import exportHairTip from '../script-icons/export-hair.tip.png?inline'
import scanProductsIcon from '../script-icons/scan-products.png?inline'
import scanProductsTip from '../script-icons/scan-products.tip.png?inline'

import { dataUrlBytes, join } from './fs'

/**
 * Daz shows a script's artwork purely by NAME — `<script base>.png` for the
 * 91×91 Content Library tile, `<script base>.tip.png` for the 256×256 hover
 * preview. So each generated `.dsa` gets its pair written beside it, and the
 * pair's names are derived from the script's, never stored.
 *
 * Which artwork a script gets is decided in the pure core (the `icon` tag on a
 * {@link GeneratedFile}) because it follows a generation rule the core owns:
 * a ROM script that also runs the export looks different from one that doesn't,
 * and that is exactly the `exportWithRomScript` split. Only the bytes live here.
 */
const SCRIPT_ICONS: Record<ScriptIcon, { tile: string; tip: string }> = {
  rom: { tile: romIcon, tip: romTip },
  'rom-export': { tile: romExportIcon, tip: romExportTip },
  export: { tile: exportIcon, tip: exportTip },
  'export-hair': { tile: exportHairIcon, tip: exportHairTip },
  'scan-products': { tile: scanProductsIcon, tip: scanProductsTip },
}

/** The artwork file names for a script file (`ROM_X.dsa` → `ROM_X.png`,
 *  `ROM_X.tip.png`). Also the shape the stale-artifact sweep looks for. */
export function scriptIconNames(scriptFileName: string): Array<string> {
  const base = scriptFileName.replace(/\.dsa$/i, '')
  return [`${base}.png`, `${base}.tip.png`]
}

/**
 * Write the Content Library artwork for every generated file that carries an
 * `icon` tag, and return the names written — the caller folds those into the
 * just-written set so its stale-artifact sweep can't delete them.
 *
 * Best-effort per script: artwork is cosmetic and must never fail a generate
 * that already produced working scripts. A file whose write fails is simply
 * left out of the returned list, so the sweep is free to retire it.
 */
export async function writeScriptIcons(
  folder: string,
  files: Array<GeneratedFile>,
): Promise<Array<string>> {
  const written: Array<string> = []
  for (const file of files) {
    if (!file.icon) continue
    const art = SCRIPT_ICONS[file.icon]
    const [tileName, tipName] = scriptIconNames(file.fileName)
    for (const [name, dataUrl] of [
      [tileName, art.tile],
      [tipName, art.tip],
    ] as const) {
      try {
        await writeFile(join(folder, name), dataUrlBytes(dataUrl))
        written.push(name)
      } catch {
        // no tile for this script — the script itself still runs
      }
    }
  }
  return written
}
