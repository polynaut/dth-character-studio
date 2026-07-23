---
"@dth/web": patch
"@dth/ui": patch
---

**Editor alignment polish** — three fixes to the character editor's layout:

- **Info popups never overlap the sticky header.** The "i" popup's floating box (a z-50 portal) could open straight over the header's Discard/Save actions. It now keeps clear of the header's live height — a `placement:"top"` popup with no room above the header flips below instead. Every mounted page header (editor + Settings/Tools) publishes its height as `--sticky-header-h` via a new shared `useStickyHeaderInset` hook, which the popup and the ROM sticky section/column tiers all read.
- **The "Bone scale" column header centers over its checkboxes** instead of floating off to the left (matching how the "Value" header mirrors its number cells).
- **The ROM section toggle switch is vertically centered on its summary text.** It was wrapped in a bare `<span>` that blockified as a flex item and rode its text baseline a hair high; the switch is now a direct child of the `items-center` row.
