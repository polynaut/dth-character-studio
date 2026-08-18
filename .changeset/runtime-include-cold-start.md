---
'@dth/rom': patch
'@dth/web': patch
---

The generated Daz scripts no longer lose the DTH runtime on the first scene of a cold-started export or scan (runtime v84). On the first row of a Runner batch in a freshly launched Daz, `getScriptFileName()` could answer with a Daz-internal path, so the runtime include resolved into `DAZStudio4/resources/` and the row failed "runtime missing" with the runtime installed and intact.

Nothing a batch row depends on reads that answer alone any more: every generated script (and the per-run scan script) probes the normal location first and falls back to the install root baked in by the studio; the installed runtime uses absolute includes; and the bulk scan carriers get their config/content-root folder baked in too, rather than deriving it from the same call. The failure report now names every probed location plus the script's raw self-reported folder.

Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.
