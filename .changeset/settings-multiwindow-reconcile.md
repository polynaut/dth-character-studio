---
'@dth/web': patch
---

Settings: reconcile the open form when another window saves settings. Previously the form kept its once-loaded state, so after a background refresh the Save/Discard buttons lit up though nothing was touched — and saving would write the stale value back over the other window's change. Fields you've actually edited are kept; untouched fields quietly adopt the newer value.
