import { useMemo } from 'react'

import type { ReactNode } from 'react'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'

import { EMPTY_MORPH_INDEX, MorphIndexContext } from './contexts.ts'
import type { IndexedMorphEntry } from './contexts.ts'

/**
 * Provides the scanned morph index (`Scan_Morphs_<Genesis>.dsa` output) to the
 * Morph-name autocomplete ({@link MorphNameCell}), which reads it from context so
 * the deeply nested table cells don't have to thread it. Search keys are
 * lowercased ONCE here (the index can hold thousands of morphs), so the
 * per-keystroke filter compares against the pre-lowercased copy.
 *
 * Both the ROM editor and the Advanced-options preserve-morph list wrap their
 * fields in this, so the same autocomplete works in both places.
 */
export function MorphIndexProvider({
  morphIndex,
  children,
}: {
  morphIndex?: Array<MorphIndexEntry>
  children: ReactNode
}) {
  const indexed = useMemo<Array<IndexedMorphEntry>>(
    () =>
      morphIndex && morphIndex.length > 0
        ? morphIndex.map((e) => ({
            ...e,
            nameLower: e.name.toLowerCase(),
            labelLower: e.label.toLowerCase(),
          }))
        : EMPTY_MORPH_INDEX,
    [morphIndex],
  )
  return <MorphIndexContext.Provider value={indexed}>{children}</MorphIndexContext.Provider>
}
