---
'@dth/web': patch
'@dth/ui': patch
---

Adopted oxlint 1.79's six React-compiler rules (deferred in #959, tracked in
#960): all 52 flagged sites are now either genuinely fixed or carry a stated,
per-site reason. The fixes are behaviour-preserving hardening, not features:

- Latest-ref writes (`ref.current = x` during render — the drag editor, the
  unsaved-changes guard, the character draft, file drop, two kit hooks) moved
  into `useInsertionEffect`, so a render React discards can never leak into a
  ref.
- Draft-follows-prop table cells (pose/bone/morph/JCM cells, the kit's
  NumberField) now reset through the new `useDraftValue` hook — adjusted during
  render instead of one frame late from an effect, so an outside commit never
  paints the stale draft first.
- Async results that used a reset-effect (scene previews, the avatar size
  variant, the Houdini name-collision probe, the delete dialog's keep-Houdini
  probe) are now keyed by the inputs that produced them, so a stale result
  stops matching instead of needing to be cleared — a changed scene can no
  longer flash the previous scene's preview.
- The attachment form seeds its name from the picked scene at initialization /
  in the pick itself, not via effects.

Deliberate patterns (load-on-mount effects, trigger-only effect deps,
floating-ui and TanStack Table API shapes, the drawer's two-phase mount, the
live elapsed clock) keep their code and now state their reason at the site; the
six config-off entries are deleted, so the rules gate new code at full strength.
