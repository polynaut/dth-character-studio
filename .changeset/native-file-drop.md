---
"@dth/web": minor
"@dth/desktop": minor
---

Native OS drag-and-drop for Daz scenes (`.duf`), Houdini projects (`.hip`/`.hipnc`/`.hiplc`) and the character avatar image: drag a file from Explorer onto the **pane** where it's added — the whole area is the drop target, no need to aim at the Browse button, and it highlights while a supported file hovers it. Wired into the new-character scene picker, the editor's Daz scenes and Houdini projects fields, and the avatar image dialog. Built on Tauri's native webview drag-drop (hit-tested to the pane under the cursor), so it works with real Explorer files (HTML5 file drops don't fire when the webview captures OS drops).
