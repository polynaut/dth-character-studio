---
'@dth/rom': minor
'@dth/web': minor
'@dth/desktop': minor
---

The two export-shape switches in **Daz scripts generated** — *Run the export with the ROM script* and *Export hair assets too* — are **gone**, and the generated Daz scripts are now always the three separate ones: **`ROM_…` builds the ROM**, **`Export_…` runs the exporter and delivers the PoseAsset CSV**, **`Export_Hair_…` exports the grooms**. One job per script, so re-exporting never costs another ROM build and there is no combination left to get wrong. `Export_…` is generated whenever an Export directory is set; `Export_Hair_…` whenever the character lists hair items. The panel that held the switches is now purely informational — it says where the scripts land and where they deliver.

**The DTH Export button is unchanged.** It runs its own hidden bulk script, which still builds and exports everything — skeleton, mesh and every hair asset — in one unattended pass, and still honours the per-scene *Export hair items* switch. Those carriers' bodies are byte-identical to before apart from their version stamp and a few comment lines.

**If you drive Daz by hand**, the ROM script no longer exports: run `ROM_…`, then `Export_…` in the same Daz session (and `Export_Hair_…` for grooms). `Export_…` still hides the character's hair items around its export, so grooms stay out of the main artifacts exactly as before. Character schema v38 drops both stored toggles and runtime v98 reshapes the scripts, so **Tools → Refresh assets** regenerates every installed script into the new layout — the combined ROM script is replaced in place, and the retired `rom-export` Content Library tile gives way to the plain ROM one.
