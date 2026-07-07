---
'@dth/desktop': patch
---

**Webview hardening: strict Content-Security-Policy + asset protocol disabled.**
The webview previously ran with no CSP and an enabled asset protocol. Now: a
strict production CSP (`default-src 'self'`, images restricted to inlined `data:`
URLs, IPC-only network, no frames/objects) with a dev-only relaxation for Vite
HMR, and the asset protocol is fully disabled — the app inlines all images and
never used it. Defense-in-depth: an XSS would now be contained by the CSP instead
of inheriting the webview's full reach.
