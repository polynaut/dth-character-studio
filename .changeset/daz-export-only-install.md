---
# minor: a new settings field, a new switch, and a new rule about which Daz
# gets launched — behaviour that did not exist before.
'@dth/web': minor
---

**"Export only": run the export batch in an older Daz Studio while everything else uses the new one.**

The batch handoff is the one thing that needs a *plugin* — the DTH Runner claims the job file when Daz starts — and a plugin binary is built against a single Studio major version. So moving to the newest Studio for authoring used to mean waiting for a Runner build before you could export at all, or putting the whole app back a version.

With the newest installation active, each **older** Daz card in Settings now offers an **Export only** switch. Turn it on and DTH Export starts its batch in that installation; opening scenes, running scripts and installing content stay on the active one. Only one installation can carry it — turning it on for one card turns it off everywhere else.

Two things follow the switch, and have to: the Runner plugin's **install target** and its **gate**. A Runner sitting in the installation that does *not* run the batch would let the export dialog report "ready", then start the other Daz, find nothing to claim the job file, and wait for a batch that never begins. The install also picks the DS4/DS6 build to match wherever it is going.

The switch is offered only on installations older than the active one, only while the active one is the newest detected, and never on one whose folder is missing.
