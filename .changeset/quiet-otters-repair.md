---
'@dth/web': patch
---

Generation stops walking scene folders one at a time

The pass that renames the pre-v48 `.ROM_Animations` folder runs on every
generation, and it checked each of the character's scene folders in sequence —
up to three round trips per folder, on whatever share the character lives on.
The folders are independent, so they are now checked together. Nothing about
what it does changes: still idempotent, still leaves both folders alone if both
exist, still best-effort so a locked folder can never fail the generation that
triggered it.
