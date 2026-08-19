---
'@dth/rom': minor
'@dth/web': minor
---

Daz scene cards get a **Scene utils drawer** — the 🔧 in each card's corner cluster, the per-scene twin of the Houdini cards' Utils drawer. Its General tab holds two scene-scoped scans and one export switch:

- **Scan products of this scene** / **Scan morphs of this scene** — the two scene passes of Tools → Scan project, narrowed to this one scene: Daz opens it once and runs just the pass you asked for (the same Runner handoff, abortable while it waits for pickup). The products button explains itself when the project's Daz Products feature is off or no DIM manifests folder is set.
- **Export hair items** — a per-scene switch on the DTH Export flow's per-item hair pass (schema v37 `sceneOverrides[].exportHair`, runtime v96): **on by default for the primary scene, off for extra scenes**, and stored only while your choice differs from that default. The generated export block now embeds a per-scene gate the runtime resolves for the open scene, so one bulk run exports hair exactly where the switch says. Only the export pass is gated — a scene's hair items stay hidden from the main export either way, and the standalone `Export_Hair_…` script keeps working for every scene as the manual escape hatch.

Behavior note: DTH Export batches used to export **every** scene's hair items; with the new default, an extra scene's hair now exports only once its switch is flipped on.
