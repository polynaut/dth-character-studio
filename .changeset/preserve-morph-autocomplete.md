---
"@dth/web": patch
---

The "Preserve morphs after ROM loading" name field now autocompletes from the
scanned morph index — the same suggestions (internal name + Daz UI name, with the
node, matched against either) the ROM editor's Morph-name column already offers.
A shared `MorphIndexProvider` now feeds both places one pre-lowercased index.
