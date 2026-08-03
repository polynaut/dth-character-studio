import { useMemo } from 'react'

import type { ReactNode } from 'react'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
import { normalizeSceneKey } from '#/lib/rom/execute-jobs.ts'

import { EMPTY_MORPH_INDEX, MorphIndexContext } from './contexts.ts'
import type { IndexedMorphEntry } from './contexts.ts'

/**
 * Provides the scanned morph index (`Build_Genesis_Index.dsa` output) to the
 * Morph-name autocomplete ({@link MorphNameCell}), which reads it from context so
 * the deeply nested table cells don't have to thread it. Search keys are
 * lowercased ONCE here (the index can hold thousands of morphs), so the
 * per-keystroke filter compares against the pre-lowercased copy.
 *
 * **Scene filtering.** The index carries two kinds of entry (see
 * {@link MorphIndexEntry.scenes}): base morphs the stock figure of this
 * generation carries, and scene morphs a scene scan found on top of it —
 * clothing, hair, third-party grafts. Base morphs are always offered; a scene
 * morph is offered only while ONE OF ITS SCENES is the selected one. That is the
 * whole point of the scene scan: with two jackets linked to two different
 * scenes, only the jacket actually in the open scene should suggest its "Expand
 * All". With no scene selected (`scenePath` empty — a sceneless/legacy
 * definition) the scene entries are all dropped rather than all offered: an
 * unfiltered mix is exactly the noise the scan exists to remove.
 *
 * Both the ROM editor and the Advanced-options preserve-morph list wrap their
 * fields in this, so the same autocomplete works in both places.
 */
export function MorphIndexProvider({
  morphIndex,
  scenePath,
  children,
}: {
  morphIndex?: Array<MorphIndexEntry>
  /** The character editor's selected Daz scene (absolute path, '' when none) —
   *  what scene-scoped suggestions are matched against. */
  scenePath?: string
  children: ReactNode
}) {
  const sceneKey = scenePath ? normalizeSceneKey(scenePath) : ''
  const indexed = useMemo<Array<IndexedMorphEntry>>(() => {
    if (!morphIndex || morphIndex.length === 0) return EMPTY_MORPH_INDEX
    const out: Array<IndexedMorphEntry> = []
    for (const e of morphIndex) {
      const fromScene = e.scenes !== undefined && e.scenes.length > 0
      if (fromScene && (sceneKey === '' || !e.scenes?.includes(sceneKey))) continue
      out.push({
        ...e,
        nameLower: e.name.toLowerCase(),
        labelLower: e.label.toLowerCase(),
        fromScene,
      })
    }
    return out
  }, [morphIndex, sceneKey])
  return <MorphIndexContext.Provider value={indexed}>{children}</MorphIndexContext.Provider>
}
