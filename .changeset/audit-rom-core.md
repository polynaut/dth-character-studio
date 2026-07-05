---
'@dth/rom': minor
'@dth/web': minor
---

**Fix a frame-alignment off-by-one + harden generated scripts against injection** (from a full app audit).

- **Base-less characters no longer desync from Daz.** A character with no preset ROM block (FBM-only, or custom JCM groups) started its first custom frame at 1 in the PoseAsset CSV / exporter reference frames, while Daz built it at 0 — a one-frame misalignment for the whole custom sequence (the exact class of bug the "frames are computed, never stored" invariant exists to prevent). Removed the `Math.max(…, 0)` clamp in all three consumers. Runtime bumped to **v15** so **Tools → Refresh assets** regenerates affected characters' scripts/CSVs.
- **Daz Script injection closed.** A character `name` containing a newline could break out of the generated `.dsa`'s `//` comment header into executable DzScript — reachable by opening/generating a shared malicious definition. Control chars (CR/LF/U+2028/U+2029) are now stripped from names in comment headers.
- **CSV injection closed.** Group labels and reference-FBX paths are stripped of commas/newlines so they can't inject extra columns/rows into the Houdini PoseAsset CSV.
