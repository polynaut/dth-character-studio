---
"@dth/desktop": patch
---

Desktop robustness: every I/O-heavy native command now runs off the main thread (`#[tauri::command(async)]`), so large asset installs, dedup scans and network `.duf` walks no longer freeze the window. Also: asset installs skip directory junctions instead of following them (a junction cycle could previously loop forever while copying), nested asset zips share their outer archive's decompression budget instead of minting fresh allowances, a failed quarantine move cleans up its partial copy, GitHub release lookups time out after 10s instead of hanging, closed windows drop their project mapping, Home-window creation no longer races itself, and the New Project menu item builds its window off the main thread like every other window path.
