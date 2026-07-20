---
---

Docs + test tooling only: an automated guide-screenshot pipeline (`pnpm --filter @dth/web screenshots`) that regenerates every in-app guide screenshot from the smoke Tauri fake, and wires them into the guide via relative paths. No shipped app behaviour changes (the only `src/` edit gates the dev-only TanStack devtools behind a flag so it stays out of the shots). No version bump.
