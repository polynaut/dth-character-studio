---
"@dth/web": patch
"@dth/rom": patch
---

Hold the character's frame-0 shape on the mouth and the Golden Palace / Dicktator figures through the whole ROM (runtime v105). Their block-end close-outs keyed each morph's evaluated frame-0 value as a raw key, which applied an ERC-driven mouth shape (e.g. a character's own teeth/mouth morph) a second time on every ROM frame — deforming the teeth in every exported shape — and walked dialed GP shaping back to 0 across the GP block. The close-outs now restore each morph's raw frame-0 value.
