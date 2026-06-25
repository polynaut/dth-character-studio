---
'@dth/web': minor
---

Character editor — Daz scene & Houdini project cards polish:

- **Houdini project cards** now match the Daz scene cards: a gender-based character
  placeholder avatar (with the Houdini logo as a bottom-left badge), a folder path
  chip under the title (shown once a project is linked), a very light orange brand
  tint, and `%CHAR%` standing in for the character folder in the per-card path chip.
- **Path chips** show `%CHAR%` (the character folder) as the prefix for relative
  paths, and match the header path chip's size.
- **Card titles** drop the file extension (e.g. `KiraDefault_G9_GP`, `Kira`).
- All cards share a **fixed width**, **top-aligned** title/chip (so they line up with
  or without a "primary" badge), and the open-in-app icon **pinned bottom-right**.
