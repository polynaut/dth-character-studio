---
"@dth/rom": patch
"@dth/web": patch
---

Per-scene ROM overrides read consistently now. The **Bone scale** checkbox on an overridden row (a non-primary Daz scene) turns green in its active state to match the green row, instead of staying the primary orange. And editing a base row back to the base content now **disarms** the override — a toggle round-trip (e.g. bone scale on then off again, or a value edited back to its original) drops the override so the row reverts to normal instead of lingering as an identical, still-green copy. A new pure `posesEqual` helper in `@dth/rom` backs the arm-on-edit inverse.
