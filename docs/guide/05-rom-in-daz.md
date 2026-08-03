# 5 · Build the ROM in Daz Studio

## Run the script

1. Open the character's scene in Daz Studio — the scene chip on the character page
   has an **Open in Daz** button.
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
reports what it did when it finishes.

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
   `dth-exports` inside its Daz folder (created with the character). It sits
   beside the scenes that produce it and is shown read-only on the character
   page. To skip exporting, turn off **Run the export with the ROM script**
   (below) rather than looking for a way to clear the path.
2. Run the script in Daz as above — after building the ROM it now runs the
   exporter automatically and writes everything the pipeline needs into your
   export folder: **`<Name>.abc`**, **`<Name>.dth`** (extra scenes:
   `<Name>_<Scene>.*`), and the
   **PoseAsset CSV** (plus a **reference-skeleton FBX** for each **Bone scale**
   frame, under a `Reference Skeletons` subfolder — the CSV already points at
   each one).

After a clean ROM build — right before any export — the script also **saves
the ROM'd scene** as `<scene>_ROM.duf` into a `rom-animations/` subfolder next
to the scene file. Open it any time later to get the fully built ROM animation
back without the (slow) rebuild; each run overwrites the previous copy.

&nbsp;

> [!NOTE]
> This folder used to be hidden and called `.ROM_Animations`. It holds scenes
> you're meant to open, so it's a normal visible folder now — any existing one
> is renamed for you the next time the character is saved.

Every scene exports into its **own subfolder** of the export directory, named
after the subfolder the scene lives in inside the character folder (the
primary scene's is `primary`; extra scenes get theirs when they're added) — so
outfit/scene variants of one character always export side by side. The
exporter output **and** the PoseAsset CSV land in that subfolder, and the
export files carry the scene in their name too — `Kira_Summertide.abc` for the
`summertide` scene (capitalized), not another `Kira.abc` — so files from
different scenes stay distinguishable after they leave their subfolder
(Houdini file pickers, recent lists). The **primary scene** is the one
exception: it exports into its subfolder like every scene, but its files keep
the plain name (`Kira.abc`, never `Kira_Primary.abc`) — the primary is the
character.

### Where the Houdini project fits

The exports deliberately live **outside** the Houdini project — a Houdini
project folder is something you back up, sync or put in version control, and
`.abc`/`.dth` files are large and fully regenerable. So the studio keeps them
on the Daz side and gives Houdini a **shortcut** instead:

```
<character>/
  daz3d/
    Kira.duf
    dth-exports/          ← the real files
      primary/  Kira.abc  Kira.dth  Kira_pose_asset.csv
      summertide/
  houdini/
    Kira.hiplc
    houdini-project/      ← $JOB (File → Set Project)
      dth-exports  ──►  ../../daz3d/dth-exports
  export/                 ← the FINAL files, for Unreal
```

Those three folders are created with every new character. The last one,
**`export/`**, is the end of the pipeline — what Houdini generates for Unreal
goes there, and it's yours to organise. Don't confuse it with `dth-exports`
inside the Daz folder, which holds the Daz→Houdini intermediate the DTH
Exporter writes. All three names can be changed per project in
**Settings → Project**.

That last entry is a **junction**: a folder-shaped shortcut Windows resolves
transparently. Houdini's file picker opens at `$JOB`, so `dth-exports/` is
right there — one click instead of climbing two levels into the Daz folder —
and imports read `$JOB/dth-exports/primary/Kira.dth`
([Into Houdini](./06-into-houdini.md)).

**Generate project** creates it, along with the `houdini-project` folder
itself. That folder is shared: the first generated project creates it, every
later one reuses it, so all of a character's projects open with the same
`$JOB`. A **second** `dth-exports` shortcut lives next to the `.hip` itself,
so `$HIP/dth-exports/…` resolves — that's what the reference-skeleton paths
below use. The studio checks and repairs that one **every time it generates**,
so a deleted or stale shortcut heals on the next save.

### Reference-skeleton paths — `$HIP` by default

Every **Bone scale** frame gets a reference-skeleton FBX, and the PoseAsset CSV
has to point Houdini at it. Those paths are written relative to **`$HIP`** (the
folder holding the `.hip`):

```
$HIP/dth-exports/primary/Kira_frame_432.fbx
```

so the project keeps resolving after you move, rename or copy the character
tree — including onto another machine. Both this and whether the junctions are
created at all are **per-project settings**: the first **Generate project** in
a project asks right in the dialog, and **Settings → Project** changes them
anytime later.

A character with **no Houdini project inside its folder** has no `$HIP` to be
relative to, so its reference paths are always absolute — regardless of the
setting. The same fallback protects a character whose shortcut can't be created
at all (an export folder on a network drive, say): the studio only writes
`$HIP` paths it has verified the shortcut for. Generate a project (or hand-link
one inside the character folder) and save again to switch it over.

### The dth-exports junction & source control

The junction is a convenience, not plumbing — the export pipeline itself never
goes through it, and imports work with the real path just as well. But tools
that scan your project folder can trip over reparse points: **Perforce** and
some backup clients follow them (pulling the whole export tree into the depot
view) or delete them. You have three outs, from lightest to heaviest:

**1. Ignore it.** Keep the convenience, hide it from the tool.

For **Git**, add to the project's `.gitignore`:

```gitignore
# DTH Character Studio: junctions into the export folder (recreated on save)
dth-exports/
```

For **Perforce**, add to the file your `P4IGNORE` variable points at
(e.g. `.p4ignore` in the workspace root — `p4 set P4IGNORE=.p4ignore` once, if
it isn't set):

```text
# DTH Character Studio: junctions into the export folder (recreated on save)
dth-exports/
```

> [!WARNING]
> Perforce ignores only apply to files being **added** — a junction already
> added to the depot stays tracked. Ignore it before the first `p4 add`, or
> remove it from the depot once.

**2. Switch junctions off for the project.** **Settings → Project → Create
dth-exports shortcuts** (also offered in the first Generate-project dialog).
No junctions are created or repaired from then on; existing ones can be
deleted freely. `$HIP` paths resolve *through* the junction, so this forces
absolute reference paths — the trade-off is a project tree that's fully
source-control-inert.

**3. Delete the link ad hoc.** With junctions ON, a deleted link simply comes
back on the next save — fine for a one-off scan, wrong as a permanent fix.

**Old folders clean themselves up**: the studio remembers which export folders
the current layout uses, and when a scene's subfolder is renamed or moved, the
previous run's folders are removed from the export directory on the next save.

&nbsp;

> [!NOTE]
> **Upgrading from an older version?** Characters that had a hand-picked export
> directory move to the new one automatically the next time they're saved — and
> their already-exported files come along, so nothing is left behind (**Tools →
> Refresh assets** migrates every character in one go). Only the folders the
> studio wrote are moved; anything else you kept in that directory stays put.

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

## Batch export — DTH Export

Running the script yourself (above) is one way — the **DTH Export** button in
the character header does the whole thing for you, Houdini included:

<p align="center">
  <img width="900" alt="the DTH Export dialog — Daz scenes and Houdini projects, each with their Mode" src="screenshots/dth-export-dialog.png" />
  <br>
  <sub><em>Pick the Daz scenes and their run, then the Houdini projects that carry on with the results.</em></sub>
</p>

**Daz scenes** lists every linked scene; the ones with outstanding work come
pre-checked (the wand picks a single scene, a double-click selects all). The
**Mode** below the list decides what their run does:

- **ROM + Export** — the full run: a fresh ROM, the saved ROM animation scene,
  and the export of everything (skeletal mesh and hair).
- **ROM only** — build the ROM and save the `rom-animations` scene (above),
  skipping the export entirely.
- **Export only** — export the saved ROM animations as they stand, hair
  included, without rebuilding them. This is the one for a ROM you tweaked by
  hand in Daz: it pre-selects exactly the scenes whose ROM animation is newer
  than their last export, and skips scenes that have no ROM animation yet.
- **Skip Daz — use last exports** — nothing runs in Daz at all: the Houdini
  projects below work off each selected scene's **last Daz export** as it
  stands on disk. For when the Daz side hasn't changed and only Houdini needs
  a fresh pass. Scenes that never delivered an export are kept out of the run
  (there is nothing to rely on).

**Houdini projects** lists the character's linked projects the same way — the
ones that carry on with the results once the Daz side is done. They come
pre-selected whenever scenes are, so a plain **Start** does the whole round
trip; untick them and the run ends with Daz. Their own **Mode**:

- **Open only** — just open the project, run nothing (needs exactly one
  project selected — picking a second flips to the export run).
- **Export selected scenes** — the default: run the projects' DazToHue
  exports for the checked Daz scenes.
- **Export all** — run them for every linked scene, whatever is checked.

Several selected projects run **one after another**: each opens, exports,
reports — then the next starts.

Press **Start**: the batch is handed to Daz Studio, where the bundled
[**Runner plugin**](./02-setup.md#install-the-dth-character-studio-runner-plugin)
works through it unattended — every scene gets its full ROM build, export and
delivered CSV, exactly as if you had run the scripts by hand. A closed Daz is
started; a running one picks the batch up by itself. While the batch is still
waiting the button reads **Abort**; once Daz starts working it shows live
progress with the elapsed time, and the studio reports the outcome — including
any per-scene failures and the total time — when the batch finishes. The
finish report stays on screen until you close it (or start a new run).

The dialog refuses to start while the Runner plugin is missing or older than
the one bundled with the app — the notice links straight to Settings to update
it first. (A skip-Daz run doesn't need the Runner at all.)

### Carry on into Houdini

With Houdini projects selected in an exporting mode, the round trip's last
manual step is gone — each project **runs its own DazToHue exports** for the
scenes in scope, right after the Daz batch delivers (or immediately, with
**Skip Daz**).

What happens:

1. Daz finishes the batch and the studio reports it, as always.
2. Houdini opens the project — visibly, so you can watch it work. The button
   reads **Houdini opening…** while the scene loads (a big project takes a
   while; nothing is wrong), then **Houdini 1/3** as nodes finish.
3. Only the networks importing **the scenes you ticked** export. A project
   holding networks for other scenes — or other characters — is left alone.
4. The studio reports the outcome: *"Houdini export finished — 2 exported,
   1 skipped."* Houdini stays open with the project ready to work in.

Two things it deliberately won't do:

- **Overwrite an export directory you configured.** A node with one set exports
  where you told it to; only a blank one is filled in from the run.
- **Save the project.** Nothing about your `.hip` changes on disk — any
  parameter it touches is put back afterwards.

If the DazToHue pre-flight check reports problems, the studio answers its
*"Continue anyway?"* prompt for you and **keeps the message**, so those
problems reach the report instead of vanishing behind an unattended dialog.
Closing Houdini mid-run ends the watch with a notice — the exports that already
finished are on disk.

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
> in the DazToHue docs; the PoseAsset CSV is waiting in the character's folder.

&nbsp;

---

## Geografts under a Golden Palace / Dicktator shell

Fit a **nipple** or **navel** geograft to a figure that already wears **Golden
Palace** or **Dicktator**, and the genital shell covers it: you get shell
material where the graft should be. It is not a fitting problem. A geoshell
carries one visibility switch per **surface** of the figure it shells, and a
newly fitted graft adds *its* surfaces to that list **switched on** — so the
shell now draws over the graft.

Fixing it by hand means finding each of those rows (`stx_…_Body` and friends) in
the shell's *Parameters ▸ Shell ▸ Visibility ▸ Surfaces* list and switching it
off — on **every** GP/DK shell (Golden Palace has two), in **every** scene.

The bundled **`Fix_Graft_Shell_Surfaces`** script does it in one run. Open the
scene, then run it from **Scripts › DTH-Character-Studio** in the Content
Library. Nothing to select. It reports what it switched off, and it is safe to
re-run — only rows that are still on get written.

What it will **not** touch:

- **Other geoshells.** Skin overlays, tattoo and nail shells keep their graft
  surfaces on — a body tattoo *should* cover the nipple graft.
- **The shell's own graft.** Golden Palace's own surfaces stay visible on the
  Golden Palace shells; only the *other* grafts' rows go off.
- **The figure's own surfaces** (`Body`, `Head`, `Legs`…), which the shell
  already controls however its product intends.

A scene without a GP/DK shell is a no-op. If the script cannot tell which graft
a shell belongs to — a renamed graft node, say — it reports that shell as
**skipped** instead of guessing, and you fix that one by hand.

&nbsp;

[← Your first character](./04-first-character.md) · [Next: Into Houdini →](./06-into-houdini.md)
