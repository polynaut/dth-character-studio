---
'@dth/rom': patch
'@dth/web': patch
---

A ROM that builds WITH problems during a Runner batch no longer parks a modal dialog over Daz, which blocked every queued scene behind an OK nobody was there to click (runtime v85). The unattended carriers now tell the runtime, which reports through the run log and the Daz log instead; the visible, human-run ROM script keeps its dialog. Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.
