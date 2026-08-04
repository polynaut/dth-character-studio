# 6 · Into Houdini

The Houdini side of the pipeline is the **DazToHue HDA** — its own documentation
covers the network in depth; this page is just the hand-off.

## What the studio gives you

- The **Houdini assets** (otls, presets, toolbar) were merged into your Houdini
  documents folder during [setup](./02-setup.md).
- Your character's **PoseAsset CSV** — delivered into each scene's export
  folder under the same scene-suffixed base name as everything beside it
  (`<Name>_<Scene>_pose_asset.csv`; the primary scene's is plain
  `<Name>_pose_asset.csv`). Without direct export it's in the character's
  folder in the project (as `<Name>_pose_asset.csv`).
- The exporter's **`<Name>.abc`** / **`<Name>.dth`** next to it.
- For any **[Bone scale](./04-first-character.md)** frames, a
  **reference-skeleton FBX** each — the CSV already points at them, nothing to
  wire up.

## Hook it up

In your DazToHue network, point the **PoseAsset** import at the character's
`_pose_asset.csv` and the geometry import at the exported `.abc`/`.dth`.

Wire the network once — from then on the studio can run it for you: pick the
project in [**DTH Export**](./05-rom-in-daz.md#batch-export--dth-export) and it
opens Houdini, runs the DazToHue exports for the scenes in scope, and closes
Houdini again when they're done — with **Skip Daz — use last exports** for a
Houdini-only pass.

> [!TIP]
> Use Houdini's **File → Set Project** on the character's
> **[`houdini-project` folder](./05-rom-in-daz.md#where-the-houdini-project-fits)**
> so `$JOB` means one thing per character. The exports live on the Daz side,
> one `..` up from the scene: in the file picker, navigate to
> `../daz3d/dth-exports/` and tick **Make path relative to current directory**
> — the import reads `$HIP/../daz3d/dth-exports/primary/<Name>.dth` and the
> `.hip` stays portable.

## Generate the Houdini project automatically

The character page's **Houdini projects → Generate project** creates the whole
project for you: a new scene named after the character (editable in the dialog,
which refuses a name that already exists), saved in the houdini folder **next
to** the `houdini-project` folder it Set-Projects into, with **Set Project
already baked in** and the **DazToHue network ready** — open it and import.
The project folder is shared: generate a second or third project and they all
open with the same `$JOB`.

<p align="center">
  <img width="900" alt="the Generate Houdini project dialog" src="screenshots/houdini-generate-dialog.png" />
  <br>
  <sub><em>Generate project: one name, prefilled — the studio builds the scene, Set Project and the DazToHue network.</em></sub>
</p>

```
houdini/
├─ PlaygroundAssets_Ita.hiplc   ← the generated scene (imports ../daz3d/dth-exports/…)
└─ houdini-project/             ← $JOB (Set Project), shared by every project
```

Removing a **generated** project asks about its files: with **Keep houdini
files** on it is only unlinked; turned off, its scene file is deleted too. The
shared `houdini-project` folder always stays — the character's other projects
open with it, and it holds no exports. Hand-linked projects are always
unlink-only.

One one-time Settings entry powers it: the **Houdini installation folder**
(Houdini's own install directory — its `bin\hython.exe` builds the scene
headlessly). Its version must have a **matching Houdini documents folder**
configured (`Houdini 22.0.x` ↔ `…\Documents\houdini22.0`) so the DazToHue
assets load — Settings warns live when the pair doesn't match. The DazToHue
network is created from your **installed DazToHue HDA** at generate time, so
it's always the current plugin version — no template scene that could rot
across Houdini or DazToHue updates. If the HDA isn't installed the project
still generates (empty scene, Set Project baked) and the studio tells you to
add the network from the DazToHue shelf.

## `$DAZ3D_LIB` — your Daz library, as a variable

With both **My DAZ 3D Library** and the **Houdini documents folder** set in
Settings, the studio maintains a `DAZ3D_LIB` variable in each configured
Houdini version's `houdini.env`, pointing at your Daz library. Reference any
library file as `$DAZ3D_LIB/…` (textures, geometry, presets) instead of
hardcoding machine paths — together with `$JOB` imports, the whole project
stays moveable. It updates automatically when the library path changes in
Settings, and **Tools → Refresh assets** (re)wires it too — restart Houdini to
pick up changes.

> [!NOTE]
> In the export folder, every scene's delivered CSV is scene-suffixed — always
> point the PoseAsset import at the CSV sitting in the scene subfolder you
> exported. (In the character's folder, a scene whose
> [per-scene ROM overrides](./advanced.md#rom-overrides) change the **frame
> layout** additionally has its own source CSV — see
> [What Save generates](./advanced.md#what-save-generates).)

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="houdini, daztohue hda poseasset import" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>Point the DazToHue HDA's PoseAsset import at the character's CSV.</em></sub>
</p>
-->

&nbsp;

> [!NOTE]
> That's the whole trick: the CSV comes from the **same definition** as the Daz
> script you just ran, so every frame Houdini expects is exactly where Daz put
> it. Change the character later, Save, re-run, re-export — both sides move
> together.

&nbsp;

From here, continue with the [DazToHue](https://docs.google.com/document/d/1LYXl90FCXPX5KVpru4_T_hCY_XLr9vinR_9zYENPHUw/edit?tab=t.0)
documentation for the Houdini → Unreal leg.

---

**That's it — first character, first ROM, both sides in sync.** From the second
character on, the loop is just: *Add character → Fill from character → adjust
morphs → Save → run the script.*

[← Build the ROM in Daz](./05-rom-in-daz.md) · [Guide overview](./README.md)
