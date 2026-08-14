# Domain model — DazToHue, ROMs, and what this app actually produces

DTH Character Studio is a declarative front-end for the **DazToHue** pipeline
(Daz Studio → Houdini → Unreal). From ONE character definition it generates **both
sides** of a Range of Motion (ROM): the Daz Studio apply-script (`.dsa`) that keys
the ROM onto a timeline, and the Houdini **PoseAsset import CSV** that tells the
DazToHue HDA what each frame means. Keeping those two artifacts frame-aligned **is
the product**.

Split in two — whole-read the one your task lives in, grep the other:

- **`domain-rom.md`** — vocabulary, THE core invariant (frame numbers are never
  stored), generated artifacts per character, character export zips
  (`.dcsc.zip`), runtime ownership, interrupting a run, PoseAsset CSV eras &
  templates, hard rules.
- **`domain-exporter.md`** — the DTH exporter contract (measured, not
  documented upstream). The single biggest reference in the repo; everything
  about what the exporter actually does with scenes, morphs, and files.
