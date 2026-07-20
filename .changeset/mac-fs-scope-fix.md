---
"@dth/desktop": patch
---

Fix "forbidden path" when creating a project — or any new nested folder — on macOS/Linux. Tauri's fs plugin scope-checks a not-yet-existing path as a raw string, and the `**` scope glob doesn't match a POSIX absolute path's leading `/`, so creating `.dcsmeta/images` (and other new nested paths) failed on the macOS build. A `/**` scope now covers absolute Unix paths; Windows is unaffected.
