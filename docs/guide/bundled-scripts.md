# Bundled fix-it scripts

Two scripts that ship with the studio and are run **by hand in Daz Studio**, from
**Scripts › DTH-Character-Studio** in the Content Library. Neither is part of the
ROM pipeline: they exist for scenes the pipeline cannot accept as they are, and each
is a one-off repair. They install automatically with everything else the Daz side
needs — on Save, or [Tools → Refresh assets](./tools.md#tab-3--refresh-assets).

## Geografts under a Golden Palace / Dicktator shell

Fit a **nipple** or **navel** geograft to a figure that already wears **Golden
Palace** or **Dicktator**, and the genital shell covers it. It is not a fitting
problem — a geoshell carries one visibility switch per **surface** of the figure it
shells, and a newly fitted graft adds *its* surfaces to that list **switched on**.
By hand that means switching off each `stx_…` row in the shell's *Parameters ▸ Shell
▸ Visibility ▸ Surfaces* list, on **every** GP/DK shell (Golden Palace has two), in
**every** scene.

**`Fix_Graft_Shell_Surfaces`** does it in one run. Open the scene, then run it —
nothing to select. It is safe to re-run. What it will **not** touch:

- **Other geoshells.** Skin overlays, tattoo and nail shells keep their graft
  surfaces on — a body tattoo *should* cover the nipple graft.
- **The shell's own graft.** Golden Palace's own surfaces stay visible on its own
  shells; only the *other* grafts' rows go off.
- **The figure's own surfaces** (`Body`, `Head`, `Legs`…).

A scene without a GP/DK shell is a no-op, and a shell whose graft the script can't
identify is reported as **skipped** rather than guessed at.

## Rescuing an old scene that is only a ROM animation

A scene the studio can use has an **empty timeline**, so one that already carries
animation is refused by the add-scene check — a problem when the only surviving copy
of an old character *is* the scene with its ROM baked in. **`Kill_Animation`** is
the way back, and the order matters:

1. **Open the old scene** in Daz Studio.
2. **Run `Scan_Frames` first.** It writes the animation out frame by frame as a CSV
   the studio can [import as a ROM definition](./custom-morphs.md) — do this
   *before* the next step, because afterwards there is nothing left to scan.
3. **Run `Kill_Animation`.** Nothing to select. It shows what it found — how many
   keys, how many frames — and asks before deleting anything.
4. **File ▸ Save As** into your character's folder in the studio project, and add
   it as a scene. The timeline check passes now.

It changes only the timeline. The character keeps its shape, its clothes, its hair
and the pose it holds at **frame 0** — no node deleted, no morph zeroed, no
material touched. Every key goes, and the range returns to **0–30 frames**. A
property that refuses to give up its keys is **named** rather than reported as a
clean run.

> [!WARNING]
> **There is no undo.** The script does not save the scene — that stays your
> decision — but the keys are gone from the open scene the moment you confirm. If
> the ROM in it still matters, run `Scan_Frames` first.

&nbsp;

[← Build the ROM in Daz Studio](./05-rom-in-daz.md) · [Guide overview](./README.md)
