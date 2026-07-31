/**
 * Scene-subfolder rules: every linked Daz scene lives in its OWN subfolder
 * below the character's scenes root — the primary's is always "primary"
 * (seeded at creation), extras get a name suggested from the sanitized scene
 * filename at add time. The export mirrors these names (each scene's export
 * nests under its subfolder — `sceneExportSubfolders` in @dth/rom), which is
 * why a subfolder can no longer be empty.
 */

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
 * The character's ONE Houdini project folder, below its Houdini subfolder:
 * `<character folder>/<project houdiniSubdir>/houdini-project/`. Fixed name,
 * created once by the first "Generate project" and REUSED by every later one —
 * all of a character's `.hiplc` files Set-Project to the same folder, so
 * `$JOB` means one thing for the character.
 *
 * It holds no exports. A {@link EXPORTS_FOLDER}-named JUNCTION inside it points
 * at the real export root, purely so Houdini's file picker — which opens at
 * `$JOB` — shows `dth-exports/` right there instead of making the user climb
 * two levels into the Daz subfolder. Nothing depends on it: delete it and only
 * that shortcut is lost (which is also the escape hatch if a tool that scans
 * the project folder, Perforce included, dislikes reparse points).
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
  const folder = charFolderAbs.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!folder) return ''
  const sub = (subdir ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
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
  const joined = words.join('_').replace(/[. ]+$/, '')
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
