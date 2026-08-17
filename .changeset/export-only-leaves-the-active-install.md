---
'@dth/web': patch
---

**Export only** disappears from the installation you activate.

Activating the Daz install that was flagged **Export only** left its switch on
screen — now on the *active* card, still on — which reads as if activating had
somehow demoted the install. It cannot mean anything there: the flag says "the
export batch runs somewhere other than where everything else runs", and an
installation that runs everything is exactly the case it excludes.

So the switch is no longer offered on the active card, and activating a flagged
install clears the stored flag in the same save. Hiding it alone would have been
the worse half of the fix: the flag would stay armed with nothing on screen to
disarm it, harmless only because it happened to point at the active folder
anyway.

Nothing changes for the arrangement the flag is actually for — a newer Studio
running everything with the batch kept in an older one still works exactly as
before.
