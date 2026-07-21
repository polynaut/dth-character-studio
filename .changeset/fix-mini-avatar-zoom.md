---
"@dth/web": patch
---

Fix: the mini scene-avatar in the character header's scene label lost its zoom-in + lift-up. The lift lived in an arbitrary Tailwind class (`-translate-y-[…]`) placed at the very start of a template-literal `imgClassName` — Tailwind didn't scan that token, so no rule was generated, and twMerge had already stripped the `Portrait` default's lift. Switched to a clean, always-generated fraction utility (`-translate-y-1/2`), so the label's scene thumbnail is framed on the face again like the scene cards.
