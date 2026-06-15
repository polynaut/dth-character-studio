# Brand assets

High-res source logo art for DTH Character Studio — kept here for design work
(icons, splash, marketing). All are 1254×1254.

| File | Description |
|---|---|
| `logo-transparent.png` | **Primary master** — logo on a transparent background (RGBA). The app icons + web favicon are generated from this. |
| `logo-on-black.png` | The original render, logo on a solid black background. |
| `logo-on-white.png` | The original "transparent" export — actually flattened onto near-white (`#f8f8f8`, no alpha). Kept for light-background use. |

`logo-transparent.png` was derived from `logo-on-white.png` by keying out the
near-white background (edge flood-fill bounded by the logo's black outline), so
the swirls and the white face silhouette stay intact while the background and
the open gaps between swirls become transparent.

## Regenerating app icons

After changing the logo, regenerate from the transparent master:

```sh
# Desktop / installer / window icons → apps/desktop/icons/
pnpm --filter @dth/desktop tauri icon "brand/logo-transparent.png"
```

Then refresh the web favicon (`apps/web/public/{favicon.ico,logo192.png,logo512.png}`):
copy the generated `apps/desktop/icons/icon.ico` to `favicon.ico`, and downscale
the master to 192×192 and 512×512 (preserving alpha).

> A floating (background-less) icon requires a source with a real alpha channel
> (PNG color type 6 / RGBA). If you hand-export a new logo, make sure the
> background is genuinely transparent — a flattened RGB PNG (like the original
> `logo-on-white.png`) will bake its background into the icon.
