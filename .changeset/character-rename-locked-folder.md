---
'@dth/web': patch
---

fix(web): **renaming a character no longer dies on "Access is denied. (os error 5)".** Windows refuses to rename a folder while any file inside it is open in another program — for a character folder that is almost always Daz Studio still holding the linked scene — and the raw OS error named neither the cause nor the fix. A rename now retries briefly first, so a passing antivirus scan or search-indexer touch no longer costs you the rename at all; if something really is holding it, the message says which folder and what to close instead of surfacing the plugin's error text. Applies to both rename paths: the character's name and the folder chip's edit-to-move. A failed rename still leaves the character exactly as it was — the folder move is the first thing a save writes, so nothing ends up half-renamed.
