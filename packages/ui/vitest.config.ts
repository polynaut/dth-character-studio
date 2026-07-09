import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The kit is presentational React — tests render components in jsdom (each test
// file opts in via the `// @vitest-environment jsdom` pragma). The React plugin
// supplies the JSX transform.
export default defineConfig({
  plugins: [react()],
})
