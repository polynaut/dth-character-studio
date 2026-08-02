#!/usr/bin/env node
/**
 * PostToolUse guard: a branch created or pushed without UPSTREAM TRACKING.
 *
 * `.ai/conventions.md` calls this non-negotiable, and it was still skipped twice
 * in one day — because it is a rule an agent has to remember, at the exact
 * moment it is busy with something else. The rules that never get broken in this
 * repo are the machine-checked ones (the changeset gate, lint, the byte-identical
 * rom output), so this one becomes machine-checked too.
 *
 * Fires only on the git commands that can create the problem, so every other
 * shell call costs one JSON parse and nothing else. Exit 2 hands the message
 * back to the agent, which then fixes it in the same turn instead of leaving the
 * maintainer with "there is no tracking information for the current branch".
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** git commands that create a branch or publish one. A plain `git branch`
 *  (listing) matches too — harmless, the check below is read-only. */
const RISKY = /\bgit\b[^\n]*\b(push|switch\s+-c|checkout\s+-b|branch)\b/

function stdinJson() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const payload = stdinJson()
// Bash and PowerShell name the field differently in neither case reliably — take
// whatever string-ish field carries the command.
const command = String(payload?.tool_input?.command ?? '')
if (!RISKY.test(command)) process.exit(0)

let branch = ''
try {
  branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
} catch {
  process.exit(0) // not a git repo / detached — nothing to assert
}
// `main` is PR-only and always tracks; a detached HEAD has no branch to set.
if (branch === 'HEAD' || branch === 'main') process.exit(0)

try {
  git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  process.exit(0)
} catch {
  process.stderr.write(
    `Branch "${branch}" has NO upstream tracking — .ai/conventions.md calls this non-negotiable.\n` +
      `The maintainer's bare \`git pull\`/\`git push\` fails without it.\n\n` +
      `Fix it now, in this turn (origin stays SSH — never reconfigure the remote):\n` +
      `  git fetch <push-url> "+refs/heads/${branch}:refs/remotes/origin/${branch}"\n` +
      `  git branch --set-upstream-to=origin/${branch} ${branch}\n`,
  )
  process.exit(2)
}
