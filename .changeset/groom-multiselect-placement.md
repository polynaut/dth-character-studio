---
'@dth/ui': minor
'@dth/web': minor
---

The groom (hair) settings moved up under the Daz scene cards — the lists are per scene, so selecting a card now visibly swaps the hair list right beneath it. The list itself is a new multi-select combobox (new `MultiSelect` in `@dth/ui`): the selected items sit in one always-rendered field as removable pills, clicking into it lists the scene's remaining wearables (hair-ish first, type to filter), and a label the scan doesn't offer can still be typed and added. A pill whose label isn't found in the scene turns amber with a tooltip.
