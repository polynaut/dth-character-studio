# 5 · Build the ROM in Daz Studio

## Run the script

1. Open the character's scene in Daz Studio — the scene chip on the character page
   has an **Open in Daz** button.
2. In Daz's **Content Library** pane, browse your library:
   **Scripts → DTH-Character-Studio → \<Project\> → \<Character\>**.
3. Double-click **`<Name>_G9`**.

<!-- screenshot: daz content library, character script -->

The script builds the entire ROM on the timeline — every section you enabled,
every morph on its exact frame. Depending on the ROM's size this takes a moment;
the script reports what it did when it finishes.

## Direct export (optional, recommended)

Instead of exporting by hand, let the script drive the **DTH Exporter Plugin**
(v1.8.1+, installed in step 2):

<!-- screenshot: character page, export directory section -->

1. On the character page, set an **Export directory** and Save.
2. Run the script in Daz as above — after building the ROM it now runs the
   exporter automatically and writes everything the pipeline needs into your
   export folder: **`<Name>.abc`**, **`<Name>.dth`**, and the **PoseAsset CSV**.

Two switches tune this:

- **Generate subfolders based on Daz scenes** — nests each export under a folder
  named after the currently open Daz scene, so outfit/scene variants of one
  character export side by side.
- **Run the export with the ROM script** — on (the default): one combined script
  does both. Off: the script splits into **`ROM_<Name>_G9.dsa`** and
  **`Export_<Name>_G9.dsa`** — run the Export script after the ROM script; handy
  for re-exporting (another scene, or after a hiccup) without rebuilding the ROM.

No export directory set? The ROM is still built in Daz — export manually with the
DTH Exporter as described in the DazToHue docs; the PoseAsset CSV is waiting in
the character's folder.

[← Your first character](./04-first-character.md) · [Next: Into Houdini →](./06-into-houdini.md)
