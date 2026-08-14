---
'@dth/web': patch
---

Start scan says it is working, and a blocked save paints the field that blocked it

Two fixes that were written on 2026-08-10 and never opened as a PR:

- **Start scan looked dead.** `startSceneScan` does not return quickly — on a
  Daz that is already up it waits for the Runner to claim the handoff, polling
  for up to 10s before it either resolves or takes the job back. The button sat
  there enabled and unchanged for that whole time, so the click read as ignored.
  It now shows that it is working.
- **A blocked save only toasted.** A pose name Houdini will reject fails the
  save, but the offending row looked exactly like every other one — the user had
  to hunt for it. The failing field is now painted with the reason.
