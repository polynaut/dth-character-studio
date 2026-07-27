---
"@dth/web": minor
---

The Genitalia ROM section and the character's gender are now driven by what's
actually in the primary Daz scene, not by hand. When a primary scene is chosen
(character create, or relinking the primary), the studio reads it once: GEN
auto-enables exactly when the scene carries a Golden Palace / Dicktator
geograft (its toggle is permanently disabled — a scene without the graft can't
run genital frames, and one with it always should), gender derives from the
figure id (gendered generations, G3 included) or the geograft (the neutral G9:
DK → male, GP → female), and a both-grafts G9 scene selects the GP+DK preset
assets explicitly. The manual Gender fields are gone — the create dialog shows
the derived value read-only, and the Identity row is display-only.

The per-scene GEN lock from the previous release is relaxed to enable-only:
GEN's on/off can't be overridden per scene (all scenes share one skeleton),
but its CONTENT is a normal per-scene override surface again — e.g. a
different art direction for a specific outfit scene. The create-character
dialog also gained the Validation table (one character, empty timeline) with a
"Create anyway" escape, mirroring the add-scene dialog.
