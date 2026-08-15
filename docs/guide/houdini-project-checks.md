# Project checks and repairs

The **Utils drawer**'s **General** tab: the health check of the `.hip` itself,
and the repairs for what it finds. The tab the drawer opens on, and the only one
useful without a source project picked.

It is about the one project whose card you pressed **Utils** on. Copying a
node's complete setup *between* projects is the drawer's other half —
[The Utils drawer](./houdini-utils.md).

## The General tab

What this project carries **now**, and what the studio can put right. Every
check is one row — its name on the left, the verdict on the right, the value
beneath — and the fixes sit in the footer, in the order they have to be run.
(**Refresh assets** leads them but answers to no check; see below.)

<p align="center">
  <img width="900" alt="the General tab: one row per check, verdicts aligned right, the fixes in the footer" src="screenshots/houdini-utils-general.png" />
  <br>
  <sub><em>A project made before v0.64: <code>$JOB</code> still points below the exports, everything else passes.</em></sub>
</p>

**Project folder (`$JOB`)** is the one you can repair. `$JOB` is saved *inside*
each `.hip`, so a project keeps whatever it was created with — and projects made
before v0.64 point it at the shared `houdini/houdini-project` folder rather than
at the character folder.

Since the exports moved inside `houdini/` (v0.68), most import paths no longer
depend on `$JOB` at all: they sit under **`$HIP`**, the `.hip`'s own folder,
which Houdini derives from where the file is and so can never get wrong. What
still runs through `$JOB` is what `$HIP` cannot reach without climbing out —
chiefly the character's **`export/`** folder, Houdini's own Unreal-bound output,
which sits *beside* the houdini folder rather than under it and is written
`$JOB/export/`. A project carrying another character's `$JOB` aims its finals at
that character's tree.

Measured with the call Houdini's own file picker uses — on the pre-v0.68 layout,
when the exports still sat outside the houdini folder and `$JOB` was the only
variable that reached them:

| `$JOB` | picking an export gave you |
| --- | --- |
| `<character>/houdini/houdini-project` | `D:\…\Ita\houdini\daz-export\primary\Ita.fbx` |
| `<character>` — what **Repair project settings** writes | `$JOB/houdini/daz-export/primary/Ita.fbx` |

> **It fixes what you pick from now on.** Repointing `$JOB` does not rewrite
> references that are *already* stored absolute — that is what **Make paths
> portable** below is for.

**Timeline (FPS)** is the second value the same button repairs, and it is scene
state in exactly the same way. The ROM is **one pose per frame at 30 fps** — that
is the rate Daz writes it at and the rate the PoseAsset CSV's frame numbers mean
— while Houdini's own default is 24. DazToHue's import node sets the scene's FPS
for you *when it loads the files*, so this row is about the projects where that
hasn't happened: one the studio generated headlessly (nothing loads a file there,
so generation sets it up front) and one you built by hand before importing
anything.

> **What it does to existing animation is Houdini's business.** The repair calls
> Houdini's own `setFps`; how that treats keys already in a scene is Houdini
> behaviour this studio has not measured. As with every other run here, the
> project is backed up first and a failed one can be put straight back from the
> report.

**PoseAsset CSV path** is a read-out rather than a repair of its own — *filled
in*, *not filled in* (**Fill network** writes it), or *your DazToHue has no such
parameter*, the release story spelled out under **Fill network** below. Three
different answers, and only the middle one is work you can do.

**Reference paths** and **Import references** are the other half. Repairing
`$JOB` decides how *future* picks are written down; these two fix what is
already written.

**Baker textures** is the one row with nothing to press. It lists the material
baker layer textures whose file is no longer on disk — usually a Daz product
that was uninstalled or a library that moved. The studio can only tell you;
putting the file back is a reinstall.

> **Why it's worth a row at all.** This is the one failure in the pipeline that
> reports itself as success. Baking with a missing texture prints
> `DazToHue: export finished` in the Houdini console and raises nothing — no
> error, no warning. Without this row the first sign is a wrong-looking
> character in Unreal, long after the bake.

**Make paths portable** does two things in one pass:

- Rewrites every absolute reference that sits under `$HIP`, `$JOB` or
  `$DAZ3D_LIB` so it is stored relative to that variable instead. On a real
  project that was **131 texture paths**, all of them into the Daz library.
  Anything under none of those roots can't be made portable — it stays exactly
  as it is and the report names it. It also **shortens** a project still
  carrying the longer `$JOB/houdini/daz-export/…` form to today's
  `$HIP/daz-export/…`, and only on DazToHue nodes — a `$JOB` path on your own
  cache or render nodes is your choice of anchor and is left alone.
- **Re-homes the pre-v0.69 `$HIP/../…` paths** the card
  [warns about](./06-into-houdini.md#project-checks--what-the-card-warns-about).
  Projects made before v0.69 reach the character folder by climbing *out* of the
  houdini folder — `$HIP/../daz3d/Kira.duf` — which resolves today but encodes
  the scene's **depth**, so the day that `.hip` sits one folder deeper every one
  of them points somewhere else. They are rewritten to `$JOB/daz3d/Kira.duf`,
  which names the character folder outright. Only `$HIP` paths that actually
  leave the folder are touched: one that stays inside is where Houdini itself
  puts renders and caches, and is not a leftover.
- Rebuilds a **DazToHue import** path that points at a file which isn't there.
  Two cases, one pass. Projects made before v0.63 address their `.dth` through
  the retired `dth-exports` junction, so it dangles while the `.fbx` and `.abc`
  beside it are fine — the replacement is derived from that same node's other
  export files, which sit together under the same name. Projects made before the
  export folder moved point at the old one, and there **every** import broke at
  once, so no sibling survives to follow: those are rebuilt from the character's
  current export directory instead. Either way the new path is only written when
  the file it would point at **actually exists**. Nothing is guessed.

> **`$JOB` has to be right first**, and the button stays disabled until it is.
> A path is made relative to whatever `$JOB` the scene currently carries, so
> repathing a project that still has the old value would store every export
> path against the wrong folder. Measured on one real project: with the stale
> `$JOB` it reports *0* paths it can fix; after the `$JOB` repair, the same file
> reports *2*.

Both offer a **Dry run**, and both take the same silent backup described above —
so a failed run can be undone from its own report. Running twice changes nothing
the second time.

**Fill network** gives an *existing* project the same wiring
[Generate project](./06-into-houdini.md#generate-the-houdini-project-automatically)
gives a new one: the import file paths, the export directory and — once your
DazToHue has it — the PoseAsset CSV path. Projects you already have can never be
regenerated, so this is how they catch up.

Two things make it safe to run on a project you set up by hand:

- **Only blank parameters are written.** Anything you filled in yourself is
  listed as *already set, left alone* and never touched.
- **A parameter your DazToHue version doesn't have is named, not silently
  skipped.** DazToHue **2.5** has no PoseAsset CSV *path* — the node ships an
  import *button* instead — so the row says so rather than failing quietly.
  **2.5.1** added it (*Auto CSV File Path*), and there Fill network writes it
  like any other blank parameter. Nothing to re-install and nothing to
  re-generate: install the newer DazToHue and the same action simply starts
  filling it.

Once the paths are in, Fill network runs the import node's own *"a character was
chosen"* routine — so the project comes back with the character **loaded, on the
rest pose**, instead of holding correct paths whose load never happened (the
same step [Generate project](./06-into-houdini.md#generate-the-houdini-project-automatically)
takes). It is skipped when the export files aren't on disk yet: there is nothing
to load.

**Repair project settings** is enabled only when the project actually differs —
one already on the right folder *and* the right timeline leaves the button dead,
so running it twice rewrites nothing the second time. The two values are judged
separately: a project whose `$JOB` is fine and whose timeline is 24 gets its
timeline written and nothing else, and the report says which of them moved. It
offers the same **Dry run** as the transfer, and the same backup before saving.
A value the scan couldn't read is never repaired: it is *unknown*, not wrong.

**Refresh assets** is the odd one out, and deliberately so. A `.hip` stores the
DazToHue asset definitions it was built with, so switching your installed
DazToHue release leaves every project you already have on the old ones —
DazToHue's own answer to that is the **Refresh Assets** tool on its shelf. This
button runs *that tool* on this project, without you opening it in Houdini.

Three things it does **not** do, because it can't:

- **It isn't a check.** Nothing in a project says which DazToHue release its
  assets came from, so nothing can tell you a project needs this. It is always
  on offer and never counted among the three checks above — you run it when you
  know you changed DazToHue.
- **It can't preview.** The studio runs DazToHue's tool rather than doing the
  refresh itself, so it has no idea in advance what will change. The **Dry run**
  still opens the project and runs the tool — it simply never saves the file.
  That is a weaker promise than the other dry runs' *nothing was written*, and
  the dialog says so.
- **It won't tell you it worked.** The report names the shelf tool that ran and
  whether the scene came back *modified* — nothing more, because nothing more
  was observed. A project that reports no change is left alone rather than
  re-saved.

If the tool isn't found, the report names the DazToHue shelf tools that *were*
there. hython reads the shelves from the Houdini **documents folder** in
Settings, so that list is usually the fastest way to see that DazToHue isn't
installed for the Houdini version the studio is pointed at.

## Scanning

Like [Generate project](./06-into-houdini.md#generate-the-houdini-project-automatically),
this runs Houdini's `hython`, so it needs the **Houdini installation folder**
and its matching documents folder in Settings. The drawer scans the one project
it was opened on — when it opens and again after a run — and only when something
that project depends on changed, so coming back to one nobody touched costs
nothing. Reading a `.hip` the first time takes a few seconds; a transfer
rewrites it, so it is read once more afterwards. One scan serves every tab — the
`$JOB` and `$HIP` values are read in the same pass as the nodes — so switching
between them is instant.

**Installing a new DazToHue invalidates it.** What the scan remembers depends on
the DazToHue libraries hython loads, not only on the `.hip` — so installing,
updating or removing an `.hda` in the paired preferences folder re-reads every
project that depended on it. Without that, a verdict phrased in the *old*
release's vocabulary outlives the install that replaced it: a freshly installed
DazToHue would keep being reported as the one it replaced.

**Rescan re-reads the project.** The button bypasses the cache and opens the
`.hip` with hython again, then says so — so a verdict you believe is wrong has
a way out. (It used to be served by that same cache, which on a project that
looked fresh made it indistinguishable from a dead button.)

&nbsp;

[← The Utils drawer](./houdini-utils.md) · [Guide overview](./README.md)
