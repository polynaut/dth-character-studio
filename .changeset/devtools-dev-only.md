---
"@dth/web": patch
---

Only render the TanStack DevTools button in development — it was shipping in installed/production builds. Gated on `import.meta.env.DEV`, so the production bundle also drops the devtools code.
