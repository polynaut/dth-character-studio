---
# bump: patch is deliberate — a startup-order fix. No new route, no new api
# export, no new command; what the app can DO is unchanged, only when it draws.
'@dth/web': patch
---

A project window opens on its project, instead of flashing the Home screen first.

Opening a project window painted the Home "recent projects" list for a moment
and then jumped to the project's character overview. That was the boot order,
not a hiccup: every window loads the same document, so the URL it starts on says
nothing about which project it is for — the studio had to ask the desktop side,
and it mounted the UI before the answer came back. Home's screen needs one small
read while a project's needs a manifest read plus a character scan, so Home
always drew first, and the correction landed later the more characters the
project had.

The window now works out where it belongs — and loads it — before anything is
drawn, so it goes from its own dark background straight to the character
overview. The lookups it needs run together rather than one after the other, so
the window is ready sooner as well. A project window also no longer leaves a
Home entry behind it in history.
