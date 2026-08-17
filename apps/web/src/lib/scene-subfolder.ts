/**
 * Scene-subfolder rules: every linked Daz scene lives in its OWN subfolder
 * below the character's scenes root — the primary's is always "primary"
 * (seeded at creation), extras get a name suggested from the sanitized scene
 * filename at add time. The export mirrors these names (each scene's export
 * nests under its subfolder — `sceneExportSubfolders` in @dth/rom), which is
 * why a subfolder can no longer be empty.
 */

import { romAnimationPath } from '@dth/rom'

import { stripTrailingDotsAndSpaces, stripTrailingSeparators, trimSeparators } from '#/lib/path.ts'

/** The primary scene's fixed subfolder below the scenes root. */
export const PRIMARY_SCENE_SUBFOLDER = 'primary'

/**
 * The character's fixed EXPORT root, below its HOUDINI subfolder:
 * `<character folder>/<project houdiniSubdir>/daz-export/`. Not user-choosable
 * (schema v29) — `Character.exportPath` is derived from this rather than stored
 * (resolved in `parseCharacter`).
 *
 * It sat under the DAZ subfolder as `dth-exports` from v0.62 until this move, on
 * the reasoning that the DTH Exporter's output is Daz-side output. It reads the
 * other way round in practice: nothing in Daz ever opens these files again — the
 * `.dth`/`.fbx`/`.abc` exist solely to be imported by Houdini, one hop from the
 * `.hip` that reads them. Hence the name too: `daz-export` is "the Daz export",
 * seen from the Houdini folder it now lives in.
 *
 * Moving it back is not free for existing users, and two mechanisms absorb that:
 * `migrateExportRoot` (api/characters.ts) carries the already-exported FILES
 * across on the character's next save, and a generated Houdini project whose
 * import paths now point at the vacated folder is repaired by Utils → **Make
 * paths portable** ({@link LEGACY_EXPORTS_FOLDER}).
 */
export const EXPORTS_FOLDER = 'daz-export'

/**
 * The name the export root carried while it lived under the Daz subfolder
 * (from v0.62 until the root moved), and — earlier still — the name of the
 * RETIRED junctions the studio planted in Houdini folders (see
 * `sweepExportJunctions`).
 *
 * The sweep must keep hunting THIS name rather than {@link EXPORTS_FOLDER}:
 * now that the live export root sits in exactly the folder the
 * sweep looks in, so pointing it at the current name would aim a delete at the
 * real thing. (The Rust side refuses anything that isn't a reparse point, so it
 * could not actually have deleted it — but a sweep whose only defence is the
 * layer below it is one refactor from being wrong.)
 */
export const LEGACY_EXPORTS_FOLDER = 'dth-exports'

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
 * {@link EXPORTS_FOLDER} qualifies whenever the project points `dazSubdir` and
 * `houdiniSubdir` at the same folder — including the degenerate case of both
 * being empty, where scenes and exports share the character folder itself. The
 * standard layout separates them, so this is a guard against a configuration
 * rather than against the everyday one; it costs a user nothing and the
 * alternative is a scene folder quietly fighting the exporter for a directory.
 * {@link LEGACY_EXPORTS_FOLDER} stays reserved beside it for as long as
 * un-migrated characters can still have one on disk.
 *
 * `rom-animations` does NOT belong here — it lives one level deeper, INSIDE
 * each scene's own subfolder, so it can never collide with a sibling.
 */
export const RESERVED_SCENE_SUBFOLDERS: ReadonlyArray<string> = [
  EXPORTS_FOLDER,
  LEGACY_EXPORTS_FOLDER,
]

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
 * (schema v29): `<character folder>/<houdiniSubdir>/daz-export`.
 *
 * Callers must only pass the folder of a character that OWNS one: a loose
 * root-level definition would resolve to the library's own
 * `<houdiniSubdir>/daz-export` and collide with every other loose character, so
 * those keep whatever export path they already had.
 *
 * `houdiniSubdir` is the project manifest's, straight — unlike the Daz side
 * there is no per-character rename to follow, which is why this takes a plain
 * value where it used to need `scenesRootRelOf`. A project that configures no
 * Houdini subfolder at all puts the export root directly in the character
 * folder; `createHoudiniSubdir` is deliberately NOT consulted, because that
 * setting only decides whether an EMPTY folder is seeded, and the export root
 * needs the folder either way.
 */
export function characterExportRoot(charFolderAbs: string, houdiniSubdir?: string): string {
  return underSubdir(charFolderAbs, houdiniSubdir, EXPORTS_FOLDER)
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
 * The variable-anchored prefix that replaces the export ROOT in generated
 * reference paths — `$HIP/daz-export` for the standard layout — or '' when only
 * absolute paths are safe.
 *
 * **Two anchors, in this order, because that is what Houdini itself writes.**
 * Measured 2026-08-10 with `hou.text.collapseCommonVars` (the call behind the
 * HDA's file picker) on a real project:
 *
 * ```
 * <char>/houdini/daz-export/primary/x.dth  ->  $HIP/daz-export/primary/x.dth
 * <char>/export/                           ->  $JOB/export/
 * ```
 *
 * `$HIP` is the folder the `.hip` sits in, and since v0.68 put `daz-export`
 * INSIDE it (`<char>/houdini/daz-export`) every import, CSV and reference path
 * is below `$HIP` — no `..` needed, and shorter. `<char>/export/`, Houdini's OWN
 * output, sits beside the houdini folder rather than under it, so `$HIP` cannot
 * express it without climbing out; Houdini writes `$JOB/export/` there even when
 * `$HIP` is the preferred variable, and so does this.
 *
 * So the rule is: **`$HIP` when the export root is under the `.hip`'s own folder,
 * `$JOB` when it is only under the character folder, absolute otherwise.**
 *
 * `$HIP` has one property `$JOB` cannot match: it is DERIVED from where the file
 * sits and can never be wrong. `$JOB` is scene state — it leaks between files in
 * one hython run (measured, see `.ai/gotchas.md`), the studio ships a *Repair
 * `$JOB`* action precisely because it drifts, and a project whose `$JOB` points
 * at another character resolves every `$JOB/…` import to that character's files.
 * `$HIP`-anchored imports survive that.
 *
 * The cost `$HIP` brings back is DEPTH: it names the `.hip`'s own folder, so one
 * prefix is only right if every linked project shares that folder — hence the
 * single-anchor gate ({@link hipAnchorDirs} must yield exactly one). Projects
 * spread across folders fall through to `$JOB`, which encodes no depth; that is
 * the v63 property, kept for exactly the case that needs it. The studio's own
 * Generate and Copy-in always land a project directly in the houdini folder, so
 * the `$HIP` tier is what a managed character actually gets.
 *
 * What still forces absolute paths: no linked project at all, a project OUTSIDE
 * the character folder (hand-linked in the user's own tree, where `$JOB` is
 * whatever they set), or an export root outside the character folder.
 *
 * Older projects carry `$JOB/houdini/…` (v63–v65) or `$HIP/../…` (pre-v63). Both
 * still resolve. Only the pre-v63 form is FLAGGED (`hip-relative`), because only
 * it is depth-fragile; the `$JOB` form is merely longer, and Utils → **Make
 * paths portable** shortens it without the card ever crying wolf.
 */
export function hipRefPrefixFor(
  houdiniProjects: ReadonlyArray<string>,
  charFolderAbs: string,
  exportRootAbs: string,
): string {
  const folder = stripTrailingSeparators(charFolderAbs.replace(/\\/g, '/'))
  const exportRoot = stripTrailingSeparators(exportRootAbs.trim().replace(/\\/g, '/'))
  if (!folder || !exportRoot || houdiniProjects.length === 0) return ''
  const under = (root: string, p: string) =>
    p.trim().replace(/\\/g, '/').toLowerCase().startsWith(`${root.toLowerCase()}/`)
  if (!houdiniProjects.every((p) => under(folder, p))) return ''

  // `$HIP` — every project in ONE folder, and the exports under it. `$HIP` names
  // that folder, so two anchor folders would be two different `$HIP`s and no
  // single prefix could be right for both.
  const anchors = hipAnchorDirs(houdiniProjects, charFolderAbs)
  const anchor = anchors.length === 1 ? (anchors[0] ?? '') : ''
  if (anchor && exportRoot.toLowerCase() === anchor.toLowerCase()) return '$HIP'
  if (anchor && under(anchor, exportRoot)) return `$HIP/${exportRoot.slice(anchor.length + 1)}`

  // `$JOB` — the character folder. Reached when the projects sit in different
  // folders, or the export root is elsewhere in the character's tree (a layout
  // from before `daz-export` moved into `houdini/`). Encodes no depth, so it is
  // right for every project at once.
  if (!under(folder, exportRoot)) return ''
  return `$JOB/${exportRoot.slice(folder.length + 1)}`
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

/**
 * What "Delete file on disk" removes when a scene is unlinked: the scene's own
 * SUBFOLDER when it provably has one to itself — every linked scene lives in
 * its own folder below the scenes root (see the header comment), and that
 * folder holds the scene, its thumbnails and its saved `rom-animations/` —
 * else the scene's files plus its own saved ROM animation, leaving the shared
 * folder alone (the legacy layout parks several scenes, and one shared
 * `rom-animations/`, directly in the root).
 *
 * The folder answer requires ALL of these — each guard alone closes one way to
 * delete files that aren't the scene's:
 * - the scene sits INSIDE the character folder (a linked-in-place scene is the
 *   user's original; its folder is never the studio's to delete);
 * - its dir is strictly BELOW the scenes root — never the root itself, the
 *   character folder, or anything outside them;
 * - no OTHER still-linked scene lives at or under that dir (two scenes sharing
 *   a folder fall back to per-file deletion).
 * For a nested subfolder only the DIRECT parent is returned — an ancestor
 * could hold sibling scenes' folders.
 */
export function sceneDeleteTargets(args: {
  sceneAbs: string
  charFolderAbs: string
  /** The character's scenes root relative to its folder ({@link deriveScenesRootRel}). */
  scenesRootRel: string
  /** Scenes still linked AFTER this removal (absolute paths). */
  remainingScenesAbs: ReadonlyArray<string>
}): { folders: Array<string>; files: Array<string> } {
  const norm = (p: string) => stripTrailingSeparators(p.replace(/\\/g, '/'))
  const lower = (p: string) => p.toLowerCase()
  /** Strictly below `dir` (never `dir` itself) — case-insensitive (Windows). */
  const below = (dir: string, p: string) => lower(p).startsWith(`${lower(dir)}/`)

  const scene = norm(args.sceneAbs)
  const slash = scene.lastIndexOf('/')
  const sceneDir = slash > 0 ? scene.slice(0, slash) : ''
  const charFolder = norm(args.charFolderAbs)
  const rootRel = trimSeparators(args.scenesRootRel.replace(/\\/g, '/')).trim()
  const scenesRoot = rootRel ? `${charFolder}/${rootRel}` : charFolder

  const ownsFolder =
    sceneDir !== '' &&
    charFolder !== '' &&
    below(charFolder, scene) &&
    below(scenesRoot, sceneDir) &&
    !args.remainingScenesAbs.some((s) => {
      const other = norm(s)
      return lower(other) === lower(sceneDir) || below(sceneDir, other)
    })
  if (ownsFolder) return { folders: [sceneDir], files: [] }

  // Shared/legacy layout: the scene's files, its thumbnails, and its own saved
  // ROM animation (`rom-animations/` itself may hold other scenes' saves).
  const noDuf = scene.replace(/\.duf$/i, '')
  const rom = romAnimationPath(scene)
  return {
    folders: [],
    files: [scene, `${scene}.png`, `${scene}.tip.png`, `${noDuf}.tip.png`, rom, `${rom}.png`],
  }
}
