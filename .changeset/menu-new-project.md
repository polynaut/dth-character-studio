---
'@dth/web': patch
'@dth/desktop': patch
---

**Main → New Project opens the create-project panel again.** The menu entry
focused/opened the Home window but never opened the dialog. Now an
already-running Home window gets told to open the panel, and a freshly created
one starts with it open.
