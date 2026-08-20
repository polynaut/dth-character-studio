---
'@dth/web': minor
'@dth/desktop': minor
---

The **Unreal project cards** in the project footer now carry the same **Utils** wrench the Daz-scene and Houdini cards do, in place of their old install button. It opens a **Utils drawer** whose **Install** tab holds the list that used to be a modal — DTH content, the DTH Character Studio Runner, and every configured plugin build matching the project's engine version — as a full-height drawer with Install pinned to its bottom edge, so a long plugin list no longer scrolls the button out of reach.

**What is ticked for you has changed: it is now what the project is missing.** Anything already installed and current starts unticked — tick it to install it again (a checked row still overwrites). The one exception is an installed-but-outdated **DTH Character Studio Runner**: the card's amber ⚠ says "re-install it", so the drawer offers that row like an absent one and marks it *out of date*.

The card's amber ⚠ now covers both reasons a linked project still needs setting up — **no DTH content yet**, or an **out-of-date Runner** — and clicking it opens the drawer that fixes it. The wrench itself stays neutral, like every other card's.
