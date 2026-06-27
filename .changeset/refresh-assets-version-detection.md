---
'@dth/web': minor
---

Refresh assets is now its own tab under **Tools → Refresh assets**, backed by a version-detection pass. Each of a character's three artifact groups is tracked by exactly one version:

- **Daz scripts** (ROM + Export `.dsa`, plus the bundled runtime) → the **script runtime version** (new `RUNTIME_VERSION`), stamped in each script header. A bump means the scripts' call API changed, so refresh re-installs the runtime files **and** regenerates the character scripts.
- **PoseAsset CSV** → the **DTH release**, via CSV-format *eras* (`POSEASSET_CSV_BREAKING_VERSIONS`, starting at 2.4.3). A CSV is only out of date when the release it was generated for is in a different era than the active release — so moving from 2.4.3 to a non-breaking 2.4.4 stays "all good", while a future breaking release (e.g. 2.5.0, shipped alongside a new CSV variant) flags a refresh. The release the CSV was generated for is recorded in the character JSON (`generatedDthVersion`, schema **v7**) since the CSV itself can't carry a version.
- **Character JSON** → the **schema version** (migrated + re-saved on refresh).

The result is a compact **local-vs-app table** (DTH version, character schema, script runtime): each row is green with a checkmark when local matches what the app generates, or red with a yellow warning when it differs. A "refresh needed" banner and the (enlarged, pulsing-when-needed) **Refresh assets** button sit above it. About shows a short summary linking to the page, and on startup — right after the update check — the app routes you to Refresh assets when work is needed.

**Refresh is now selective:** when something is out of date, each character regenerates only its affected artifact(s); characters that are current are skipped. With nothing out of date, clicking Refresh still force-regenerates everything.

Refresh and its version table are **scoped to the window**: from a **project window** they cover that project; from the **Home window** they cover every **known** project (the recents list). With no global registry, recents is the set of projects the app knows about, so refreshing from Home brings everything up to date in one pass.

Also adds a **character-schema migration framework** in `@dth/rom` (`migrateCharacterData` + the `characterMigrations` registry). The pre-versioning shape fix-ups move into it from the web storage layer, and future breaking schema changes register one idempotent step each (additive fields like v7's `generatedDthVersion` need none).
