---
'@dth/rom': patch
'@dth/web': patch
---

Two Runner-batch fixes in the generated Daz scripts (runtime v85). A batch no longer parks behind a dialog nobody is there to click: a ROM that built WITH problems, and a product scan that could not find the DAZ Install Manager manifests folder or write its CSV, each opened a modal over Daz mid-batch and blocked every queued scene behind it — the unattended carriers now tell the runtime nobody is watching, and it reports through the run log and the Daz log instead, while the visible, human-run scripts keep their dialogs. And a failed export can no longer cost the previous good export set: the pre-export sweep now moves the old files aside instead of deleting them, puts them back (PoseAsset CSV included) when the exporter produces nothing or throws, and only drops them once the new set has actually landed. Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.
