---
'@dth/rom': patch
'@dth/web': patch
---

DTH Export runs no longer pause at the start of each step (runtime v88). The generated Daz scripts used to sleep ~1 second after the Runner's scene load and again between the ROM build and the exporter — up to ~2 seconds of artificial wait per scene, added as a precaution rather than against any measured failure. The Runner's job contract already has it drain Daz's event loop after opening a scene (docs/exporter-plugin-job-file.md), so the pauses bought nothing. Save the character (or Tools → Refresh assets) to regenerate scripts already on disk; older scripts keep the old pauses until regenerated.
