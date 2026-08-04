---
'@dth/web': minor
'@dth/desktop': minor
'@dth/rom': minor
---

**The export-junction feature is gone** — generated reference paths are plain
relative now. PoseAsset CSVs (and Generate-project prefills) write
`$HIP/../<daz folder>/dth-exports/…` whenever every linked `.hip` sits in the
character's houdini folder, absolute otherwise; projects stay fully moveable,
and no reparse points ever land in your tree again (Perforce, gitignore and
backup tooling see plain folders). The per-project **Create dth-exports
shortcuts** toggle and the first-Generate-project intro are removed — the
**Houdini path style** choice (relative / absolute) stays in Settings →
Project. Every generation now sweeps leftover junctions from earlier versions
(strictly reparse-point-safe — a real folder is never touched), and Tools →
Refresh assets reports what it removed.
