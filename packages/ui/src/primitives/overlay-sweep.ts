import { closeAllInfoPopups } from './info-popup.tsx'
import { closeTooltip } from './tooltip-host.tsx'

/**
 * Clear the floating layers that render ABOVE an opening overlay.
 *
 * The kit stacks dialogs and side panels at z-50, InfoPopups at `z-[60]` and
 * tooltips at `z-[100]`. The two upper layers are deliberately above so they
 * stay usable INSIDE a dialog — which also means anything left over from the
 * control that opened the dialog floats on top of it.
 *
 * {@link Modal} and {@link SidePanel} call this on open, so every dialog and
 * panel built on them is covered. **Any overlay that does NOT use those
 * primitives must call it itself** — see `update-prompt.tsx`, the one dialog in
 * the app that appears with no user gesture at all (an update check finishing),
 * where nothing else can have cleared the layers first.
 *
 * One call rather than two exported closers: a caller that remembers the sweep
 * but forgets half of it is the failure mode worth designing out.
 *
 * Cheap and safe with nothing open, so a caller never has to check.
 */
export function closeFloatingLayers() {
  closeAllInfoPopups()
  closeTooltip()
}
