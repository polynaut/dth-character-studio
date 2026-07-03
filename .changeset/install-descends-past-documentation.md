---
'@dth/desktop': patch
---

Fix **Install Daz assets** silently installing only a product's readme. The installer's content-root finder stopped at the first folder level that held *any* recognised folder — and since `Documentation` counts as a (fallback) metadata folder, a product packaged as a top-level `Documentation/` beside a `My Library/` (or `Content/`) wrapper that holds the real `data`/`Runtime` resolved to the **Documentation folder at the root** and never descended into the wrapper. The result: the install copied the product's `Documentation/…README.pdf` into the library and skipped every morph/texture, so the content looked installed but was missing in Daz (a "Missing Files" prompt when opening a scene that used it).

Real content folders (`data`/`People`/`Runtime`) found at any depth now take precedence over a `Documentation`-only folder at a shallower level; a Documentation-only level wins only when there's no real content anywhere (so a genuinely docs-only asset still reports as installed). Applies to both folder and `.zip` sources. Re-run **Tools → Optional → Install Daz assets** to install content that previous runs left as readme-only.
