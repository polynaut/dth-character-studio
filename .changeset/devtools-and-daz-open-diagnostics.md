---
'@dth/desktop': patch
'@dth/web': patch
---

Enable the WebView2 inspector (right-click → Inspect, F12) in installed/release
builds, not just dev — this is a self-hosted tool and it helps debug the shipped
app against a live Daz Studio.

Make "Open in Daz" observable when a running Daz doesn't react: the bridge script
now reports a failed open with a message box (so it's no longer silent — and if
no box appears at all, the running instance never executed the forwarded script),
and the web side logs which Daz executable it launched to the console.
