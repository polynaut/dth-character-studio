import { displayPath } from '#/lib/path.ts'
import { studioCharScriptsDir } from '#/lib/rom/storage.ts'

import type { CharacterLocation } from '#/lib/rom/api.ts'

/** A directory plus the known root it lives under, for the two-tone path chip
 *  (`DirPathChip`): the root renders dimmed, the remainder emphasized. */
export interface RootedDir {
  dir: string
  root: string
}

/**
 * Where the generated `ROM_<Name>_<Genesis>.dsa` (and friends) install in the
 * Daz library — the scripts pane and the Products tab both show it. Null until
 * "My DAZ 3D Library" is set (the panes then show their setup notice). Keeps
 * the `studioCharScriptsDir` storage-layer import out of route/components.
 */
export function characterScriptsDisplay(
  dazLibraryFolder: string,
  projectName: string,
  characterName: string,
): RootedDir | null {
  if (!dazLibraryFolder || !projectName) return null
  return {
    dir: displayPath(studioCharScriptsDir(dazLibraryFolder, projectName, characterName)),
    root: displayPath(dazLibraryFolder),
  }
}

/**
 * The character's folder for the header chip: the project library root dimmed
 * as a label prefix, the rest emphasized. The definition filename is dropped
 * (it's edited in the Filepath fields) — just the folder remains.
 */
export function characterFolderDisplay(location: CharacterLocation): RootedDir {
  const dirAbs = displayPath(location.definitionAbs)
  const lastSep = Math.max(dirAbs.lastIndexOf('\\'), dirAbs.lastIndexOf('/'))
  return {
    dir: lastSep >= 0 ? dirAbs.slice(0, lastSep) : dirAbs,
    root: displayPath(location.libraryFolder),
  }
}
