---
"@dth/web": patch
"@dth/desktop": patch
---

The network-drive remap result (`ensure_network_drives`) now goes through the FFI contract regime like every other structured return: zod-parsed at the invoke boundary (no more bare `invoke<T>()` cast) and pinned by a shared `contracts/remap-results.json` fixture tested on both the serde and zod side. The phantom `'unsupported'` status that no Rust path ever produced is gone from both sides. Remap failures for Explorer "reconnect at sign-in" mappings (Windows errors 1201/1202) now get actionable messages instead of a bare error number, and very long UNC paths no longer misreport as "unmapped".
