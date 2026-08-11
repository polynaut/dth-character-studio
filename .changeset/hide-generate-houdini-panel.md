---
# patch: one Settings panel fewer in the derived state — no capability change.
'@dth/web': patch
---

**Settings hides the "Generate Houdini Projects" panel while a Houdini installation is activated.**

With a card activated there is nothing left in it: the install folder is the card's own (already listed on it), the docs pairing is the card's whole point, and the panel had no field and no choice — it could only restate a path shown two sections above. It now appears only while the Houdini paths are yours to type (no card activated), where its manual install-folder field and the live pairing warning actually earn their place. Same rule as the derived Daz/Houdini destinations: show only the paths the studio uses, and only the choices that exist.
