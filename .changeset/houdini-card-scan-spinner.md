---
'@dth/web': minor
'@dth/ui': minor
---

**A Houdini project card now shows a spinner while it is being read.**

Checking a project means opening the whole scene in hython — tens of seconds per
`.hip` — and it happens on a background sweep nobody asked for. Until it landed
the card showed the *previous* verdict with nothing to say it was out of date, so
a badge that was about to appear (or clear) looked settled while it was still
being decided. A small spinner now sits on the corner of the thumbnail while
Houdini has that project open, and the card's verdict refreshes the moment its
own scan lands rather than waiting for the whole sweep to finish.

Only the projects actually being re-read show it. A project you haven't touched
is answered from the cache without starting Houdini at all, so a quiet card means
"nothing to do" — not "not checked yet". Marking those too would have flickered a
spinner on every card on every page load, which is how a status indicator becomes
something you stop looking at.

The card stays fully usable while it spins: opening, renaming, unlinking and the
Utils drawer all keep working. The scan is something the studio started on its
own, and it has no business taking the controls away.
