---
'@dth/web': minor
'@dth/desktop': minor
---

The ✨ **Generate project** button is gone from the Unreal projects bar.

Creating an Unreal project is Unreal's own job: its New Project screen is where
the templates live (Third Person, Blueprint vs C++, starter content), and which
one a production starts from is a decision worth making there. What the studio
generated instead was a bare Blueprint project with empty `Content/` and
`Config/` folders — no template, which is almost never what you actually want.

Nothing else changes: link a `.uproject` you made in Unreal with **Add project**
(or by dropping it on the bar), then use the card's install button for the DTH
content and plugins exactly as before. Engine detection in **Settings** stays —
it is what matches plugin builds to each project.
