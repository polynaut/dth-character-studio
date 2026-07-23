// @dth/ui — app-agnostic React UI kit. No Tauri / router / filesystem imports:
// host behaviour (link navigation, external-open) is injected via UiConfig.

// Utilities
export { cn } from './cn.ts'

// Host-behaviour injection seam. useUiConfig stays internal (kit components
// import it via './config.tsx') — the app only ever provides the config, and
// the provider's props are inferred, so the UiConfig type itself stays internal.
export { UiConfigProvider } from './config.tsx'

// Primitives
// The public surface is only what the app consumes. Internal-only helpers
// (buttonVariants, the Select scroll buttons / group / label / separator) stay
// in their own modules but are deliberately NOT re-exported here.
export { Button } from './primitives/button.tsx'
export { Input } from './primitives/input.tsx'
export { Label } from './primitives/label.tsx'
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './primitives/select.tsx'
export { Modal } from './primitives/modal.tsx'
export { SidePanel } from './primitives/side-panel.tsx'
export { Switch } from './primitives/switch.tsx'
export { Tabs, TabsContent, TabsList, TabsTrigger } from './primitives/tabs.tsx'
export { Textarea } from './primitives/textarea.tsx'
export { TooltipHost } from './primitives/tooltip-host.tsx'
export { InfoPopup } from './primitives/info-popup.tsx'

// Components
export { Tag } from './components/tag.tsx'
export { EditableTitle } from './components/editable-title.tsx'
export { Field } from './components/field.tsx'
export { NumberField } from './components/number-field.tsx'
export { OverrideMark } from './components/override-mark.tsx'
export { RemoveAssetDialog } from './components/remove-asset-dialog.tsx'
export { KeyedListEditor } from './components/keyed-list-editor.tsx'
export { MultiSelect } from './components/multi-select.tsx'
export { LinkedAssetCard } from './components/linked-asset-card.tsx'

// Hooks
export { useModifierHeld } from './hooks/use-modifier-held.ts'
export { installAltMenuGuard } from './hooks/alt-menu-guard.ts'
export { useRefetchOnFocus } from './hooks/use-refetch-on-focus.ts'
export { useStickyHeaderInset } from './hooks/use-sticky-header-inset.ts'
