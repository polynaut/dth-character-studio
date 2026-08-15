# Bundled fix-it scripts

Two scripts that ship with the studio and are run **by hand in Daz Studio**,
from **Scripts › DTH-Character-Studio** in the Content Library. Neither is part
of the ROM pipeline: they exist for scenes that are in a state the pipeline
cannot accept, and each one is a one-off repair you run once and forget.

They install automatically with everything else the Daz side needs — on Save, or
[Tools → Refresh assets](./tools.md#tab-3--refresh-assets). There is no separate
download.

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

---

## Rescuing an old scene that is only a ROM animation

A scene the studio can use has an **empty timeline** — the generated ROM script
fills the timeline itself, so a scene that already carries animation is refused
by the add-scene check. Which is a problem when the only surviving copy of an
old character *is* the scene with its full ROM baked in.

The bundled **`Kill_Animation`** script is the way back. The order matters:

1. **Open the old scene** in Daz Studio.
2. **Run `Scan_Frames` first.** It writes the animation out frame by frame as a
   CSV the studio can [import as a ROM definition](./custom-morphs.md) — do this
   *before* the next step, because afterwards there is nothing left to scan.
3. **Run `Kill_Animation`** from **Scripts › DTH-Character-Studio**. Nothing to
   select. It shows you what it found — how many keys, how many frames — and
   asks before deleting anything.
4. **File ▸ Save As** into your character's folder in the studio project, and
   add it as a scene. The timeline check passes now.

What it changes is only the timeline. The character keeps its shape, its
clothes, its hair and the pose it holds at **frame 0** — no node is deleted, no
morph zeroed, no material touched. Every key goes, and the animation range goes
back to **0–30 frames**, the timeline a fresh Daz scene opens with.

> [!WARNING]
> **There is no undo.** The script does not save the scene — that stays your
> decision — but the keys are gone from the open scene the moment you confirm.
> If the ROM in it still matters to you, run `Scan_Frames` first.

If a property refuses to give up its keys, the script says so and **names it**,
rather than reporting a clean run over a scene that still has animation in it.

&nbsp;

&nbsp;

[← Build the ROM in Daz Studio](./05-rom-in-daz.md) · [Guide overview](./README.md)
