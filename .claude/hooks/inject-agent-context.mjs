#!/usr/bin/env node
/**
 * SessionStart hook: put the things that apply to EVERY task into context —
 * `.ai/philosophy.md` in full, then the "Working rules" section of
 * `.ai/conventions.md`.
 *
 * `.ai/*` is read-on-demand — and "on demand" means the agent decides, which is
 * exactly the failure these rules exist to fix. What is needed on every task
 * can't depend on the agent choosing to open the file that holds it, so this
 * reads both out of their single sources (edit the docs, the hook follows) and
 * prints them. Stdout from a SessionStart hook is added to the session's
 * context.
 *
 * Philosophy first, rules second: the rules are the mechanics, the philosophy is
 * what to do when the mechanics don't cover the case.
 */
import { readFileSync } from 'node:fs'

const read = (rel) => {
  try {
    return readFileSync(new URL(rel, import.meta.url), 'utf8')
  } catch {
    return '' // doc moved or renamed — never break a session over it
  }
}

/** A `## <heading>` section, up to the next same-level heading. */
const section = (text, heading) => {
  const start = text.indexOf(`## ${heading}`)
  if (start === -1) return ''
  const rest = text.slice(start)
  const end = rest.indexOf('\n## ', 1)
  return (end === -1 ? rest : rest.slice(0, end)).trimEnd()
}

const parts = [
  read('../../.ai/philosophy.md').trimEnd(),
  section(read('../../.ai/conventions.md'), 'Working rules'),
].filter(Boolean)

if (parts.length) process.stdout.write(`${parts.join('\n\n')}\n`)
