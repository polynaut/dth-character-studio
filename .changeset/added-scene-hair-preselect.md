---
'@dth/web': patch
---

fix(web): **an added Daz scene now pre-selects its own hair items.** Creating a character and linking its first scene both filled the hair list from what the scene actually carries — but *Add scene* didn't, so every outfit variant started empty. That is the case where it matters most: an outfit scene is usually the one bringing its own hair, and hair that isn't listed rides straight into the FBX instead of being hidden for the ROM export. Adding a scene now seeds the same detected list, ready to trim in the editor.

Re-adding a scene that already has a hair list never overwrites it, and an unreadable scene still seeds nothing rather than claiming the scene is hairless.
