---
'@dth/web': patch
---

Turn off browser spellcheck across the app. The text fields hold morph/property
names, node labels and paths (e.g. `GP_Vagina_Open_Stretch`), not prose, so the red
squiggly underline was pure noise. Set `spellcheck="false"` on `<body>` — it's an
inherited attribute, so it covers every input, including the raw ROM-cell fields.
