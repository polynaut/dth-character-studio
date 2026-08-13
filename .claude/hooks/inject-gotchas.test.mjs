#!/usr/bin/env node
/**
 * End-to-end test for `inject-gotchas.mjs`. Run it directly:
 *
 *   node .claude/hooks/inject-gotchas.test.mjs
 *
 * Not a vitest spec on purpose — the hooks are outside every workspace package
 * (they run as bare node from the repo root, before any package is built), so a
 * plain script is the thing a fresh clone can run with no install.
 *
 * Payloads are built with `JSON.stringify` and handed to the child on STDIN.
 * That is load-bearing: two earlier attempts at this test passed the JSON
 * through shell quoting and `node -e`, which ate the backslashes and reported a
 * WORKING hook as broken, then a BROKEN one as working. Never build a payload
 * on a command line.
 *
 * Pair it with `node .claude/hooks/inject-gotchas.mjs --audit`, which checks the
 * other failure mode: a doc edit that moves the text an anchor points at.
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = fileURLToPath(new URL('./inject-gotchas.mjs', import.meta.url))

/* Markers are per session id in a shared tmp dir, and Windows compares those
   paths case-insensitively — so a rerun with ids differing only in case reads
   as already-seen. Start from a clean slate. */
rmSync(join(tmpdir(), 'dth-hook-seen'), { recursive: true, force: true })

const run = (payload) => {
  const out = execFileSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' })
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : null
}

let pass = 0
let fail = 0
const check = (name, got, want) => {
  const ok = want === 'fires' ? got !== null : got === null
  ok ? pass++ : fail++
  const head = got?.split('\n').find((l) => l.trim().startsWith('- '))?.slice(0, 56) ?? ''
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${got ? 'fired ' : 'silent'} ${head}`)
}
const edit = (file_path, session_id) => run({ tool_name: 'Edit', tool_input: { file_path }, session_id })
const bash = (command, session_id) => run({ tool_name: 'Bash', tool_input: { command }, session_id })

/* Windows backslash paths MUST fire — this environment passes no other kind,
   and a `path` regex written only for forward slashes silently matches none of
   them. That bug shipped in the first cut of this hook. */
check('windows abs path', edit('D:\\dth\\packages\\rom\\src\\types.ts', 'w1'), 'fires')
check('posix path', edit('packages/rom/src/types.ts', 'w2'), 'fires')
check('windows rust path', edit('D:\\dth\\apps\\desktop\\src\\windows.rs', 'w3'), 'fires')
check('windows route path', edit('D:\\dth\\apps\\web\\src\\routes\\settings.tsx', 'w4'), 'fires')

check('git push', bash('git push origin HEAD', 'c1'), 'fires')
check('git push again (dedupe)', bash('git push origin HEAD', 'c1'), 'silent')
check('git push WITH token (unless)', bash('AUTH=$(printf x-access-token:x); git push https://x HEAD:b', 'c2'), 'silent')
check('smoke without SMOKE_PORT', bash('pnpm --filter @dth/web smoke', 'c3'), 'fires')
check('smoke WITH SMOKE_PORT (unless)', bash('SMOKE_PORT=4399 pnpm smoke', 'c4'), 'silent')
check('cargo update', bash('cargo update -p brotli', 'c5'), 'fires')

check('harmless ls', bash('ls -la', 'n1'), 'silent')
check('quoted "git push" in a grep', bash('rg "git push" docs/', 'n2'), 'silent')
check('unrelated file', edit('D:\\dth\\README.md', 'n3'), 'silent')
check('PowerShell trigger under Bash', bash('Get-Content foo.ts', 'n4'), 'silent')
check(
  'PowerShell trigger under PowerShell',
  run({ tool_name: 'PowerShell', tool_input: { command: 'Get-Content foo.ts' }, session_id: 'n5' }),
  'fires',
)

/* The payload must be the REAL doc bullet, must point at its source, and must
   say that silence proves nothing — a table that reads as exhaustive teaches
   the next session that no warning means nothing to know. */
const sample = bash('cargo update', 'x1')
for (const [n, v] of [
  ['extracts real doc text', sample?.includes('alloc-no-stdlib') ?? false],
  ['carries the coverage caveat', sample?.includes('SILENCE IS NOT EVIDENCE') ?? false],
  ['points at the source doc', sample?.includes('.ai/gotchas.md') ?? false],
]) {
  v ? pass++ : fail++
  console.log(`${v ? 'ok  ' : 'FAIL'}  ${n}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
