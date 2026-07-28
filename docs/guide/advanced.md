# Advanced

&nbsp;

> [!NOTE]
> Two optional power features live here: **multiple Daz scenes** on one
> character — outfits and hair variants, per-scene hair lists, and **per-scene
> overrides** — and the **Modify JCM frames** grid for morphs riding along the
> shipped joint correctives. (The character page's **Advanced options** section —
> preserve morphs / node transforms — is covered in
> [Your first character](./04-first-character.md#advanced-options--preserve-morphs--node-transforms).)

&nbsp;

## Multiple Daz scenes — outfits & hair variants

One character often exists as **several Daz scenes**: the default look plus a
second outfit, another hair style, a themed variant. Instead of duplicating the
character, link every scene to the one definition — the ROM setup, morphs and
generated files stay shared, and the per-scene bits (hair, overrides) attach to
the scene they belong to.

**Add scene** (or dropping a `.duf` on the cards) links another scene. The add
dialog validates it first — same Genesis generation, one character, empty
timeline, and the **same GP/DK geograft as the primary**, so every scene
produces the primary's skeleton. A failed check explains itself on hover, and
*Add anyway* lets you proceed. Then it asks whether to **copy the scene into
the character's scenes folder** or leave it in place. The **primary** scene —
the one the character was created from — can't be unlinked; extras can. Every
card has **Open in Daz**.

<p align="center">
  <img width="900" alt="Daz scene cards — primary plus an outfit scene (selected), with its per-scene hair list below" src="screenshots/character-daz-scenes.png" />
  <br>
  <sub><em>Two linked scenes: the primary and a selected outfit scene — the hair list below belongs to the selected card.</em></sub>
</p>

### The selected scene

Clicking a card **selects** that scene, and the per-scene features follow the
selection: the **hair items** list below the cards edits the *selected* scene's
list, and editing an overridable field — anything in the ROM, an identity dial
or a preserve item — overrides it for the selected scene. Scroll the scene
cards off-screen and a **docked scene bar** slides up along the bottom: the
selected scene sits on the left with a green ring, the other linked scenes
follow in a scrollable rail — so you always know which scene you're on and can
switch mid-scroll. Click a pill to select it, exactly like its card.

<p align="center">
  <img width="900" alt="the docked scene bar at the bottom of the character page — the selected scene prominent on the left, other linked scenes in a rail" src="screenshots/character-scene-footer.png" />
  <br>
  <sub><em>Scroll the scene cards off-screen and the docked bar keeps the selected scene on hand — click a pill to switch.</em></sub>
</p>

### Hair items — per scene, kept out of the export

With **Hair items live in the Daz scenes** on (the default), each scene carries
its full look — hair included — and the hair items you pick per scene stay out
of the DTH export: they're hidden right before the DTH Exporter runs and shown
again afterwards, so hair never rides into the ROM's FBX/Alembic. The DTH
Exporter Plugin **2.0.1+** also unparents the hidden items, keeping them out of
**both** the FBX and the Alembic (older plugins leak the hidden hair into the
FBX — the character page warns when yours is too old). Turned **off**, nothing
is excluded — the classic workflow where hair lives in separate Daz scene
files.

The picker under the scene cards edits the **selected** card's list — the lists
are per scene, since outfit scenes carry different hair. The one generated
script bakes every scene's list and applies the right one for whichever scene
is open in Daz; a scene with no items listed exports as-is.

- **List the top fitted item** (e.g. the hair cap) — its children ride along
  automatically.
- The dropdown offers the items found in the scene file (hair-ish names first,
  type to filter). A label the scan doesn't offer can be typed exactly as it
  appears in Daz's **Scene** pane and added.
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
**section title** — carries a small **cube glyph**. A plain cube means "can be
overridden on this scene"; once overridden it grows a **green dot** and the
field (or the whole section) turns green (a toggle flipped *off* as an override
keeps a light-green knob). Hover or keyboard-focus the cube for a **reset**
button back to the primary's value. On the primary scene there is nothing to
override, so the cubes don't show at all. The one thing no scene can override
is the **GEN section's on/off state** — it follows the primary scene's GP/DK
geograft everywhere (its *content*, art direction included, overrides like any
other section's).

#### ROM overrides

A second outfit sometimes needs **different morphs on a few frames** — a body
shape that reads better in that clothing — plus **extra frames** for morphs
only that outfit's assets have (a skirt flow, a hood adjust), or a whole
section set up differently: another preset, custom instead of preset, its own
art direction.

Select the extra scene (the primary *is* the base ROM); every control stays
live. What you touch decides how much becomes the scene's override:

- **Tweak a base row** — its value, name, morphs, bone scale, combined
  morphs — and just **that row** becomes the override: it turns **green** and
  gains a **reset** button (the green ↺) back to the base ROM frame. Rows you
  don't touch stay exactly as the base ROM and keep tracking later base edits.
- **Restructure or reconfigure a section** — reorder (drag), insert a frame,
  delete a base frame, add a group, switch the section's **mode** (Preset ⇄
  Custom), swap its **preset asset**, edit a GEN **Art-direction** frame, set a
  custom **JCM path**, or **Import from CSV** — and the **whole section**
  becomes this scene's override. It then edits exactly like the primary — full
  drag, insert, delete and group management — just stored on this scene.

Either way the section's **title cube goes green**, and the section-title
**reset** (the green ↺ on the title) restores the **entire section** to the
primary at once; the per-row ↺ is the granular version — it resets only that
frame.

<p align="center">
  <img width="900" alt="a non-primary scene's ROM grid — one green (overridden) row with a reset button between untouched base rows" src="screenshots/rom-override-grid.png" />
  <br>
  <sub><em>A non-primary scene's ROM grid: the green row is overridden for this scene (↺ resets it); the rows around it stay exactly as the base ROM.</em></sub>
</p>

#### What Save generates

Save still produces **one** ROM apply-script — there are no per-scene scripts:

- **`ROM_<Name>_<Genesis>.dsa`** embeds every scene's overrides and, at run
  time, applies the right ones for whichever scene is **open in Daz** — the
  identity dials and the ROM frame changes alike. One script serves the primary
  and every outfit scene.
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

The **JCM** section runs the shipped joint-corrective-morph poses — bones
rotate through their range and the stock correctives fire. The **Modify JCM
frames** grid rides *your own* morphs along with those bends — an optional
power feature, collapsed by default.

<p align="center">
  <img width="900" alt="JCM section, Modify JCM frames grid expanded" src="screenshots/jcm-modify-grid.png" />
  <br>
  <sub><em>The Modify JCM frames grid expanded in the JCM section.</em></sub>
</p>

The grid is built from **rules**, each watching **one bone's rotation axis**
(XRotate / YRotate / ZRotate) across the JCM ROM. A rule's **drives** are the
morphs it sets in proportion to the keyed angle — the angle range maps linearly
onto a value range. The sign of a drive's angle range picks the bend direction,
so one rule can hold drives for both directions at once. Example: layer a
custom calf-flex morph on top of the shipped knee-bend poses.

Each drive is one row:

- **Morph name** — the morph to drive (autocompletes, like everywhere else).
- **Angle from / to** — the bone angles (degrees) over which the morph ramps;
  the sign of **Angle to** sets the bend direction (`−115` = the negative
  bend). A zero or zero-crossing range is flagged.
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
