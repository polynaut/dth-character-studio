---
'@dth/web': patch
---

**Rename the per-project "Assets" feature to "Attachments".**

The optional per-project feature for attaching reusable Daz `.duf` scenes (bases,
props, looks) now reads as **Attachments** everywhere in the UI — the `Enable
attachments` toggle, the `Characters / Attachments` tab, the `Character / Attachment`
add choice, and the attachment cards/messages. This removes the confusing overlap
with the Tools page's **Daz assets** install section (which installs downloaded Daz
products), so the docs no longer need a "two different things called Daz assets"
disclaimer. Internal storage is unchanged (`.assets/` folder + `assetsEnabled`
manifest key), so existing projects keep working with no migration.
