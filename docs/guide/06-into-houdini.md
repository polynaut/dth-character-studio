# 6 · Into Houdini

The Houdini side of the pipeline is the **DazToHue HDA** — its own documentation
covers the network in depth; this page is just the hand-off.

## What the studio gives you

- The **Houdini assets** (otls, presets, toolbar) were merged into your Houdini
  documents folder during [setup](./02-setup.md).
- Your character's **`<Name>_pose_asset.csv`** — in the export folder if you used
  direct export, otherwise in the character's folder in the project.
- The exporter's **`<Name>.abc`** / **`<Name>.dth`** next to it.
- For any **[Bone scale](./04-first-character.md)** frames, a **reference-skeleton
  FBX** each (in a `Reference Skeletons` subfolder) — the PoseAsset CSV already
  points at them by absolute path, so there's nothing extra to wire up.

## Hook it up

In your DazToHue network, point the **PoseAsset** import at the character's
`_pose_asset.csv` and the geometry import at the exported `.abc`/`.dth`.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="houdini, daztohue hda poseasset import" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>Point the DazToHue HDA's PoseAsset import at the character's CSV.</em></sub>
</p>
-->

&nbsp;

> [!NOTE]
> That's the whole trick: the CSV was generated from the **same definition** as the
> Daz script you just ran, so every frame Houdini expects is exactly where Daz put
> it. Change the character in the studio later, Save, re-run the script, re-export —
> both sides move together.

&nbsp;

From here, continue with the [DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue)
documentation for the Houdini → Unreal leg.

---

**That's it — first character, first ROM, both sides in sync.** From the second
character on, the loop is just: *Add character → prefill from the first → adjust
morphs → Save → run the script.*

[← Build the ROM in Daz](./05-rom-in-daz.md) · [Guide overview](./README.md)
