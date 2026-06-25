---
'@dth/desktop': patch
---

Fix: external links — the About page's GitHub link and links inside info popups —
now open in the system browser. The shell `open` scope was limited to `.duf` /
`.hip` paths, which silently rejected `https://` URLs; it now also allows http/https.
