---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Attachments can hold **Houdini templates**, and the Utils drawer copies from them

A template `.hip` — the skeleton setup you always use, the skin + texture-baker
setup you always use — now lives in the project beside its characters, with a
name and a description. The Utils drawer's **Source** section lists this
project's templates by name, so reusing a setup no longer starts with locating a
file.

Attachments gained a `kind` (`daz-scene` | `houdini-project`); registries written
before this read unchanged, since every one of them held Daz scenes. A Houdini
template is **always linked, never copied** — enforced in the api, not just
hidden in the form — because moving a Houdini project safely needs every
reference relative AND its `$JOB` folder travelling with it, and neither can be
verified from the studio.

The Utils side panel is also retitled: it now says which kind of thing it acts on
(**Houdini project utils**, with the project it was opened from) rather than just
the character name.
