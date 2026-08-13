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

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASELINE = new URL('../.lint-baseline.json', import.meta.url)

/** `warning eslint(no-await-in-loop): …` → `eslint/no-await-in-loop`. */
function countByRule() {
  // BOTH streams, unconditionally, whatever the exit code.
  //
  // This used to take `execSync`'s RETURN VALUE — which is stdout only — and
  // merge stderr in only from the `catch`. oxlint exits 0 when it reports
  // nothing but warnings, so the catch never ran, and on any platform where
  // oxlint writes its diagnostics to stderr the capture was EMPTY. Empty parse
  // → every rule counts 0 → 0 is under every baseline → the ratchet passed.
  //
  // Measured 2026-08-13, from one CI job's own log:
  //     Found 223 warnings and 0 errors.        <- the `pnpm lint` step
  //     oxc/no-map-spread: 0 (baseline 9)       <- this script, same job
  //     eslint/no-await-in-loop: 0 (baseline 155)
  // The gate had never been capable of failing since it was added in #694, which
  // is why the baseline sat untouched from 2026-08-10 while warnings accumulated
  // and every PR stayed green. It worked locally (Windows: stdout), which is the
  // worst version of this bug — the one place it reported honestly was the one
  // place nobody was gating on it.
  // `--format=json`, NOT the human output. The human format is not stable
  // across environments and this script parsed it for months: the same 223
  // warnings rendered as 60,354 bytes locally (Windows) and 47,019 bytes on
  // ubuntu CI — measured 2026-08-13 from the runner's own
  // `stdout=47019b stderr=0b` against a local run. Whatever the rendering
  // difference is (it is NOT the stream, NOT ANSI colour, and NOT `CI` /
  // `GITHUB_ACTIONS` — all three were tested and ruled out), a text format
  // meant for humans is simply the wrong contract for a gate. JSON is the
  // machine one: `{"diagnostics":[{"code":"oxc(no-map-spread)","severity":…}]}`.
  //
  // One command STRING, not command+args: `shell: true` with an args array is
  // Node DEP0190 and prints a deprecation into every CI log. `shell` itself is
  // required — on Windows `pnpm` is a `.cmd` shim that cannot be spawned
  // directly. `maxBuffer` is raised because the JSON of a few hundred
  // diagnostics comfortably exceeds Node's 1 MB default, and an overflow would
  // truncate the capture into exactly the silent under-count this whole change
  // exists to prevent.
  const run = spawnSync('pnpm -s lint --format=json', {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const counts = {}
  try {
    // Slice from the first `{` so a stray banner line can't break the parse.
    const parsed = JSON.parse(out.slice(out.indexOf('{')))
    for (const d of parsed.diagnostics ?? []) {
      if (d.severity !== 'warning') continue
      const m = /^([\w-]+)\(([\w-]+)\)/.exec(d.code ?? '')
      if (!m) continue
      const rule = `${m[1]}/${m[2]}`
      counts[rule] = (counts[rule] ?? 0) + 1
    }
  } catch {
    // Fall through to the zero-parse guard below, which reports properly.
  }
  // A ratchet that parsed NOTHING must never report "under budget". That is
  // precisely the failure above, and from the outside it is indistinguishable
  // from a clean tree. This repo carries hundreds of advisory warnings BY
  // DESIGN (see .oxlintrc.json), so zero means the measurement broke — the
  // output format moved, the lint script moved, oxlint failed to start — and
  // never that there is nothing to count. Fail loud instead of green.
  if (Object.keys(counts).length === 0) {
    console.error('lint-budget parsed NO warnings out of `pnpm -s lint`.\n')
    console.error('That is a broken ratchet, not a clean tree: this repo carries hundreds')
    console.error('of advisory warnings on purpose. Check that the lint script still runs')
    console.error('and that its output format still matches the parser in this file.\n')
    console.error(
      `  exit=${run.status} signal=${run.signal} ` +
        `stdout=${(run.stdout ?? '').length}b stderr=${(run.stderr ?? '').length}b`,
    )
    if (run.error) console.error(`  spawn error: ${run.error.message}`)
    process.exit(1)
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
