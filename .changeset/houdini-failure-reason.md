---
'@dth/web': patch
---

**A Houdini export that dies now says why.**

The headless export leg streams Houdini's whole console into
`.dth_houdini_console.log` beside the character's job files, and that file is
deliberately kept after a run — it is the diagnosis channel. But when the run
died, the studio reported only *"The Houdini export did not finish — Houdini is
no longer running"*: true, useless, and contradicted by the file it had just
written itself.

Measured on a real failed run: hython exited immediately because it could not
get a Houdini license (headless hython needs one of its own, and the machine
could not reach its license server), the log said exactly that in two lines, and
the toast said Houdini had stopped.

The failure toast now leads with what the log says — *"…did not finish — Houdini
could not get a license."* — and points at the file for the full output.
Licensing is recognised by name because it is the one failure that says nothing
about your project, your scene or the studio; anything else shows the log's last
line, on the grounds that a raw line beats a confident wrong summary. A run that
died with nothing in its log reads exactly as before.
