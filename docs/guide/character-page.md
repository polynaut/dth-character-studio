# Deep dive: The character page

[Your first character](./04-first-character.md) walks the ROM-building flow; this
page is the **full tour** of everything else on the character detail view, top to
bottom.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="character page, header and identity section" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The character page's header: avatar, name, path chip, Save/Discard.</em></sub>
</p>
-->

## The header

- **Avatar** — click the portrait to open the **Character image** dialog: pick one
  of the linked Daz scenes' thumbnails, drop an image file, or paste an image URL.
  Applied **immediately** (no Save needed); stored in the project's hidden
  `.dcsmeta/images` folder, so it travels with the project.
- **Name** — click it to rename the character. The character folder, notes and
  generated scripts follow the new name (the old `ROM_…` script is cleaned up).
- **Subtitle** — the generation, the **skinning** the ROM targets (DQS or Linear,
  derived from the chosen preset assets), and the count of custom ROM frames.
- **Path chip** — where the definition lives on disk. Click **copies** the path,
  **Alt+click reveals it in Explorer** — this works on every path chip in the app.
- **Save / Discard** — the page edits a **draft**: nothing touches disk until
  **Save**, which writes the definition *and* regenerates the Daz script + PoseAsset
  CSV. **Discard** reverts to the last save. Leaving with unsaved edits asks first.
  (Holding **Ctrl** turns a settled Save button into **Re-save** — force-rewrites
  the files when nothing changed.)

## The tabs

- **Character** — everything documented on this page.
- **Products** — only when the project enables Daz Products; see
  [Daz product scanning](./product-scanning.md).
- **Notes** — freeform **markdown notes** for this character: background, art
  direction, references. The rendered view is the default; hover and hit the pencil
  to edit, **drop images or files straight into the editor**, and it autosaves.
  Stored as `<Name>.notes.md` next to the definition (media in `.dcsmeta/media`),
  so notes are part of your project backup. The project page has the same tab for
  project-wide notes.

## The run report

After a ROM run in Daz had problems (a missing morph, a failed preset), a **report
banner** appears the moment you switch back to the studio: every failed frame with
its reason. Clicking an entry **jumps to and highlights the pose row** (failed rows
are also tinted red in the tables). **Dismiss** clears it; a clean run clears it
automatically. It stays visible from every tab.

## Genesis, gender and the experimental tag

The **Genesis** and **Gender** selects can be changed after creation — gender is
what decides the GEN section's product (Golden Palace vs Dicktator, see
[the GEN box](./04-first-character.md)).

An orange **experimental** tag next to Genesis means this *configuration's*
PoseAsset CSV falls outside the validated layouts (G9 · DQS · JCM+FAC presets on
DTH 2.x, and G8.1 · DQS · JCM+FAC on the 1.9.x pipeline) and uses the custom-only
layout instead, which hasn't been byte-validated in Houdini. The **Daz-side ROM
works either way** — the tag is about the Houdini import.

The **Genesis 9 specific** box (UE5 tear UV, FACS/Flexion strength) is covered in
[Advanced character options](./advanced.md).

## Linked files

- **Daz scenes** — the character's scene, plus any number of extra scenes
  (outfit/look variants): **drop a `.duf`** on the card to add one; a dialog asks
  whether to **copy it into the character's folder** (optionally under a subfolder)
  or leave it where it is. The original scene can't be unlinked; extras can be
  removed. **Scenes subfolder** moves the whole scenes folder. Each scene has
  **Open in Daz** — if Daz Studio is already running with a scene loaded, the
  studio walks you through closing it and the button flips to **Open now** once
  Daz has quit.
- **Houdini projects** — drop `.hip`/`.hiplc` files to link the character's Houdini
  project(s). Click one to open it in Houdini, **Alt+click** to reveal its folder.

## Daz scripts generated

Shows where the generated `ROM_<Name>_<Genesis>.dsa` (and, with split export, the
`Export_…` script) install on Save:
`<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/`. Needs
"My DAZ 3D Library" set in [Settings](./02-setup.md); the folder is created the
first time a script is generated.

## Export directory

The direct-export flow is covered in [Build the ROM in Daz](./05-rom-in-daz.md).
On the page itself: **Choose folder…** opens the picker (starting at the
character's Houdini folder as guidance), **Clear** turns direct export off again,
and an amber warning appears when poses are flagged **Bone scale** but no export
directory is set — their reference-skeleton FBX needs the exporter.

## The ROM timeline

The colored bar above the sections is a **live map of the ROM**: one segment per
block (preset and custom), widths proportional to their frame counts — hover a
segment for its exact frame range. It re-renders as you edit, so you always see
where every section lands before anything runs.

## Section and group tools

Each ROM section header has its **Enable** switch and **Mode** (Preset / Custom)
select. In Preset mode you can **pick the exact DTH release asset** (when several
match); a red **no preset asset** chip appears when the active release ships
nothing for the character's generation. The **JCM** section's Custom mode takes a
**path to your own pose preset** (`.duf`), loaded as the base ROM exactly like a
DTH asset.

Custom sections are built from **groups** ([grouped sections](./04-first-character.md)
carry per-group settings in their header):

- **driver bone(s)** — the bones driving the group's poses (JCM/GEN/PHY).
- **Generation / Calculate from / Suffix** — how Houdini computes the group's
  morphs (Default / Individual / Additive / Cumulative / Advanced Additive), what
  deltas are measured against (Rest Pose / Animation Frame), and the side suffix
  (Left / Centre / Right → `_l` / `_r` appended automatically).
- **Mirror right** — on a *Left* group, appends a mirrored right-side copy of the
  whole group in one click.
- The **frame chip** shows the group's computed range live (`frames 104–107`).

Inside a group: **drag rows** to reorder (frames simply renumber — they're never
stored), the small **+** next to a frame number inserts an empty pose before/after,
and each row has its [morphs expander](./04-first-character.md), **Bone scale**
toggle and remove button.

## Deleting a character

**Operations → Delete** removes the character's folder and generated files, with a
confirmation that lets you **keep the Daz files folder** (your scenes) and **keep
the Houdini files folder** (your exports) — for when the assets should outlive the
definition. This can't be undone.

[← Your first character](./04-first-character.md) · [Guide overview](./README.md)
