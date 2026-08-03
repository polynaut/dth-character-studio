#!/usr/bin/env node
/**
 * SessionStart hook: put the "Working rules" section of `.ai/conventions.md`
 * into context at session start.
 *
 * `.ai/*` is read-on-demand — and "on demand" means the agent decides, which is
 * exactly the failure these rules exist to fix. Rules needed on EVERY task can't
 * depend on the agent choosing to open the file that holds them, so this reads
 * them out of the same single source (edit the doc, the hook follows) and prints
 * them. Stdout from a SessionStart hook is added to the session's context.
 */
import { readFileSync } from 'node:fs'

const CONVENTIONS = new URL('../../.ai/conventions.md', import.meta.url)

let text = ''
try {
  text = readFileSync(CONVENTIONS, 'utf8')
} catch {
  process.exit(0) // doc moved or renamed — never break a session over it
}

// From the "Working rules" heading to the next same-level heading.
const start = text.indexOf('## Working rules')
if (start === -1) process.exit(0)
const rest = text.slice(start)
const end = rest.indexOf('\n## ', 1)
const section = (end === -1 ? rest : rest.slice(0, end)).trimEnd()

process.stdout.write(`${section}\n`)
