# Gotchas — hard-won facts that are invisible in the code

Things that were learned by measurement or painful debugging. Verify against the
current code before relying on details, but assume the *lesson* still holds.

Split by area so "read the relevant one" stays a small read — whole-read the
file your task lives in, grep the others (`grep -ri <topic> .ai/`). New facts
land in their area's file, in the same PR that earned them (CLAUDE.md → Key
docs), and get a trigger in `.claude/hooks/triggers.mjs` when they tie to a
recognisable action.

| Area | File | Scope |
| --- | --- | --- |
| Generation core | `gotchas-core.md` | the pure generation pipeline (`packages/rom`) |
| Daz Studio | `gotchas-daz.md` | measured DS4/DS6 behavior, scripts, the Runner plugin |
| Desktop / Tauri | `gotchas-desktop.md` | the Rust shell, windows, filesystem, install/elevation |
| Web app & smoke | `gotchas-web.md` | the React SPA, router/UI traps, the smoke suite's lies |
| Releases | `gotchas-releases.md` | the release train, signing, updater, version PRs |
