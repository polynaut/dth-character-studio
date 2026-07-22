---
"@dth/web": patch
---

Character page tabs (Character / Products / Notes) now live in the URL (`?tab=`),
so switching them pushes a history entry — the browser (or mouse) Back button
returns to the previous tab, and a tab is deep-linkable/refresh-stable. 'Character'
is the default, encoded as the absence of the param so the base URL stays clean.
