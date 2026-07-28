---
"@dth/rom": minor
"@dth/web": minor
---

The character JSON's per-scene data is restructured (schema v24, migrated
automatically on read): the four parallel ROM override arrays became one
section-keyed `rom` record whose escalation clears the sparse layers at the
same key; the per-scene panels (identity, preserve, JCM rules) are
presence-armed — a block existing IS the override, stored booleans are gone;
and the character-level `groomScenes` map folded into the scene records as
`hair`, so one structure repoints on folder moves. Empty entries and records
self-prune, and the migration drops data that was already dead (orphaned row
ids, disarmed panels' stored payloads). Generated artifacts are unchanged —
the runtime consumes the compiled merge, not the stored shape.
