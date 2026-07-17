# Advanced character options

&nbsp;

> [!NOTE]
> None of these are needed for a working ROM — reach for them when a character needs
> finer control over how the ROM is built or how its morphs behave. They live on the
> **character page**: an **Advanced options** panel (collapsed by default), plus the
> **Modify JCM frames** grid inside the JCM section.

&nbsp;

## The "Advanced options" panel

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="character page, Advanced options panel expanded" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Advanced options panel expanded on the character page.</em></sub>
</p>
-->

Expand **Advanced options** near the top of the character page:

### Storage location

Shows where this character's files live and lets you **move the folder** — handy
when you reorganise a project. The scene and generated-file paths are repointed for
you.

### Preserve morphs after ROM loading

The DTH ROM zeroes morphs as it loads. Any morph you list here is **restored to the
value you set afterwards** — use it for body-shaping controls (e.g. breast or
muscle morphs) you want to keep across the whole ROM. Enter the morph's **property
name** and its **hold value**.

### Preserve node transforms

A node's transform is **memorized before** the ROM loads and **restored after**, so
posed nodes (e.g. the eyes) keep their orientation instead of being reset. Enter
the **node's label** as it appears in Daz.

## Modify JCM frames

The **JCM** section runs the shipped joint-corrective-morph poses — bones rotate
through their range and the stock correctives fire. To ride *your own* morphs along
with those bends, the JCM section has a **Modify JCM frames** grid: an optional
power feature, collapsed by default.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="JCM section, Modify JCM frames grid expanded" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Modify JCM frames grid expanded in the JCM section.</em></sub>
</p>
-->

You build it from **rules**, each watching **one bone's rotation axis** (XRotate /
YRotate / ZRotate) across the JCM ROM. A rule's **drives** are the morphs it sets
proportionally to the keyed angle — the **angle range maps linearly onto a value
range** — and you list them separately for **positive** and **negative** rotation,
so a bend each way can trigger different morphs. Example: layer a custom calf-flex
morph on top of the shipped knee-bend poses.

Each drive is one row:

- **Rotation** — `positive` or `negative` (which way the bone turns).
- **Morph name** — the morph to drive (autocompletes, same as everywhere else).
- **Angle from / to** — the bone angles, in degrees, over which the morph ramps.
- **Value from / to** — the morph's value at those angles (raw, `1` = 100%).

**Add rule** starts a new bone/axis; **Add morph drive** adds a row to a rule. The
**mirror** button copies a rule to the other side, flipping every Left/Right and
`_L`/`_R` token in the bone and morph names while carrying the angles and values
over unchanged — so you set a limb up once and mirror it.

[← Your first character](./04-first-character.md)
