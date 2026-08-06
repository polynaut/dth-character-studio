#!/usr/bin/env node
// Lint warning RATCHET.
//
// The repo carries a few hundred advisory warnings ON PURPOSE — `.oxlintrc.json`
// documents why each rule is a warning rather than an error (sequential awaits
// are deliberate fs ordering, `__TAURI_*` globals are the Tauri contract, the
// markdown component maps are nested by design). Those are decisions, not debt.
//
// The problem is what that volume does to a NEW warning: it is invisible. A
// fresh `no-await-in-loop` that ISN'T intentional lands in a wall of 134 that
// are, and nobody sees it.
//
// So: keep the warnings, and pin their COUNT PER RULE. Going over fails, which
// is the moment to decide whether the new instance is intentional (bump the
// baseline in the same commit, deliberately) or a mistake (fix it). Going UNDER
// also updates nothing automatically — it just reports, so a cleanup is noticed
// and the baseline tightened by hand.
//
// Usage:
//   node scripts/lint-budget.mjs           check against the baseline
//   node scripts/lint-budget.mjs --update  rewrite the baseline from reality

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASELINE = new URL('../.lint-baseline.json', import.meta.url)

/** `warning eslint(no-await-in-loop): …` → `eslint/no-await-in-loop`. */
function countByRule() {
  let out = ''
  try {
    // oxlint exits non-zero when it reports errors; warnings alone exit 0. We
    // want its output either way, so failures are captured rather than thrown.
    out = execSync('pnpm -s lint', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    out = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  const counts = {}
  for (const line of out.split('\n')) {
    const match = /warning\s+([\w-]+)\(([\w-]+)\)/.exec(line)
    if (match) {
      const rule = `${match[1]}/${match[2]}`
      counts[rule] = (counts[rule] ?? 0) + 1
    }
  }
  return counts
}

const actual = countByRule()

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(actual, null, 2)}\n`)
  const total = Object.values(actual).reduce((a, b) => a + b, 0)
  console.log(`lint baseline updated: ${Object.keys(actual).length} rules, ${total} warnings`)
  process.exit(0)
}

let baseline = {}
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  console.error('No .lint-baseline.json — create it with: node scripts/lint-budget.mjs --update')
  process.exit(1)
}

const over = []
const under = []
for (const rule of new Set([...Object.keys(baseline), ...Object.keys(actual)])) {
  const allowed = baseline[rule] ?? 0
  const now = actual[rule] ?? 0
  if (now > allowed) over.push(`  ${rule}: ${now} (baseline ${allowed}, +${now - allowed})`)
  else if (now < allowed) under.push(`  ${rule}: ${now} (baseline ${allowed})`)
}

if (under.length > 0) {
  console.log('Fewer warnings than the baseline — tighten it:')
  console.log(under.join('\n'))
  console.log('  node scripts/lint-budget.mjs --update\n')
}

if (over.length > 0) {
  console.error('New lint warnings beyond the baseline:\n')
  console.error(over.join('\n'))
  console.error(
    '\nIf the new instance is intentional, say so in the commit and run:' +
      '\n  node scripts/lint-budget.mjs --update' +
      '\nOtherwise fix it — that is the point of the ratchet.',
  )
  process.exit(1)
}

console.log('lint warnings within baseline')
