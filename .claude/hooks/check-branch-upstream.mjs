#!/usr/bin/env node
/**
 * PostToolUse guard: a branch pushed without UPSTREAM TRACKING fails the turn;
 * a freshly created branch gets a heads-up.
 *
 * `.ai/conventions.md` calls this non-negotiable, and it was still skipped twice
 * in one day — because it is a rule an agent has to remember, at the exact
 * moment it is busy with something else. The rules that never get broken in this
 * repo are the machine-checked ones (the changeset gate, lint, the byte-identical
 * rom output), so this one becomes machine-checked too.
 *
 * Two tiers, because a fresh branch CANNOT track yet — it does not exist on the
 * remote until its first push, so demanding the fix at create time demands the
 * impossible (both `git fetch +refs/heads/<branch>:…` and
 * `--set-upstream-to=origin/<branch>` fail against a branch the remote has
 * never seen):
 *  - `git push` from an untracked branch → exit 2 (hard gate). The branch is on
 *    the remote NOW, so the fetch + set-upstream fix in the message works.
 *  - branch creation (`switch -c/-C/--create`, `checkout -b/-B`,
 *    `worktree add -b`, `git branch …`) → exit 0 with an `additionalContext`
 *    note that leads with the step that does work first: push it.
 * Every other shell call costs one JSON parse and nothing else.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/** A real `git` invocation: `git` at command position (start of the command or
 *  right after a shell separator — so quoted TEXT like `rg "git push" docs/` or
 *  `git commit -m "rename the branch selector"` no longer matches), optional
 *  global flags (`-C <path>`, `-c k=v`, `--git-dir=…`), then the subcommand.
 *  Captures the subcommand and the rest of that invocation (up to the next
 *  separator) for flag inspection. A prefixed `VAR=x git push` / `command git
 *  push` is the accepted miss. */
const GIT_INVOCATION =
  /(?:^|[;&|(\n]|\$\()\s*git(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S*)?))*\s+(push|branch|switch|checkout|worktree)\b([^;&|\n]*)/

/** @returns {'push' | 'create' | null} what the command does to a branch */
function classify(command) {
  const m = GIT_INVOCATION.exec(command)
  if (!m) return null
  const [, sub, rest = ''] = m
  if (sub === 'push') return 'push'
  if (sub === 'switch') return /(?:^|\s)(?:-c|-C|--create)(?:\s|$)/.test(rest) ? 'create' : null
  if (sub === 'checkout') return /(?:^|\s)-[bB](?:\s|$)/.test(rest) ? 'create' : null
  if (sub === 'worktree')
    return /(?:^|\s)add(?:\s|$)/.test(rest) && /(?:^|\s)-[bB](?:\s|$)/.test(rest) ? 'create' : null
  // `git branch …` — creation and listing both land here; the check below is
  // read-only and the outcome is only ever a note, so the overreach is harmless.
  return 'create'
}

function stdinJson() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

const payload = stdinJson()
// Both Bash and PowerShell payloads carry the command in `tool_input.command`.
const command = String(payload?.tool_input?.command ?? '')
const kind = classify(command)
if (!kind) process.exit(0)

// Validate the checkout the tool actually ran in — a worktree-isolated agent's
// `cwd` is not this hook process's cwd.
const cwd =
  typeof payload?.cwd === 'string' && payload.cwd && existsSync(payload.cwd)
    ? payload.cwd
    : process.cwd()

function git(args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

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
  // fall through: no upstream
}

if (kind === 'push') {
  process.stderr.write(
    `Branch "${branch}" has NO upstream tracking — non-negotiable (.ai/conventions.md → Repo mechanics).\n` +
      `The maintainer's bare \`git pull\`/\`git push\` fails without it. The branch is on the remote\n` +
      `now (you just pushed), so fix it in this turn (origin stays SSH — never reconfigure the remote):\n` +
      `  git fetch <push-url> "+refs/heads/${branch}:refs/remotes/origin/${branch}"\n` +
      `  git branch --set-upstream-to=origin/${branch} ${branch}\n` +
      `(If the push itself failed, make it succeed first — both commands need the branch on the remote.)\n`,
  )
  process.exit(2)
}

// Fresh branch: it cannot track yet, so this is a note, not a failure — the
// `git push` gate above is the backstop that cannot be skipped.
process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `Branch "${branch}" has no upstream tracking yet — it can't, until it exists on the remote. ` +
        `Before handing back, push it and set tracking (origin stays SSH — never reconfigure the remote):\n` +
        `  git push <push-url> HEAD:refs/heads/${branch}\n` +
        `  git fetch <push-url> "+refs/heads/${branch}:refs/remotes/origin/${branch}"\n` +
        `  git branch --set-upstream-to=origin/${branch} ${branch}\n` +
        `A \`git push\` from an untracked branch fails this hook until tracking is set.`,
    },
  })}\n`,
)
process.exit(0)
