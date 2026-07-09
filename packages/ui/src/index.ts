// @dth/ui — app-agnostic React UI kit. No Tauri / router / filesystem imports:
// host behaviour (link navigation, external-open) is injected via UiConfig.

// Utilities
export { cn } from './cn.ts'

// Host-behaviour injection seam
export { UiConfigProvider, useUiConfig } from './config.tsx'
export type { UiConfig } from './config.tsx'

// Primitives
export { Button, buttonVariants } from './primitives/button.tsx'
export { Input } from './primitives/input.tsx'
export { Label } from './primitives/label.tsx'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './primitives/select.tsx'
export { SidePanel } from './primitives/side-panel.tsx'
export { Slider } from './primitives/slider.tsx'
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
export { RemoveAssetDialog } from './components/remove-asset-dialog.tsx'
export { KeyedListEditor } from './components/keyed-list-editor.tsx'
export { LinkedAssetCard } from './components/linked-asset-card.tsx'

// Hooks
export { useModifierHeld } from './hooks/use-modifier-held.ts'
export { installAltMenuGuard } from './hooks/alt-menu-guard.ts'
export { useRefetchOnFocus } from './hooks/use-refetch-on-focus.ts'
