---
---

CI/docs only: adds an opt-in macOS build to the release workflow (universal .app + .dmg, Developer-ID-signed + notarized). Dormant until the repo variable `ENABLE_MAC_RELEASE=true` and the Apple secrets are set — Windows releases are unchanged. No package changes, so no version bump.
