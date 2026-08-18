---
'@dth/rom': patch
'@dth/web': patch
---

The generated Daz scripts no longer lose the DTH runtime on the first scene of a cold-started export (runtime v84). On the first row of a Runner batch in a freshly launched Daz, `getScriptFileName()` could answer with a Daz-internal path, so the runtime include resolved into `DAZStudio4/resources/` and the row failed "runtime missing" with the runtime installed and intact. Every generated script now probes the normal relative location first and falls back to the install root baked in at generation time; the installed runtime files use absolute includes; and the failure report names every probed location plus the script's raw self-reported folder. Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.
