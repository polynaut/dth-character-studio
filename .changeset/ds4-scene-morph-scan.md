---
# patch: a scan that silently did nothing in one Daz Studio now works — no new
# capability, and the runtime bump is what carries the fix to installed scripts.
'@dth/web': patch
'@dth/rom': patch
---

**Fixed: the scene morph scan did nothing at all in Daz Studio 4.**

Every ROM and export run also scans its scene, so the Morph-name autocomplete keeps up with what your outfits and hair add. In Daz Studio 4 that scan was skipped every single time, with *"No Genesis 3, 8, 8.1 or 9 figure could be found in this scene"* — logged seconds before the same run dialled morphs onto the figure it claimed not to find. The ROM and the product scan were unaffected, which is why it stayed quiet: only the morph index missed out.

The generation is identified from a figure's source asset, and that asset lives on the figure's *object* — asking the node alone works in Daz Studio 6 and returns nothing in Daz Studio 4. It now walks the whole chain (object → shape → geometry, the same one the product scan has always used), and a run started by the studio also carries the character's own generation as a fallback, so a scene whose figures cannot be identified is still filed correctly instead of being dropped. When neither can answer, the message finally says what actually happened.

Runtime v68 — **Tools → Refresh assets** installs it and regenerates the character scripts.
