/**
 * A linked Daz scene's display name: the scene file's stem with the character's
 * name stripped (case-insensitive), then separators (underscores, dashes,
 * whitespace runs) collapsed to single spaces and trimmed — "KiraDefault_G9_GP"
 * reads "Default G9 GP" for "Kira". If stripping the name leaves nothing, the
 * whole (spaced) stem is kept. Shared by the editor header's scene tag and the
 * per-scene override toggles so they label the selected scene identically.
 * Idempotent: re-applying it to an already-pretty name is a no-op.
 */
export function prettySceneName(stem: string, characterName: string): string {
  const withoutName = characterName
    ? stem.replace(new RegExp(characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
    : stem
  const spaced = (s: string) => s.replace(/[_\s-]+/g, ' ').trim()
  return spaced(withoutName) || spaced(stem)
}
