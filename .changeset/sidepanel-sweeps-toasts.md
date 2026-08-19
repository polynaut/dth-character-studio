---
"@dth/ui": patch
"@dth/web": patch
---

Opening a side panel now dismisses any toasts still on screen. Toasts stack above the drawer layer and outlive the action that raised them, so a stale one — an old export report, a copied-path notice — floated over the drawer as it slid in. The drawer's open sweep (the one that already clears leftover info popups and tooltips) now clears the toasts too.
