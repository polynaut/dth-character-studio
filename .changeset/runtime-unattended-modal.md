---
'@dth/rom': patch
'@dth/web': patch
---

Two Runner-batch fixes in the generated Daz scripts (runtime v85). A ROM that builds WITH problems during a batch no longer parks a modal dialog over Daz (which blocked every queued scene): the unattended carriers tell the runtime, which reports through the run log instead — the visible, human-run ROM script keeps its dialog. And a failed export can no longer cost the previous good export set: the pre-export sweep now moves the old files aside instead of deleting them, puts them back (PoseAsset CSV included) when the exporter produces nothing or throws, and only drops them once the new set has actually landed. Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.
