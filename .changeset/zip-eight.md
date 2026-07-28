---
"@dth/desktop": patch
---

The desktop crate's zip handling moves to zip 8 (from 4). The dedup/install
pipeline's behavior is unchanged — zip-slip refusal, unreadable-entry
hard-errors and ZipCrypto detection are all pinned by the crate's tests, which
pass against the new major.
