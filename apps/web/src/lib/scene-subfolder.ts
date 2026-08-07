/**
 * Scene-subfolder rules: every linked Daz scene lives in its OWN subfolder
 * below the character's scenes root — the primary's is always "primary"
 * (seeded at creation), extras get a name suggested from the sanitized scene
 * filename at add time. The export mirrors these names (each scene's export
 * nests under its subfolder — `sceneExportSubfolders` in @dth/rom), which is
 * why a subfolder can no longer be empty.
 */

import { stripTrailingDotsAndSpaces, stripTrailingSeparators, trimSeparators } from '#/lib/path.ts'

/** The primary scene's fixed subfolder below the scenes root. */
export const PRIMARY_SCENE_SUBFOLDER = 'primary'

/**
 * The character's fixed EXPORT root, below its Daz subfolder:
 * `<character folder>/<project dazSubdir>/dth-exports/`. Not user-choosable
 * (schema v29) — the DTH Exporter's output is Daz-side output, so it lives
 * beside the scenes that produce it, and `Character.exportPath` is derived
 * from this rather than stored (resolved in `parseCharacter`).
 */
export const EXPORTS_FOLDER = 'dth-exports'

/**
 * RETIRED (v0.68) — nothing creates this folder anymore. It was the fixed-name
 * per-character "project" folder (`<char>/<houdiniSubdir>/houdini-project/`)
 * every generated `.hiplc` Set-Projected to; since v0.64 `$JOB` is the
 * CHARACTER folder, and the folder itself only ever stayed empty (Houdini's
 * own output is `$HIP`-relative and landed beside the scenes).
 *
 * The constant survives solely for the SWEEPS: `sweepHoudiniProjectDirs`
 * removes empty leftovers (a non-empty one — real pre-v0.64 `$JOB` output —
 * is kept and reported), and `sweepExportJunctions` still looks inside for
 * leftover `dth-exports` junctions so the folder can empty and then go.
 */
export const HOUDINI_PROJECT_FOLDER = 'houdini-project'

/**
 * Names a scene subfolder may NOT take, because the studio already owns a
 * folder of that name directly under the character's scenes root — a scene
 * moved there would fight the studio for the same directory.
 *
 * Only {@link EXPORTS_FOLDER} qualifies today: `<char>/<dazSubdir>/dth-exports`
 * sits at exactly the level scene subfolders do. `rom-animations` does NOT
 * belong here — it lives one level deeper, INSIDE each scene's own subfolder,
 * so it can never collide with a sibling.
 */
export const RESERVED_SCENE_SUBFOLDERS: ReadonlyArray<string> = [EXPORTS_FOLDER]

/**
 * Why `subfolder` can't be used as a scene subfolder, or '' when it's fine.
 * Judged on the FIRST segment — the one landing directly under the scenes root,
 * which is the only level the studio's own folders occupy. Case-insensitive
 * (Windows), so `DTH-Exports` is refused too.
 */
export function sceneSubfolderConflict(subfolder: string): string {
  const first = subfolder.split(/[\\/]+/).filter(Boolean)[0] ?? ''
  const clash = RESERVED_SCENE_SUBFOLDERS.find(
    (reserved) => reserved.toLowerCase() === first.toLowerCase(),
  )
  if (!clash) return ''
  return `"${clash}" is where this character's exports go — pick another folder name.`
}

/** `<charFolder>/<subdir>/<leaf>` with forward slashes and no empty segments —
 *  the shared spelling behind the two resolvers below (a project may configure
 *  no subdir at all, in which case the leaf sits directly in the folder). */
function underSubdir(charFolderAbs: string, subdir: string | undefined, leaf: string): string {
  const folder = stripTrailingSeparators(charFolderAbs.replace(/\\/g, '/'))
  if (!folder) return ''
  const sub = trimSeparators((subdir ?? '').replace(/\\/g, '/')).trim()
  return [folder, sub, leaf].filter(Boolean).join('/')
}

/**
 * A character's export root — the DERIVED value of `Character.exportPath`
 * (schema v29). Callers must only pass the folder of a character that OWNS one:
 * a loose root-level definition would resolve to the library's own
 * `<dazSubdir>/dth-exports` and collide with every other loose character, so
 * those keep whatever export path they already had.
 */
export function characterExportRoot(charFolderAbs: string, dazSubdir?: string): string {
  return underSubdir(charFolderAbs, dazSubdir, EXPORTS_FOLDER)
}

/** A character's Houdini folder — where its generated `.hiplc` files live,
 *  beside the shared project folder below. */
export function characterHoudiniDir(charFolderAbs: string, houdiniSubdir?: string): string {
  return underSubdir(charFolderAbs, houdiniSubdir, '')
}

/** A character's one Houdini project folder ($JOB) — see
 *  {@link HOUDINI_PROJECT_FOLDER}. */
export function characterHoudiniProjectDir(charFolderAbs: string, houdiniSubdir?: string): string {
  return underSubdir(charFolderAbs, houdiniSubdir, HOUDINI_PROJECT_FOLDER)
}

/**
 * Where `$HIP`-anchored reference paths can anchor: the distinct folders
 * holding a linked `.hip` INSIDE the character folder. A project linked
 * OUTSIDE the character folder is the user's own tree — no fixed relative
 * path can reach the export root from an arbitrary location, so it never
 * anchors `$HIP` paths. Deduped case-insensitively (Windows paths); returned
 * with forward slashes.
 */
export function hipAnchorDirs(
  houdiniProjects: ReadonlyArray<string>,
  charFolderAbs: string,
): Array<string> {
  const folder = stripTrailingSeparators(charFolderAbs.replace(/\\/g, '/'))
  if (!folder) return []
  const prefix = `${folder.toLowerCase()}/`
  const dirs = new Map<string, string>()
  for (const hip of houdiniProjects) {
    const norm = stripTrailingSeparators(hip.trim().replace(/\\/g, '/'))
    if (!norm.toLowerCase().startsWith(prefix)) continue
    const dir = norm.slice(0, norm.lastIndexOf('/'))
    if (!dirs.has(dir.toLowerCase())) dirs.set(dir.toLowerCase(), dir)
  }
  return [...dirs.values()]
}

/**
 * The `$HIP`-anchored prefix that replaces the export ROOT in generated
 * reference-skeleton paths — e.g. `$HIP/../daz3d/dth-exports` for the
 * standard layout — or '' when only absolute paths are safe.
 *
 * One prefix must be right for EVERY linked `.hip`, so relative emission
 * requires: at least one linked project, all of them inside the character
 * folder, all in the SAME folder, and the export root reachable from it on
 * the same drive. Anything else — no projects yet, a hand-linked `.hip` in
 * the user's own tree, projects spread over two folders — falls back to
 * absolute. (This replaced the `dth-exports` junctions: same gate shape,
 * no reparse points.)
 */
export function hipRefPrefixFor(
  houdiniProjects: ReadonlyArray<string>,
  charFolderAbs: string,
  exportRootAbs: string,
): string {
  const folder = stripTrailingSeparators(charFolderAbs.replace(/\\/g, '/'))
  const exportRoot = stripTrailingSeparators(exportRootAbs.trim().replace(/\\/g, '/'))
  if (!folder || !exportRoot || houdiniProjects.length === 0) return ''
  const prefix = `${folder.toLowerCase()}/`
  const inside = (hip: string) =>
    hip.trim().replace(/\\/g, '/').toLowerCase().startsWith(prefix)
  if (!houdiniProjects.every(inside)) return ''
  const anchors = hipAnchorDirs(houdiniProjects, charFolderAbs)
  if (anchors.length !== 1) return ''
  // `..` up from the anchor to the common ancestor, then down to the root.
  const from = anchors[0].split('/')
  const to = exportRoot.split('/')
  if (from[0].toLowerCase() !== to[0].toLowerCase()) return '' // cross-drive
  let common = 0
  while (
    common < from.length &&
    common < to.length &&
    from[common].toLowerCase() === to[common].toLowerCase()
  ) {
    common++
  }
  const parts = [...Array.from({ length: from.length - common }, () => '..'), ...to.slice(common)]
  return parts.length === 0 ? '' : `$HIP/${parts.join('/')}`
}

/** Tokens that carry no scene identity — generation markers and the DTH preset
 *  block names ("G9", "Genesis 8.1", "gen", "golden palace", "dicktator", …).
 *  Compared per word, case-insensitively, after the character name is removed. */
const NOISE_TOKENS = new Set([
  'gen',
  'genesis',
  'gp',
  'dk',
  'dqs',
  'golden',
  'palace',
  'goldenpalace',
  'dicktator',
])

/** A generation marker word: G9 / g8.1 / Genesis9 / genesis8.1 … */
const GENERATION_WORD = /^g(?:enesis)?\d+(?:\.\d+)?$/i

/**
 * Suggest a subfolder name for a scene being added: the scene's file stem with
 * the character name and the generation/preset noise removed, joined back with
 * underscores — `Electra_G9_Beach Armor.duf` (character "Electra") →
 * `Beach_Armor`. Never empty: when nothing survives (the scene is named purely
 * after the character, e.g. `Electra_G9.duf`), it falls back to `scene`. The
 * result is filesystem-safe (illegal characters stripped, no trailing dots).
 */
export function suggestSceneSubfolder(scenePath: string, characterName: string): string {
  const file = scenePath.replace(/\\/g, '/').split('/').pop() ?? ''
  let stem = file.replace(/\.[^.]+$/, '')
  // Remove the character name wherever it appears (also squeezed variants —
  // "ElectraG9" — since the name match doesn't need word boundaries).
  const name = characterName.trim()
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    stem = stem.replace(new RegExp(escaped, 'gi'), ' ')
  }
  // Attached generation markers ("G9Armor" → " Armor") before the word pass.
  stem = stem.replace(/g(?:enesis)?\s*\d+(?:\.\d+)?/gi, ' ')
  const words = stem
    .replace(/[<>:"/\\|?*]/g, ' ')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .filter((word) => !NOISE_TOKENS.has(word.toLowerCase()) && !GENERATION_WORD.test(word))
  const joined = stripTrailingDotsAndSpaces(words.join('_'))
  return joined || 'scene'
}

/**
 * The character's scenes ROOT, as a path relative to the character folder,
 * derived from where the PRIMARY scene lives (`primaryDirRel`, also relative):
 * the project's `dazSubdir` prefix when the primary sits under it (the primary
 * itself lives in a SUBFOLDER of the root — "primary" — since schema v26), else
 * the primary's dir with a trailing "primary" segment stripped (a renamed
 * root), else the primary's dir itself (legacy: the primary still sits
 * directly in the root — the Refresh sweep moves it). ONE rule shared by the
 * scene cards UI, generation and the Refresh migration, so they can't disagree
 * on what the root is.
 */
export function deriveScenesRootRel(primaryDirRel: string, dazSubdir: string): string {
  const clean = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/')
  const rel = clean(primaryDirRel)
  const def = clean(dazSubdir)
  if (
    rel !== '' &&
    def !== '' &&
    (rel.toLowerCase() === def.toLowerCase() || rel.toLowerCase().startsWith(`${def.toLowerCase()}/`))
  ) {
    return rel.slice(0, def.length)
  }
  const segments = rel.split('/').filter(Boolean)
  if (segments.length > 1 && segments[segments.length - 1].toLowerCase() === PRIMARY_SCENE_SUBFOLDER) {
    return segments.slice(0, -1).join('/')
  }
  return rel
}
