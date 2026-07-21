---
"@dth/web": patch
---

Character-page header rework:

- **One main avatar per character**, shown everywhere and editable in any state — selecting a scene no longer swaps the big portrait. It's a square image the header over-scans with a scroll-linked zoom + pan, and it resizes as the header collapses (208×277 → 208×120).
- **The selected scene rides the title as a green "label" pill** (the linked-scene-card green): a small landscape render of the scene (greyscaled when it's the primary) followed by its name. Clicking it jumps to the scene cards.
- **Bigger title** that eases smaller as the header collapses; the scene label scroll-shifts with it.

Also: the "Daz scripts generated" path chip matches the Export directory chip's height; a new `outline-destructive` button (a light-red-bordered destructive style) is used for the export-directory Clear (icon-only ×) and the folder-move Cancel buttons; and the header's vibrancy glass is now macOS-only — Windows (WebView2) uses a plain background instead of a muddy blur.
