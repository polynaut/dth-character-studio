---
'@dth/web': patch
---

**ROM grid: explained columns + Houdini-safe names.**

- The **Name** and **Morph name** column headers got info popups: *Name* is the
  one value that travels to Houdini and later Unreal Engine; *Morph name* must
  exactly match the morph's internal name in Daz Studio.
- Names are now normalized as you type: letters, numbers and underscores only —
  Houdini rejects anything else, so spaces/special characters are stripped on
  commit (the same rule the CSV generator already applied).
- The **Value** column title now sits flush over its numbers instead of
  floating at the column's left edge.
- The column titles are **sticky** too: they pin right under the sticky section
  title while the grid scrolls - frame numbers, names and values always have
  their labels in view.
