# Advanced character options

&nbsp;

> [!NOTE]
> The **Modify JCM frames** grid is an optional power feature — reach for it when a
> character needs its own morphs riding along the shipped joint correctives. (The
> character page's collapsed **Advanced options** panel — storage location, preserve
> morphs / node transforms — is covered in
> [Your first character](./04-first-character.md).)

&nbsp;

## Modify JCM frames

The **JCM** section runs the shipped joint-corrective-morph poses — bones rotate
through their range and the stock correctives fire. To ride *your own* morphs along
with those bends, the JCM section has a **Modify JCM frames** grid: an optional
power feature, collapsed by default.

<p align="center">
  <img width="900" alt="JCM section, Modify JCM frames grid expanded" src="screenshots/jcm-modify-grid.png" />
  <br>
  <sub><em>The Modify JCM frames grid expanded in the JCM section.</em></sub>
</p>

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
