---
"@dth/web": patch
---

Redesign the two docked footers as matching "docks": a raised 3D look (cool-blue
full-height gradient over the translucent blur, a lit top edge, and a light
upward shadow) plus a shared layout — a left section label + Add shortcut, a
horizontally-scrollable card rail, and ‹ › pager arrows that only appear when the
rail overflows (each disables at its end). The character page's scene footer
adopts the project page's Unreal-projects-dock layout (its scenes now sit in the
rail, the selected one ringed green with the PRIMARY badge) and gains the same
controls: "Add scene" links a scene and each extra card has a hover-✕ to unlink,
driving the up-page field's own pick/copy/confirm flows.

The root no longer reserves the scrollbar gutter, so on a page with no scrollbar
a dock reaches the window edge instead of stopping a scrollbar-width short.
