---
"@dth/web": minor
"@dth/rom": minor
---

Add a **character-JSON schema version**, independent of the app version. A new
`CHARACTER_SCHEMA_VERSION` constant (starting at `1`) is stamped onto every saved
character as `schemaVersion`. It changes only when the stored character shape
changes (a field added, renamed, or removed) — pure app improvements leave it
untouched. Existing JSONs without the field read as version `1`. This is the
groundwork for a future migration framework: a stored version below the constant
marks a definition that needs upgrading.
