---
"@dth/web": minor
---

Separate app data from a user-owned character library. Settings and avatars stay
in the app's private folder; each character now lives in its own folder
(`<library>/<Name>/`) holding its definition **and** its generated files
(`.dsa`, FBM JSON, PoseAsset CSV), inside a library folder the user picks and
backs up. Adds a first-run folder picker, native folder pickers in Settings, a
per-character "Storage location" panel to view the absolute path and move a
character into subfolders, and a one-time migration of existing characters out
of the app folder into the chosen library.
