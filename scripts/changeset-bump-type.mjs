#!/usr/bin/env node
// A PR that adds a CAPABILITY needs a changeset that bumps the minor.
//
// `require-real-changeset.mjs` proves a changeset exists and bumps something.
// It cannot tell whether the bump TYPE matches what the PR did — and that is
// the next thing to go wrong, because it is left to judgement:
//
//   The Defaults tab (#706) and "Make paths portable" (#709) both shipped as
//   `patch`. Two new user-facing capabilities would have released under a patch
//   version and read as bug fixes in four CHANGELOGs and the release notes —
//   caught only by a human reading the version PR (#710). The precedent they
//   should have followed was in the same file: the Utils drawer itself (#690)
//   went out as a minor.
//
// So this looks for signals that a PR ADDS something rather than fixing
// something, and fails when every changeset it adds says `patch`.
//
// The signals are deliberately few and structural. A heuristic that guesses
// from diff size or file count would cry wolf, and a gate people learn to
// ignore is worse than no gate — each of these means "the app can now do
// something it could not do before":
//
//   * a new ROUTE file            — a new page
//   * a new export from the api barrel — a new operation the UI can call
//   * a new #[tauri::command]     — a new native capability
//
// It is still a heuristic, so it has an escape hatch, and the escape hatch is
// the point: a YAML comment in the changeset's own frontmatter, which forces
// the judgement to be made and leaves it where the next reader will see it.
// Same shape as an `oxlint-disable` comment carrying the reason a deliberate
// lint exception is deliberate.
//
//   ---
//   # bump: patch is deliberate — moved an existing command, no new capability
//   '@dth/web': patch
//   ---
//
// Frontmatter comments never reach a CHANGELOG (only the body does), and
// Changesets parses them fine — both verified before this was written.
//
// Usage: node scripts/changeset-bump-type.mjs <baseRef>

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const base = process.argv[2] || 'origin/main'

// execFileSync with an ARGV ARRAY, never a command string: `execSync` goes
// through a shell, and on Windows that is cmd.exe where `^` is the escape
// character — so testing this script against `<sha>^` silently compared a
// commit with ITSELF and the whole check passed for the wrong reason. Argv
// arrays also make a path with spaces a non-issue.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const lines = (...args) => git(...args).split('\n').filter(Boolean)

/** A file's content at a ref, or '' when it didn't exist there. */
const at = (ref, file) => {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

const API_BARREL = 'apps/web/src/lib/rom/api.ts'

/**
 * Value exports of a barrel file.
 *
 * `export type { … }` is skipped on purpose: a new TYPE is not a new
 * capability, and counting it would flag every wire-format fix.
 */
function barrelExports(source) {
  const names = new Set()
  for (const match of source.matchAll(/export(\s+type)?\s*\{([^}]*)\}\s*from/g)) {
    if (match[1]) continue // `export type { … }`
    for (const raw of (match[2] ?? '').split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

const changedFiles = lines('diff', '--name-only', `${base}...HEAD`)
const addedFiles = lines('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`)

const signals = []

// 1. A new page.
for (const file of addedFiles) {
  if (/^apps\/web\/src\/routes\/.*\.tsx$/.test(file) && !file.endsWith('routeTree.gen.ts')) {
    signals.push(`new route: ${file}`)
  }
}

// 2. A new operation the UI can call. Compared as SETS rather than by reading
//    added diff lines, so reordering or reformatting the barrel proves nothing.
if (changedFiles.includes(API_BARREL)) {
  const before = barrelExports(at(base, API_BARREL))
  const after = barrelExports(at('HEAD', API_BARREL))
  for (const name of after) {
    if (!before.has(name)) signals.push(`new api export: ${name}()`)
  }
}

// 3. A new native capability.
for (const file of changedFiles) {
  if (!/^apps\/desktop\/src\/.*\.rs$/.test(file)) continue
  const added = lines('diff', '-U0', `${base}...HEAD`, '--', file).filter(
    (line) => line.startsWith('+') && /#\[tauri::command/.test(line),
  )
  if (added.length > 0) signals.push(`new native command in ${file}`)
}

if (signals.length === 0) {
  console.log('No new-capability signals — nothing to say about the bump type.')
  process.exit(0)
}

// Changesets ADDED by this PR (an unrelated pending one must not answer for it).
const addedChangesets = lines(
  'diff',
  '--name-only',
  '--diff-filter=A',
  `${base}...HEAD`,
  '--',
  '.changeset',
).filter((f) => f.endsWith('.md') && !f.endsWith('README.md'))

if (addedChangesets.length === 0) {
  // require-real-changeset.mjs owns "there is no changeset at all".
  console.log('No changeset added by this PR — that is the other gate to answer.')
  process.exit(0)
}

const BUMP = /^\s*['"]?@?[\w./-]+['"]?\s*:\s*(patch|minor|major)\s*$/gm
const MARKER = /^\s*#.*\bbump\s*:/im

// The question is whether the PR declares the capability ANYWHERE, not whether
// every changeset does. A PR may legitimately carry a feature changeset AND a
// separate one for a fix it happened to make — the release is a minor either
// way, and failing that would be a gate crying wolf on correct work.
//
// It also keeps a stacked PR honest: a branch whose base lags `main` picks up
// other PRs' changesets in `base...HEAD`, and judging by "is any of them a
// patch" made someone else's fix fail THIS PR. Measured on #715, which declared
// its own minor and was failed by #713's (correct) patch changeset riding along.
const offenders = []
let declared = false
for (const file of addedChangesets) {
  let front = ''
  try {
    ;[, front = ''] = readFileSync(file, 'utf8').split('---')
  } catch {
    continue
  }
  const bumps = [...front.matchAll(BUMP)].map((m) => m[1])
  if (bumps.length === 0) continue // empty changeset — not this gate's business
  if (bumps.some((b) => b === 'minor' || b === 'major')) {
    declared = true
    break
  }
  if (MARKER.test(front)) {
    console.log(`${file}: patch is marked deliberate — accepted.`)
    declared = true
    break
  }
  offenders.push(file)
}

if (declared || offenders.length === 0) {
  console.log('Bump type matches what this PR adds.')
  process.exit(0)
}

console.error(
  `This PR adds a capability but every changeset it adds bumps only \`patch\`.\n\n` +
    `What looks new:\n` +
    signals.map((s) => `  ${s}`).join('\n') +
    `\n\nPatch-only changeset(s):\n` +
    offenders.map((f) => `  ${f}`).join('\n') +
    `\n\nA new capability is a MINOR (the Utils drawer, #690, is the precedent).\n` +
    `Change the bump, or — if this really is a fix — record why in the\n` +
    `changeset's frontmatter, which is where the next reader will look:\n\n` +
    `  ---\n` +
    `  # bump: patch is deliberate — <why this adds nothing>\n` +
    `  '@dth/web': patch\n` +
    `  ---\n`,
)
process.exit(1)
