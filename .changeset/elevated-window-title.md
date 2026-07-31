---
'@dth/desktop': minor
---

feat: an elevated window says so in its title bar

Running as administrator now shows `Administrator: ` at the front of the window title, the same convention Windows itself uses for an elevated terminal — a prefix rather than a suffix, so it survives the truncation in the taskbar and Alt-Tab.

It's easy to lose track of which session you're in, and an elevated one behaves differently in ways nothing else reveals: mapped network drives are per-session, so an elevated relaunch can't see your drive letters, and anything it creates ends up owned by the elevated account. Every window is marked — the launcher, each project window, and a window that reverts to the launcher after its project is deleted.
