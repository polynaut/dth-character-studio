---
'@dth/web': patch
---

- **ROM frame-timeline**: a proportional, labelled strip on the character page
  showing the measured preset ROM blocks (base, GP/DK, Physics) and each custom
  section at their exact frames — driven by the same frame math as generation,
  so it visualises precisely what ships. Makes the frame-alignment invariant
  visible and surfaces config mistakes at a glance.
- **Internal**: FFI integration tests (mockIPC) covering the invoke bridge's
  request shape + zod return-validation, and `tools.tsx` (1580 lines) broken up
  into `components/tools/*` — no behaviour change.
