---
'@dth/web': patch
---

Export directory: drop the false "this folder is inside the project" warning. Exporting inside the project — e.g. a Perforce-tracked `characters/<Name>/houdini` folder — is a valid setup; the exporter's own character subfolder nests there fine.
