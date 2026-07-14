---
"@dth/web": patch
"@dth/rom": patch
---

Remove the generated `Open_Scene_<Character>.dsa` script and rework the "Daz Studio is already open" dialog. Opening a character always launches a fresh Daz, so the dialog now asks you to close Daz Studio first — once it has fully quit (polled every couple of seconds), the button switches from "Open anyway" to "Open now" and launches it cleanly. Any leftover `Open_Scene_*` scripts are cleaned up on the next regeneration (Tools → Refresh assets).
