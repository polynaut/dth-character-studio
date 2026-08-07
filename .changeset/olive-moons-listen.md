---
'@dth/web': minor
---

The studio notices a Daz scene you just saved

Save As a new `.duf` into a character's scenes folder, switch back to the studio,
and it now says so instead of waiting to be asked: a prompt lists what it found
and whose folder it landed in, and **Add** takes you to that character with the
ordinary Add-scene dialog already open on the file — same validation, same
copy-vs-link decision. It looks only when you return to the window, never on
launch, and stays quiet about scenes that are already linked and about the ROM
animations the studio generates itself. **Not now** stops it asking about those
files until you save over one in Daz, which brings the offer back — a file you
have just re-saved is exactly the one you may have fixed.
