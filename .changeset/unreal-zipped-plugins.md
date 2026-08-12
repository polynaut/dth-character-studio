---
'@dth/web': minor
---

**Unreal plugins that ship as a zip are found and installed.**

Some vendors don't ship a plugin folder — they ship `<Plugin>.zip` in a
versioned folder and nothing else. The scan only ever looked for a loose
`.uplugin`, so such a folder came back *"No Unreal plugin found here"* about a
folder that plainly has one.

The plugin-folder scan now reads inside `.zip` files too. A zipped build is
listed like any other, with a **zip** marker beside its engine version, and the
engine it targets is worked out exactly as before: the folder path wins
(`…/Unreal Engine 5.7 Plugin/DazToHue.zip` → 5.7), falling back to the
`EngineVersion` inside the archived `.uplugin`.

Installing one **extracts** rather than copies, and lands it where Unreal
expects: everything under the archived `.uplugin`'s own folder is written to
`Plugins/<Plugin>/` with that wrapping folder stripped — a zip that wraps its
plugin in `DazToHue/` and one that holds the files at its root both come out as
`Plugins/DazToHue/DazToHue.uplugin`. Anything sitting *beside* the plugin folder
in the archive (a README, a `__MACOSX` sidecar) is not the plugin and is not
installed. Same copy-over rule as every other install: nothing is deleted first.

Reading the archive is bounded the same way the Daz asset installs are — entry
count and inflated size — and an entry whose name would escape the plugin folder
is refused rather than resolved.
