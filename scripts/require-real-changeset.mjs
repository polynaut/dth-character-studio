#!/usr/bin/env node
// A PR that ships CODE needs a changeset that actually bumps something.
//
// `changeset status` is satisfied by an EMPTY changeset (`---\n---`), which is
// the right escape hatch for a docs/CI-only PR — it clears the gate and
// contributes nothing. Used on a code PR it is silent damage: the change
// releases with no version bump of its own and never appears in a changelog.
//
// That happened four times in one day (the $JOB fix, the UV gate, the
// cross-file expression fix, the scan cache), and each time the gate went
// green. So the gate now distinguishes the two cases instead of trusting the
// author to.
//
// Usage: node scripts/require-real-changeset.mjs <baseRef>

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const base = process.argv[2] || 'origin/main'
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

const changed = sh(`git diff --name-only ${base}...HEAD`).split('\n').filter(Boolean)

// Shipped code — what a user receives. Deliberately NOT tests, docs, workflows
// or the .ai/ notes: those genuinely have nothing to release.
const SHIP = /^(apps\/(web|desktop)\/src\/|packages\/[^/]+\/src\/|apps\/desktop\/(Cargo\.toml|Cargo\.lock)$)/
const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//.test(f)
const shipped = changed.filter((f) => SHIP.test(f) && !isTest(f))

if (shipped.length === 0) {
  console.log('No shipped code touched — an empty changeset is fine.')
  process.exit(0)
}

// Changesets ADDED by this PR (an unrelated pre-existing one must not count).
const added = sh(`git diff --name-only --diff-filter=A ${base}...HEAD -- .changeset`)
  .split('\n')
  .filter((f) => f.endsWith('.md') && !f.endsWith('README.md'))

// Non-empty = declares at least one package bump in its frontmatter.
const BUMP = /^\s*['"]?@?[\w./-]+['"]?\s*:\s*(patch|minor|major)\s*$/m
const real = added.filter((f) => {
  try {
    const [, front = ''] = readFileSync(f, 'utf8').split('---')
    return BUMP.test(front)
  } catch {
    return false
  }
})

if (real.length > 0) {
  console.log(`OK — ${real.length} changeset(s) bump a package: ${real.join(', ')}`)
  process.exit(0)
}

console.error(
  `This PR changes shipped code but adds no changeset that bumps a package.\n\n` +
    `Shipped files (${shipped.length}):\n` +
    shipped.slice(0, 12).map((f) => `  ${f}`).join('\n') +
    (shipped.length > 12 ? `\n  …and ${shipped.length - 12} more` : '') +
    `\n\nChangesets added: ${added.length === 0 ? '(none)' : added.join(', ')}` +
    (added.length > 0 ? ' — all empty.' : '') +
    `\n\nRun \`pnpm changeset\` and describe the change.\n` +
    `\`pnpm changeset --empty\` is ONLY for a docs/CI-only PR: it clears the gate\n` +
    `and contributes nothing, so the change would release with no changelog line.`,
)
process.exit(1)
