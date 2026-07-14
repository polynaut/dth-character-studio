---
'@dth/ui': patch
---

Stop tooltips floating above modal dialogs. The global tooltip (`z-100`) could show
over a dialog (`z-50`) — e.g. the "Open in Daz" tooltip lingering above the
"Daz Studio is already open" modal. The tooltip now stays hidden when its anchor is
covered by an element in another subtree (a dialog overlay), while tooltips on
elements inside a dialog still work.
