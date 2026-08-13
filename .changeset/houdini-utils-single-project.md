---
'@dth/web': minor
---

**The Houdini Utils drawer now works on the one project you opened it from.**

Utils are per project — that is why the 🔧 lives on the project card and not on
the section header. The drawer took that as a starting point rather than a scope:
it noted *"opened from Kira.hip"* in its title and then listed every Houdini
project the character had, offering their checks, their repairs and their nodes
as transfer targets. Pressing Utils on one card put you in front of work
belonging to three others.

Now the card you pressed is the whole subject. The General tab checks that
project and repairs that project; **Refresh assets**, **Repair project
settings**, **Make paths portable** and **Fill network** act on it alone; and the
transfer target is its own DazToHue nodes. To work on another project, open its
own card's Utils.

The **source** of a copy is unchanged and still cross-project — copying a setup
means copying it *from* somewhere else, which is the one thing here that
legitimately names another project.

Two side effects worth knowing:

- Opening the drawer is cheaper. It used to scan every linked project the cache
  could not answer for; now it scans at most one.
- Copying one source setup into several projects in a single run is gone. It was
  only reachable by ticking targets across projects in a drawer opened from one
  of them — do it per project instead.

The guide and the drawer's own tooltips have been corrected along with it: the
**Target** list never actually pre-ticked anything (the drawer opens on General,
and moving to a transfer tab clears the selection), so the guide no longer says
it does — tick the nodes that should receive the copy, which is also the right
default for something that writes to a `.hip`.
