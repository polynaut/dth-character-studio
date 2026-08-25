---
'@dth/rom': minor
'@dth/web': minor
'@dth/desktop': minor
---

Every exporting DTH Export row now gets a FRESH Daz Studio session, and every
row's export is judged by the exporter's own motion summary.

Daz's re-evaluation of fitted followers silently degrades after a scene
re-load inside one Daz session (measured 2026-08-24/25, DS4 4.24: every
scripted export after a re-load froze eyes/grafts/clothing at 9–35% of the
figure's moved frames, 5/5 reproductions — the exporter cannot fix it from
inside). Two defenses ship together:

- **Fresh session per row** (job-file contract v4, `sessionPerRow`; needs
  Runner v1.4.0): the Runner runs ONE row per Daz session and quits; the
  studio's new export supervisor starts the next session, kills a hung one
  (hard per-row timeout — a teardown was measured hanging indefinitely with
  the UI alive), requeues a crashed session's batch, and refuses to let a worn
  session (Daz already open with a scene) run row one. Older Runners keep
  working single-session — the gate below still catches the wear.
- **Motion-summary gate** (studio-side, relative): after a batch, each scene's
  export log ("Alembic ROM motion summary", exporter ≥ 2.1.9) is parsed and
  the scene FAILS when multiple meshes sit far below the liveliest node —
  the measured degradation signature — or when the exporter's own
  "N of M frames left at least one mesh unchanged" warning covers the walk.
  Thresholds are pinned by tests against all 12 measured log blocks. A
  degraded scene drops out of the Houdini/Unreal continuation like any dead
  export set.
