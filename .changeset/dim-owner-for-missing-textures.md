---
'@dth/web': minor
'@dth/desktop': minor
---

A missing baker texture the repath cannot rehome now names the product to
reinstall. The Utils drawer's Baker-textures row searches your DIM manifests
folders (the same set the product scan reads) for each unfindable file and, when
an install manifest lists it, replaces the dead-end "reinstall the product"
with the product's name and SKU — one line per product, ready for DAZ Install
Manager. The match is on the file's folder as well as its name, so a texture
name a dozen products share cannot point you at the wrong one; a file no
manifest knows keeps today's generic wording.
