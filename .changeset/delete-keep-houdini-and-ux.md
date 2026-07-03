---
'@dth/web': patch
---

Smaller UX fixes:

- **Delete can keep the Houdini files.** When a character's folder has a Houdini subfolder, the delete dialog now offers a second toggle to keep it on disk — mirroring the existing "keep the Daz files" option, and shown only when such a folder actually exists.
- **Avatar picker works with a single linked scene.** The scene-thumbnail choices in the avatar dialog now appear whenever at least one Daz scene is linked (previously they only showed with two or more), so you can switch the avatar back after unlinking a second scene.
- **Settings → General is split into two panels:** the settings you can change, and a read-only panel for the app-data folder and detected network drives. The refresh-assets controls have moved out to their own Tools tab.
