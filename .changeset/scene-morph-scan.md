---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Morph autocomplete now knows what each Daz scene actually wears, and a new
Tools → **Scan & index → Scan project** runs the whole lot in one go.

The morph index gained a second mode: alongside the stock-figure scan, the
studio can scan a **specific Daz scene** for the dials that index doesn't carry
— fitted clothing, hair, third-party geografts and add-ons — and files each
find under the scene it came from. The **Parameter name** autocomplete then
scopes those suggestions to the scene you have selected: two outfits in two
scenes no longer both offer their "Expand All", only the one actually in that
scene does (marked with a *this scene* badge). Morphs the base figure carries
are always offered, and re-scanning a scene replaces what it contributed, so
clothing you took off stops being suggested.

**Scan project** is the one-click way to run it: tick *base morphs*, *character
morphs* and/or *products*, press Start, and wait. The studio hands Daz Studio a
single unattended batch — the base index first, then every linked scene of
every character in the project — opening each scene once however many scans it
is due for. The standalone **Build Genesis Index** button stays for a base-only
rebuild.
