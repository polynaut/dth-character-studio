---
'@dth/desktop': minor
'@dth/web': minor
---

Installing the Daz Studio plugins no longer means restarting the whole studio as
administrator.

Copying two DLLs into `<Daz>/plugins` was the only thing that ever needed
administrator rights, but the price was paid by the entire session: an elevated
studio cannot see your mapped network drives, Windows silently blocks
drag-and-drop into an elevated window, and everything it writes afterwards ends
up owned by the administrator.

Now the plugin install borrows those rights for the copy alone. When a copy is
refused for permissions, the report offers **Install with administrator rights** —
one Windows prompt for the whole batch, performed by a short-lived helper, with
the studio window left exactly as unelevated as it was. Declining the prompt is
reported as the choice it is, not as an error.

A plugin Daz Studio has loaded is a different problem, and the install now says
so instead of blaming permissions: administrator rights cannot unlock a loaded
DLL, so that failure asks you to close Daz and offers no elevation button.
