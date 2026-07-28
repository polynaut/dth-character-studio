---
'@dth/web': patch
---

The character editor's sticky header grew a "Scroll Up" beside its Back link (pipe-separated, a step darker, native smooth scroll) — the pair fades in together once the page's own Back link has scrolled away. Renaming the character in the collapsed header no longer pops the title to full size: the edit input rides the same scroll-shrink timeline as the displayed title (52px at the top, 44px collapsed). The subtitle leads with the character's ♀/♂ symbol.
