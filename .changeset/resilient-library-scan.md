---
"@dth/web": patch
---

Make the library scan resilient to unreadable character folders. A locked or
delete-pending folder on a network share makes `readDir`/`exists` throw — Tauri
reports it as a "forbidden path" because it can't canonicalize the path for its
fs scope check. The project overview no longer blanks on such a folder
(`walkFiles` skips it and logs a warning), and creating a character whose target
folder already exists _or_ can't be probed now rolls the numeric suffix
(`Name (2)`) instead of failing.
