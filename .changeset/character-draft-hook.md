---
'@dth/web': patch
---

Internal refactor: the character editor's draft machinery (dirty tracking against the last-persisted baseline, the unsaved-changes guard, and the save → generate → settle choreography) moved out of the route into a `useCharacterDraft` hook. No behaviour change.
