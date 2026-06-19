---
"@dth/web": minor
---

The studio is now **self-contained**: the DTH runtime (`DthWorkflow.dsa` /
`DthUtils.dsa` / `DthOptions.dsa`) is bundled into the app and installed from
there, so it no longer needs a DazToHue-Scripts checkout. The "DazToHue-Scripts
folder" setting is removed — generating a character installs the runtime
straight from the bundled copy. (A runtime version, to flag when an app update
should refresh the bundled files, is planned as a follow-up.)
