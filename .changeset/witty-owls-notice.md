---
'@dth/web': minor
---

The studio notices new files you save into a character's folder

Save an outfit variant from Daz (or a new Houdini project) anywhere into the
character's folder, tab back to the studio, and it now tells you: a banner on
the character page reports the new `.duf` / `.hip` files the moment the window
regains focus (and on opening the page). **Review** opens a wizard with one
page per file — the same validation the Add-scene dialog runs (generation,
one figure, empty timeline, geograft vs the primary, not-already-linked), then
**Add** links it in place; a character without a primary scene gets **Set as
primary** instead, deriving gender/genesis/GEN exactly like the link flow.
Houdini projects link in place as always.

**Skip is permanent** — a skipped file lands in the character's `.dcsmeta`
skip list and is never offered again (a manual pick/drop still works). The
banner's ✕ just hides it for the session. Files you save while the wizard is
open append as new pages on the next focus; generated output (`dth-exports`,
ROM animations, Houdini `backup/`) is never offered.

It doesn't matter which page you tab back to. If the studio is showing the
project page — or Settings, or Tools — a banner at the top of the window names
the character whose folder the file landed in and takes you there, where the
wizard above does the rest.
