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
