---
"@dth/web": minor
"@dth/rom": minor
---

Generated Daz scripts are now installed into a per-character subfolder —
`…/Scripts/DTH-Character-Studio/<project>/<character>/<Name>_<Genesis>.dsa` —
instead of all sitting flat in the `DTH-Character-Studio` root. The DTH runtime
(`.DthWorkflow.dsa` + `.DthUtils.dsa` + `.DthOptions.dsa`) is installed **once**
in that root, and each character script now imports it from two levels up. A
character rename moves its subfolder, and any flat-layout script left by an
earlier version is cleaned up on the next generate.
