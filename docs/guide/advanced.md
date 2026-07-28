# Advanced

&nbsp;

> [!NOTE]
> Two optional power features live here: **multiple Daz scenes** on one
> character (outfits, per-scene hair, **per-scene overrides**) and the
> **Modify JCM frames** grid. (Preserve morphs / node transforms are covered in
> [Your first character](./04-first-character.md#advanced-options--preserve-morphs--node-transforms).)

&nbsp;

## Multiple Daz scenes — outfits & hair variants

One character often exists as **several Daz scenes** — outfits, hair styles,
themed variants. Instead of duplicating the character, link every scene to the
one definition: the ROM stays shared, and the per-scene bits (hair, overrides)
attach to their scene.

**Add scene** (or dropping a `.duf` on the cards) links another scene. It's
validated first — same Genesis generation, one character, empty timeline, and
the **same GP/DK geograft as the primary**, so every scene produces the
primary's skeleton (*Add anyway* overrides) — then copied into the character's
scenes folder or left in place. The **primary** scene can't be unlinked;
extras can. Every card has **Open in Daz**.

<p align="center">
  <img width="900" alt="Daz scene cards — primary plus an outfit scene (selected), with the per-scene hair items beside them" src="screenshots/character-daz-scenes.png" />
  <br>
  <sub><em>Two linked scenes: the primary and a selected outfit scene — the hair items beside the cards belong to the selected one.</em></sub>
</p>

### The selected scene

Clicking a card **selects** that scene, and the per-scene features follow the
selection: the **hair items** list beside the cards edits the *selected*
scene's list, and editing an overridable field overrides it for the selected
scene. Scroll the cards off-screen and a **docked scene bar** slides up along
the bottom — the selected scene on the left with a green ring, the others in a
scrollable rail. Click a pill to switch, exactly like its card.

<p align="center">
  <img width="900" alt="the docked scene bar at the bottom of the character page — the selected scene prominent on the left, other linked scenes in a rail" src="screenshots/character-scene-footer.png" />
  <br>
  <sub><em>Scroll the scene cards off-screen and the docked bar keeps the selected scene on hand — click a pill to switch.</em></sub>
</p>

### Hair items — per scene, kept out of the export

With **Hair items live in the Daz scenes** on (the default), each scene
carries its full look — hair included — and the hair items you pick per scene
stay out of the DTH export: hidden right before the DTH Exporter runs, shown
again after. The DTH Exporter Plugin **2.0.1+** also unparents them, keeping
them out of **both** the FBX and the Alembic (the character page warns when
your plugin is older and would leak hair into the FBX). Turned **off**,
nothing is excluded — the classic workflow with hair in separate Daz scenes.

The picker edits the **selected** card's list — lists are per scene, since
outfit scenes carry different hair. The one generated script bakes every
scene's list and applies the right one for whichever scene is open in Daz.

- **List the top fitted item** (e.g. the hair cap) — its children ride along
  automatically.
- The dropdown offers the items found in the scene file; a label it doesn't
  offer can be typed exactly as it appears in Daz's **Scene** pane.
- A listed label that isn't found in the open scene turns amber — the export
  stops loudly rather than silently shipping a hair-polluted export.

Characters with hair items also get an `Export_Hair_…` script — it exports the
`_grooms.abc` for Houdini's **DazToHueGroom Import** node (the groom itself,
worn, with everything else hidden).

### Per-scene overrides — edit to override

Beyond hair, almost everything on the character page can differ **per scene**:
the **identity dials** (FACS detail strength, Flexion strength, Set UE5 tear
UV), the **Advanced options** preserve morphs & node transforms, and the
**whole ROM** — every section's mode, preset asset, GEN art direction,
custom-JCM path, frames and groups, plus the **Modify JCM frames** grid. There
is no override switch — on a non-primary scene you just **edit the field, and a
value that differs from the primary becomes that scene's override.**

While a non-primary scene is selected, each overridable field — and each ROM
**section title** — carries a small **cube glyph**: plain = can be overridden,
green dot + green field = overridden. Hover the cube for a **reset** button
back to the primary's value. On the primary scene the cubes don't show at all.
The one thing no scene can override is the **GEN section's on/off state** — it
follows the primary scene's geograft everywhere (its *content*, art direction
included, overrides like any other section's).

#### ROM overrides

A second outfit sometimes needs **different morphs on a few frames**, **extra
frames** for morphs only that outfit's assets have (a skirt flow, a hood
adjust), or a whole section set up differently.

Select the extra scene (the primary *is* the base ROM); every control stays
live. What you touch decides how much becomes the scene's override:

- **Tweak a base row** — its value, name, morphs, bone scale — and just **that
  row** becomes the override: it turns **green** and gains a **reset** (the
  green ↺) back to the base ROM frame. Untouched rows keep tracking later base
  edits.
- **Restructure or reconfigure a section** — reorder, insert or delete a
  frame, add a group, switch the **mode** (Preset ⇄ Custom), swap the **preset
  asset**, edit a GEN **Art-direction** frame, set a custom **JCM path**, or
  **Import from CSV** — and the **whole section** becomes this scene's
  override, editable exactly like the primary but stored on this scene.

Either way the section's **title cube goes green**; the section-title **reset**
restores the entire section to the primary at once, the per-row ↺ only that
frame.

<p align="center">
  <img width="900" alt="a non-primary scene's ROM grid — one green (overridden) row with a reset button between untouched base rows" src="screenshots/rom-override-grid.png" />
  <br>
  <sub><em>A non-primary scene's ROM grid: the green row is overridden for this scene (↺ resets it); the rows around it stay exactly as the base ROM.</em></sub>
</p>

#### What Save generates

Save still produces **one** ROM apply-script — there are no per-scene scripts:

- **`ROM_<Name>_<Genesis>.dsa`** embeds every scene's overrides and applies
  the right ones for whichever scene is **open in Daz**. One script serves the
  primary and every outfit scene.
- A scene whose overrides change the **frame layout** — different frames or
  counts, a swapped preset, a flipped mode — also gets its own
  **`<Name>_<Scene>_pose_asset.csv`** next to the default one, since Houdini
  has no runtime to pick frames. Overrides that only change applied values
  (identity dials, preserve morphs, GEN art direction, JCM mods) ride the base
  CSV — no extra file.

&nbsp;

> [!NOTE]
> Overrides are validated on Save exactly like the base ROM — an added frame
> still needs a name and a morph, and a blocked save jumps straight to the
> offending row. Frame numbers shown on a non-primary scene are the merged
> ones: what that scene's CSV actually generates.

An override isn't a mode you switch off — it exists exactly as long as
something differs from the primary. Reset every green field and section title
and the scene falls back to the base; its extra CSV is cleaned up on the next
save. Unlinking the scene does the same, so re-linking it later restores the
work.

&nbsp;

## Modify JCM frames

The **JCM** section runs the shipped joint-corrective poses — bones rotate
through their range and the stock correctives fire. The **Modify JCM frames**
grid rides *your own* morphs along with those bends (collapsed by default).

<p align="center">
  <img width="900" alt="JCM section, Modify JCM frames grid expanded" src="screenshots/jcm-modify-grid.png" />
  <br>
  <sub><em>The Modify JCM frames grid expanded in the JCM section.</em></sub>
</p>

The grid is built from **rules**, each watching **one bone's rotation axis**
(XRotate / YRotate / ZRotate) across the JCM ROM. A rule's **drives** are the
morphs it sets in proportion to the keyed angle — the angle range maps
linearly onto a value range. Example: layer a custom calf-flex morph on top of
the shipped knee-bend poses.

Each drive is one row:

- **Morph name** — the morph to drive (autocompletes, like everywhere else).
- **Angle from / to** — the bone angles (degrees) over which the morph ramps;
  the sign of **Angle to** sets the bend direction (`−115` = the negative
  bend), so one rule can hold drives for both directions. A zero or
  zero-crossing range is flagged.
- **Value from / to** — the morph's value at those angles, as a Daz-style
  percentage (`100 %` = fully dialed).

**Add rule** starts a new bone/axis; **Add morph drive** adds a row to a rule.
The **mirror** button copies a rule to the other side, flipping every
Left/Right and `_L`/`_R` token in the bone and morph names while carrying the
angles and values over unchanged — set a limb up once, mirror it.

Like the rest of the ROM, the grid is overridable per scene — edit it on a
non-primary scene and that scene keeps its own JCM mods (the JCM section title
goes green; its reset restores the primary). See
[Per-scene overrides](#per-scene-overrides--edit-to-override).

[← Your first character](./04-first-character.md)
