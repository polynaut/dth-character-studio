---
"@dth/web": patch
"@dth/ui": patch
"@dth/rom": patch
---

Opportunistic cleanups: the Deduplicate tool's shared-file groups gain the "Accept" button its help text always promised — marking a group as legitimately shared now actually persists (it stopped appearing on the next scan) instead of being a dead code path. The Settings route's release/exporter pickers and the network-drives section move into `components/settings/`, and the UI kit's public surface drops exports nothing consumes (the unused `Slider` primitive, plus internal-only helpers). Inside the generation core, the thrice-copied groom "hide-tree" DzScript snippet is extracted into one name-parameterised builder (byte-identical output, pinned by the existing tests). Two more Playwright smoke flows cover the character editor's inline rename end-to-end.
