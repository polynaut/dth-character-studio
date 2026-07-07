import { createContext } from 'react'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'

// The machine-wide morph index (Scan_Morphs_<Genesis>.dsa output) that powers the
// Morph-name autocomplete. A context so the deeply nested cells can reach it
// without threading through the editor/group/table layers.

/** A morph-index entry with its search keys pre-lowercased ONCE (the provider
 *  memoizes this), so the per-keystroke filter doesn't call toLowerCase()
 *  twice per entry on every character typed. */
export interface IndexedMorphEntry extends MorphIndexEntry {
  nameLower: string
  labelLower: string
}

export const EMPTY_MORPH_INDEX: Array<IndexedMorphEntry> = []
export const MorphIndexContext = createContext<Array<IndexedMorphEntry>>(EMPTY_MORPH_INDEX)

// The default scene node for new ROM entries — the unrenamed base figure of the
// character's generation (Genesis9, Genesis8_1Female, …). A context for the same
// reason as the morph index: the fallback lives in deeply nested table cells.
export const FigureNodeContext = createContext<string>('Genesis9')
