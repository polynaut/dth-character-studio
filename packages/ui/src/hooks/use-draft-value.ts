import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/**
 * Draft state that follows a committed value: local edits update freely, and a
 * CHANGED `value` (a commit landing, an index-keyed row reusing this instance
 * with a new prop) resets the draft to it.
 *
 * The reset is the documented "adjust state when a prop changes" shape — a
 * guarded setState during render — not an effect: the stale draft is never
 * painted (the old `useEffect(() => setDraft(value), [value])` form showed it
 * for one frame, then re-rendered), and the `react/set-state-in-effect` rule
 * stays clean. React re-runs the render immediately when state is set this way,
 * which is exactly the reset happening. (React does still INVOKE the render
 * body once with the stale draft and then throw that render away — renders are
 * not commits; `use-draft-value.test.tsx` measures the committed DOM, which
 * goes straight to the new value.)
 *
 * `value` MUST be comparable by `Object.is` across renders — a primitive, or a
 * reference that is stable while it means the same thing. A value rebuilt every
 * render (an object/array literal, a fresh `.map()`) never equals `prev`, so the
 * render-phase reset fires on every render and React throws "Too many
 * re-renders". Callers that format first pass the FORMATTED string
 * (`useDraftValue(format(value))`), which is exactly this rule being obeyed.
 */
export function useDraftValue<T>(value: T): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (!Object.is(prev, value)) {
    setPrev(value)
    setDraft(value)
  }
  return [draft, setDraft]
}
