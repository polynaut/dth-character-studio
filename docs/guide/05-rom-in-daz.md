# 5 · Build the ROM in Daz Studio

## Run the script

1. Open the character's scene in Daz Studio — each scene card on the character
   page has an open menu (**Open scene**, or the saved
   [ROM animation](#direct-export-optional-recommended) once one exists).
2. In Daz's **Content Library** pane, browse your library:
   **Scripts → DTH-Character-Studio → \<Project\> → \<Character\>**.
3. Double-click **`ROM_<Name>_G9`**.

<p align="center">
  <img width="560" alt="daz content library, character script" src="https://github.com/user-attachments/assets/88beba1f-59b7-41da-bb35-a784a58878f9" />
  <br>
  <sub><em>The character's ROM script in Daz's Content Library.</em></sub>
</p>

The script builds the entire ROM on the timeline — every section you enabled,
every morph on its exact frame. This takes a moment on a big ROM; the script
reports what it did when it finishes. Before it builds, it also quietly scans
the open scene into the studio's
[morph index](./custom-morphs.md) (and, with a DIM manifests folder set,
refreshes that scene's product scan) — the Parameter-name autocomplete stays current
through normal use, and a scan problem never fails the run.

&nbsp;

> [!NOTE]
> If anything couldn't be applied — a missing morph, a failed preset — the
> script says so in a dialog at the end, and the studio lists the exact
> failures when you switch back to it. The ROM's frame count is never
> affected: a missing morph leaves its frames empty instead of shifting
> everything after it.

&nbsp;

> [!NOTE]
> The scripts check the **open scene** first: running a character's ROM,
> export or scan script while some *other* scene is open (or an unsaved one)
> does nothing — an error dialog names the open scene and the character's
> linked scenes instead. No more silently building Kira's ROM into the wrong
> scene.

&nbsp;

## Direct export (optional, recommended)

Instead of exporting by hand, let the script drive the **DTH Exporter Plugin**
(v1.8.1+, installed in step 2):

<p align="center">
  <img width="900" alt="character page, export directory section" src="screenshots/character-export-directory.png" />
  <br>
  <sub><em>The export directory section on the character page.</em></sub>
</p>

1. Nothing to set up: every character has an **Export directory**, fixed at
   `daz-export` inside its Houdini folder (created with the character). It sits
   beside the `.hip` projects that read it and is shown read-only on the character
   page. To skip exporting, turn off **Run the export with the ROM script**
   (below) rather than looking for a way to clear the path.
2. Run the script in Daz as above — after building the ROM it now runs the
   exporter automatically and writes everything the pipeline needs into your
   export folder: **`<Name>.abc`**, **`<Name>.dth`** (extra scenes:
   `<Name>_<Scene>.*`), and the
   **PoseAsset CSV** (plus a **reference-skeleton FBX** for each **Bone scale**
   frame, under a `Reference Skeletons` subfolder — the CSV already points at
   each one). The script **deletes the scene's previous export set first** —
   an export always replaces the whole set, so files from an earlier layout
   (or a renamed hair item) never linger beside a fresh one, and Daz Studio
   4's exporter, which skips the ROM walk when its output files already
   exist, always gets the empty folder it needs. Anything else you keep in
   the folder is left alone.

After a clean ROM build — right before any export — the script also **saves
the ROM'd scene** as `<scene>_ROM.duf` into a `rom-animations/` subfolder next
to the scene file. Open it any time later to get the fully built ROM animation
back without the (slow) rebuild; each run overwrites the previous copy.

Every scene exports into its **own subfolder** of the export directory, named
after the subfolder the scene lives in inside the character folder (the primary
scene's is `primary`), so outfit variants of one character export side by side.
The exporter output **and** the PoseAsset CSV land there, and the files carry
the scene in their name too — `Kira_Summertide.abc`, not another `Kira.abc` —
so they stay distinguishable once they leave the subfolder (Houdini file
pickers, recent lists). The **primary scene** is the exception: its files keep
the plain name (`Kira.abc`, never `Kira_Primary.abc`) — the primary is the
character.

### Where the Houdini project fits

The exports deliberately live **outside** the Houdini project — a Houdini
project folder is something you back up, sync or put in version control, and
`.abc`/`.dth` files are large and fully regenerable. So the studio keeps them
on the Daz side, one `..` away from your `.hip`:

```
<character>/                ← $JOB (Set Project) — it holds BOTH sides
  daz3d/
    Kira.duf              ← your scenes, and nothing generated
  houdini/                ← $HIP — every scene of this character lives here
    Kira.hiplc            ← imports read daz-export/…
    Kira_Look.hiplc
    daz-export/           ← what the DTH Exporter wrote, for these imports
      primary/  Kira.abc  Kira.dth  Kira_pose_asset.csv
      summertide/
    render/ geo/ backup/  ← Houdini's own output, shared by both scenes
  export/                 ← the FINAL files, for Unreal
```

**`$JOB` is the character folder** — Houdini only collapses a path you pick into
a variable when it sits under `$HIP` or `$JOB`, so `$JOB` has to be the folder
*above* `houdini/`, or picking an export writes an absolute path and the project
stops being movable. **`houdini/` is the shared project folder**: every scene of
a character lives in it and shares one `$HIP`, so Houdini's own output (renders,
caches, backups) collects there instead of scattering per scene. **`export/`**
is the end of the pipeline — what Houdini generates for Unreal, yours to
organise, and not to be confused with the `daz-export` intermediate the DTH
Exporter writes inside the Houdini folder. All three are created with every new
character and can be renamed per project in **Settings → Project**.

There is no plumbing between the two sides: from a `.hip` in the houdini folder
the exports are a subfolder away, and ticking Houdini's **Make path relative to
current directory** in the file picker gives you the portable `$HIP/daz-export/…`
form — the same spelling the studio generates, so a path you pick by hand and
one it wrote read identically inside the same node. **Generate project** bakes
`$JOB` in for you, so a generated scene needs no Set Project at all; `$HIP`
never needs setting up either way, since Houdini derives it from wherever the
`.hip` sits.

> [!NOTE]
> **Upgrading from an older version?** Every layout change below carries itself
> out on the next save, and **Tools → Refresh assets** does every character in
> one go.
>
> - **The export directory has moved twice.** A character's exports follow to
>   the current location and the emptied old folder goes; only folders the
>   studio wrote are moved, anything else you kept there stays put. A Houdini
>   project generated before a move still names the old one, so its imports
>   report as broken on the character page — **Utils → Make paths portable**
>   rebuilds them from the current export root, and only ever writes a path
>   whose file it can actually see.
> - **The `houdini-project` subfolder is gone.** Before v0.68 it was meant to be
>   the Set Project target, a job it could never do (Set Project sets `$JOB`,
>   not `$HIP`), so it stayed empty while the output landed beside the scenes.
>   It is removed **only when empty**; one holding files is left alone and named
>   in Refresh assets, for you to clear yourself.
> - **`dth-exports` shortcut links** (NTFS junctions) beside Houdini projects
>   are removed, reported as *removed N leftover dth-exports junction(s)*. Real
>   export folders are never touched.
> - **The saved-ROM folder** was hidden and called `.ROM_Animations`; it holds
>   scenes you're meant to open, so it is the plain visible `rom-animations` now
>   and an existing one is renamed for you.

### Reference-skeleton paths — `$HIP` by default

Every **Bone scale** frame gets a reference-skeleton FBX, and the PoseAsset CSV
has to point Houdini at it. Those paths are written relative to **`$HIP`** — the
folder the `.hip` itself sits in — which now reaches the exports without leaving
the project folder:

```
$HIP/daz-export/primary/Kira_frame_432.fbx
```

so the project keeps resolving after you move, rename or copy the character
tree — including onto another machine. `$HIP` has a property no other anchor
has: Houdini derives it from where the file *is*, so it can't go stale — a
project whose `$JOB` points at another character still resolves its own imports.
**Settings → Project → Houdini path style** controls this: `hip` (the default)
writes the relative paths, `absolute` forces absolute ones.

Two layouts fall back to **`$JOB`**, the character folder, which encodes no
depth and so is right for every project at once: linked projects sitting in
**different folders** (there is no single `$HIP` to name), and exports sitting
**beside** the houdini folder rather than under it — the arrangement before
v0.68. Both still resolve, so neither is flagged; **Utils → Make paths
portable** shortens the older form to today's when you ask.

What still falls back to **absolute** paths: no linked project yet, a `.hip`
hand-linked somewhere in your own tree (where `$JOB` is whatever you set it to),
or an export root outside the character folder. Generate a project — or link one
in the character's houdini folder — and save again to switch it over.

**Old folders clean themselves up**: the studio remembers which export folders
the current layout uses, and when a scene's subfolder is renamed or moved, the
previous run's folders are removed from the export directory on the next save.

Two switches (in the **Daz scripts generated** box on the character page)
tune this:

- **Run the export with the ROM script** — on (the default), the one
  `ROM_<Name>_G9.dsa` builds the ROM and runs the export. Off, the export
  splits into its own **`Export_<Name>_G9.dsa`** beside the ROM script — run it
  after the ROM script in the same Daz session; handy for re-exporting
  (another scene, or after a failed export) without rebuilding the ROM.
- **Export hair assets too** — right after the main export, each of the open
  scene's [hair items](./advanced.md#hair-items--per-scene-kept-out-of-the-export)
  is exported on its own (`<Name>_Hair_<item>_grooms.abc` — the same per-item
  pass as the standalone `Export_Hair_…` script), into the same export folder.
  Works in both modes: with the combined ROM script and with the split
  `Export_…` script. Scenes without a hair list skip the pass.

## Or have the studio run it — DTH Export

Everything above is the round trip done by hand, one scene at a time. The
**DTH Export** button in the character header does the whole thing unattended —
every scene you pick built and exported in Daz, the Houdini projects that read
those exports run straight after, and the result queued for re-import into
Unreal. It has its own page: **[The DTH Export batch](./dth-export.md)**.


&nbsp;

> [!NOTE]
> **Running a scene with per-scene overrides?** The one `ROM_<Name>_G9.dsa` embeds
> every scene's [overrides](./advanced.md#per-scene-overrides--edit-to-override) and
> applies the right ones for whichever scene is **open in Daz** — so open the right
> scene before running it. A scene with **ROM** overrides also has its own
> PoseAsset CSV to import in Houdini — see
> [What Save generates](./advanced.md#what-save-generates).

&nbsp;

> [!NOTE]
> Prefer exporting by hand? Turn off *Run the export with the ROM script* — the
> ROM is still built in Daz, and you export with the DTH Exporter as described
> in the DazToHue docs; the PoseAsset CSV is waiting in
> [the studio's own folder for that character](./06-into-houdini.md#what-the-studio-gives-you).

&nbsp;

Two bundled scripts handle scenes the pipeline can't take as they are — a
geograft hidden under a Golden Palace shell, and an old scene that is nothing
but a baked ROM animation: **[Bundled fix-it scripts](./bundled-scripts.md)**.

&nbsp;

[← Your first character](./04-first-character.md) · [Next: The DTH Export batch →](./dth-export.md)
