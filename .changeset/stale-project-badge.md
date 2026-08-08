---
'@dth/web': patch
---

A Houdini project card no longer says “Needs attention” about a problem that is already gone

The badge is painted from the last stored scan, and the background sweep that
refreshes that store was started without waiting for it — so the card kept
showing whatever was found *before* the scan, while the Utils drawer, which
scans live, reported every check passing. Opening the drawer to a green
**“Nothing to fix — every check already passes”** under a card marked *Needs
attention* was the visible symptom.

The card now re-reads once the sweep it started has landed, and again when the
Utils drawer closes (the drawer's own scan is the freshest answer there is). The
first paint is still instant from the store — nothing waits on Houdini.
