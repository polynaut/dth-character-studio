---
'@dth/web': patch
---

A Houdini project holding two DazToHue networks in ONE subnet now reports both
of them, not one twice. The scan resolved a node's network by its **parent** and
took the first `daztohueimport` child it found there — right for a subnet with
one network, wrong for `/obj/DazToHue` holding two side by side, where both
export nodes answered with the first import's name and the dedupe collapsed
them. The DTH Export dialog showed such a project as writing a single export
set; the run list showed both all along, because it names nodes by their own
network box.

Resolution is per NODE now, walking its inputs upstream to its own import node,
with the parent's sole import as a fallback and an honest "cannot tell" when a
node is unwired in an ambiguous parent. The same correction lands on the
PoseAsset CSV pairing (both CSVs in such a project were checked against the
first network's `.dth`) and on the run's own node targeting.

Stored scans are re-earned automatically: `SCAN_ANSWER_VERSION` goes to 9,
because the old answer is a legitimate value — "this project writes one set" —
and would otherwise be served forever.
