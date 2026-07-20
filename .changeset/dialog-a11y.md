---
"@dth/ui": patch
"@dth/web": patch
---

Keyboard and screen-reader accessibility sweep: a new `Modal` primitive (Radix Dialog — real focus trap, initial focus, focus restore, Escape/backdrop dismissal, proper dialog semantics) now backs every previously hand-rolled overlay (remove-asset, bulk-delete, scene-copy, avatar image, scene-copy prompt and the "Daz already open" notice — the avatar dialog gains Escape support it never had). The side panel manages focus properly instead of declaring `aria-modal` without containment. ROM section headers are real accordion buttons (focusable, Enter/Space, `aria-expanded`) instead of click-only divs. `Field` labels are programmatically associated with their controls and errors (`htmlFor`/`aria-describedby`). The linked-asset card's corner-open control works from the keyboard, `NumberField` commits on Enter, the editable page title keeps its heading semantics for assistive tech, the Home screen's "remove from recents" button becomes visible on keyboard focus, and the UI-config provider no longer re-renders all consumers on every host render.
