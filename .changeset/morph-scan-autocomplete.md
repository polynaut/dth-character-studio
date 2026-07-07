---
'@dth/rom': minor
'@dth/web': minor
'@dth/desktop': minor
---

Morph scanner scripts + Morph-name autocomplete. The runtime install (v18) now
also drops visible `Scan_Morphs_G9/G8.1/G8/G3` scripts into the DTH Character
Studio scripts root: run one on a freshly created (unrenamed) figure in Daz and
it scans every morph on the figure and all its descendants — geografts like
Golden Palace / Dicktator, nipples/navel add-ons, fitted clothing — into a
per-generation JSON index in the studio's app folder. Once an index exists, the
ROM editor's Morph name fields autocomplete against it: search by the Daz UI
label or the internal name (each suggestion tags which one matched and the node
the morph lives on), and picking a suggestion fills in both the internal morph
name and the correct node.
