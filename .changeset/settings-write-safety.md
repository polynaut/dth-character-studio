---
"@dth/web": patch
---

Multi-window write safety for the machine settings: saving settings now merges by baseline — only the fields you actually changed on that page win, everything else is re-read fresh from disk — so with one project per window, a save in one window no longer silently reverts what another window saved in the meantime. The Tools page now arms the unsaved-changes guard like Settings and the character editor (navigating away or closing the window with unsaved Tools edits asks first). A corrupt settings.json is surfaced once at startup instead of silently resetting every tool path to defaults. The Project tab's defaults now come from the single canonical copy instead of a second hardcoded list.
