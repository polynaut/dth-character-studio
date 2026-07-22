---
"@dth/web": patch
"@dth/ui": patch
---

Character-editor UI pass:

- **Sticky panel titles** — the ROM, Advanced options, Export directory and Daz scripts titles now pin under the character header and push each other out as you scroll, the same way the ROM accordion + table headers already do.
- **Genesis + Gender** are set only at character creation, so they're no longer shown (or editable) in the editor.
- Dropped the sticky "OVERRIDE · scene" bar above the tabs; the Advanced-options Override toggle now rides its heading row; the Export directory panel sits just before Daz scripts.
- Polish: muted grey-green inactive override toggle, compact "OVERRIDE" label in the small tracked-uppercase style, Hair-items label tight to its field like every other label, bigger "Daz scenes" title, the Export clear button + the Advanced-options bin as light-bordered trash buttons, smaller multiselect item text, no redundant scene-card tooltip, and the Discard/Save buttons animate only their bottom margin on scroll.
- Fixed a bogus "not found / unlisted hair" warning that flashed for one frame when switching Daz scenes.

Under the hood, `--editor-header-h` (the sticky offset every layer pins against) is pure CSS now — an animated `@property` on the header's scroll timeline instead of a JS ResizeObserver.
