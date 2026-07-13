---
'@dth/web': patch
'@dth/desktop': patch
---

Fix "Open in Daz" launching the scene-open bridge script in a text editor instead
of Daz Studio. Opening a scene while Daz is already running writes a one-shot
`.dsa` and previously shell-opened it, which follows the OS file association — on
machines where `.dsa` is bound to an editor (e.g. VS Code on a dev box) the script
just opened as text and the scene never loaded. The bridge now launches the
running Daz instance's own executable with the script as its argument
(association-independent), and only falls back to the shell-open if the executable
can't be located.
