#!/usr/bin/env node
/**
 * PreToolUse: put the relevant measured fact in front of the agent at the exact
 * moment the action is about to happen.
 *
 * The problem this solves is not that the docs are wrong — it is that `.ai/*` is
 * retrieved by GREP, so a fact only ever helps when the agent already suspected
 * it existed. Everything else in those files is invisible by default: a lesson
 * on line 800 of `gotchas.md` is worth nothing to a session that never guessed
 * the keyword. The repo already made this call once, for branch tracking
 * (`.ai/conventions.md`): "documented as non-negotiable, skipped twice in one
 * day — so it is a check now, not a reminder." This is that principle applied to
 * the rest of them.
 *
 * **The note text is NOT stored here.** Each trigger names a doc + an anchor
 * phrase, and the bullet is extracted from the doc AT RUNTIME — the same
 * single-source shape as `inject-agent-context.mjs`. Copying ~90 measured facts
 * into a second file would have created two truths that drift; edit
 * `.ai/gotchas.md` and this hook follows. A trigger whose anchor no longer
 * resolves reports itself (see `--audit`) rather than going quietly dead.
 *
 * Deliberately NEVER blocks. `check-branch-upstream.mjs` is a gate because an
 * untracked branch is unambiguously wrong; these are context, and context that
 * can fail a turn makes every false positive expensive. Worst case here is a few
 * wasted lines.
 *
 * Cost discipline, because this runs on every shell call and every edit:
 *  - a non-match costs one JSON parse and a few regex tests, then exit 0 — the
 *    docs are only read once something has already matched;
 *  - each fact fires ONCE per session (a marker file per session+id), so a loop
 *    of ten pushes pays for the note once;
 *  - `unless` suppresses a trigger whose command already shows awareness (a
 *    smoke run that already sets SMOKE_PORT does not need telling);
 *  - each bullet is truncated to `MAX_NOTE` with a pointer to the doc.
 *
 * `node .claude/hooks/inject-gotchas.mjs --audit` verifies every anchor still
 * resolves, and is what a doc rewrite should be followed by.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TRIGGERS } from './triggers.mjs'

/** Characters of extracted bullet before it is cut short. A long bullet is
 *  still worth surfacing — the point is to say "there IS something here". */
const MAX_NOTE = 1400

const REPO = fileURLToPath(new URL('../../', import.meta.url))

const docCache = new Map()
function doc(rel) {
  if (!docCache.has(rel)) {
    try {
      docCache.set(rel, readFileSync(join(REPO, rel), 'utf8'))
    } catch {
      docCache.set(rel, '')
    }
  }
  return docCache.get(rel)
}

/**
 * The markdown bullet containing `anchor`, plus its continuation lines.
 *
 * A bullet runs from its `- ` to the next line that starts a new top-level
 * bullet or a heading; everything indented in between (sub-bullets, prose) is
 * part of it. Returns '' when the anchor is gone, which `--audit` reports.
 */
function bullet(text, anchor) {
  const hit = text.indexOf(anchor)
  if (hit === -1) return ''
  const all = text.split('\n')
  const startLine = text.slice(0, hit).split('\n').length - 1
  // Walk back to whichever comes first: the bullet's own `- ` (the anchor may
  // sit mid-bullet), or the heading opening the section — because not every
  // fact is a list item. `domain.md` writes its most important one, the
  // never-store-frame-numbers invariant, as prose under a `##`; anchoring only
  // on `- ` would walk past it and return an unrelated bullet from further up.
  let start = startLine
  while (start > 0 && !/^(- |#{1,6} )/.test(all[start])) start--
  const fromHeading = /^#{1,6} /.test(all[start])
  if (fromHeading) {
    // NOT from the heading down — from the anchor's own PARAGRAPH. A section
    // under a `##` can run to 8 KB, and `MAX_NOTE` then cuts the anchored fact
    // clean out of the note built to deliver it: measured on this table, three
    // `architecture.md` triggers injected 1400 characters of module list that
    // did not contain the fact they fired for. Neither `--audit` nor the tests
    // could see it — both stopped at "the anchor resolves". They check it now.
    // (No top-level bullet can sit between the heading and the anchor; the walk
    // above would have stopped on it. So blank line or heading is the bound.)
    start = startLine
    while (start > 0 && all[start - 1].trim() !== '' && !/^#{1,6} /.test(all[start - 1])) start--
  }
  // A bullet ends at the next bullet; a heading-anchored fact runs to the next
  // heading, so it carries the list underneath it — the frame-math invariant is
  // a paragraph whose actionable half (`presetEndFrame` returning -1, never
  // clamp it) lives in that list. The anchor is now always at the FRONT of what
  // `MAX_NOTE` bounds, so truncation costs the tail, never the fact.
  const stop = fromHeading ? /^#{1,6} / : /^(- |#{1,6} )/
  let end = start + 1
  while (end < all.length && !stop.test(all[end])) end++
  return all.slice(start, end).join('\n').trim()
}

/** Shared by the audit and the injection, so the audit judges the REAL payload. */
function truncate(text) {
  return text.length > MAX_NOTE ? `${text.slice(0, MAX_NOTE)}\n  […]` : text
}

function occurrences(text, needle) {
  let n = 0
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) n++
  return n
}

function stdinJson() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

/* ---- audit mode ------------------------------------------------------------
 * Three ways a trigger dies quietly, all of them "green" to a check that only
 * asks whether the anchor resolves:
 *   STALE      — the text moved, nothing is extracted (the obvious one);
 *   AMBIGUOUS  — the phrase now matches twice, so `indexOf` may hand back the
 *                WRONG bullet, confidently;
 *   TRUNCATED  — the extraction is longer than `MAX_NOTE` and the cut lands
 *                BEFORE the anchor, so the note delivered is real doc text that
 *                does not contain the fact it fired for.
 * The third is not hypothetical: it was true of three triggers in this table.
 */
if (process.argv.includes('--audit')) {
  let bad = 0
  const fail = (kind, t, detail) => {
    bad++
    console.error(`${kind.padEnd(10)} ${t.id}: ${detail}`)
  }
  for (const t of TRIGGERS) {
    if (!t.anchor) continue
    const text = doc(t.doc)
    const found = bullet(text, t.anchor)
    if (!found) {
      fail('STALE', t, `anchor not found in ${t.doc}\n           ${t.anchor}`)
      continue
    }
    const hits = occurrences(text, t.anchor)
    if (hits > 1) fail('AMBIGUOUS', t, `anchor matches ${hits}× in ${t.doc} — extraction takes the first`)
    if (!truncate(found).includes(t.anchor))
      fail(
        'TRUNCATED',
        t,
        `${found.length} chars extracted from ${t.doc}, anchor at ${found.indexOf(t.anchor)} — ` +
          `past the ${MAX_NOTE}-char cut, so the note would not contain the fact`,
      )
  }
  console.log(`${TRIGGERS.length} triggers, ${bad} broken`)
  process.exit(bad ? 1 : 0)
}

/* ---- normal mode ----------------------------------------------------------- */
const payload = stdinJson()
const tool = String(payload?.tool_name ?? '')
const input = payload?.tool_input ?? {}

/** Bash and PowerShell carry the command here; Edit/Write carry a path. */
const command = String(input?.command ?? '')
const path = String(input?.file_path ?? '')
if (!command && !path) process.exit(0)

const isShell = tool === 'Bash' || tool === 'PowerShell'
/* Windows paths arrive backslash-separated; every `path` pattern is written
   against forward slashes so one spelling is matched, not two. */
const normPath = path.replace(/\\/g, '/')

const matched = TRIGGERS.filter((t) => {
  if (t.shell && t.shell !== tool) return false
  if (t.command) {
    if (!isShell || !t.command.test(command)) return false
  } else if (t.path) {
    if (!normPath || !t.path.test(normPath)) return false
  } else {
    return false
  }
  return !(t.unless && t.unless.test(command))
})
if (matched.length === 0) process.exit(0)

/* Once per session per fact. A missing session id degrades to "always fire",
   which is noisier but never wrong — better than silently suppressing. */
const session = String(payload?.session_id ?? '').replace(/[^\w-]/g, '')
const seenDir = join(tmpdir(), 'dth-hook-seen', session || 'nosession')
const fresh = session
  ? matched.filter((t) => {
      const marker = join(seenDir, t.id)
      if (existsSync(marker)) return false
      try {
        mkdirSync(seenDir, { recursive: true })
        writeFileSync(marker, '')
      } catch {
        /* tmp unwritable — fire anyway rather than lose the note */
      }
      return true
    })
  : matched
if (fresh.length === 0) process.exit(0)

const notes = fresh
  .map((t) => {
    const text = t.note ?? bullet(doc(t.doc), t.anchor)
    if (!text) return '' // anchor went stale — say nothing rather than lie
    const cut = truncate(text)
    return t.doc ? `${cut}\n  ↳ ${t.doc}` : cut
  })
  .filter(Boolean)
if (notes.length === 0) process.exit(0)

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext:
        `Measured facts for what you are about to do, pulled from .ai/* automatically ` +
        `(once per session each):\n\n${notes.join('\n\n')}\n\n` +
        `NOTE ON COVERAGE — this fires from a hand-built trigger table, not from the whole ` +
        `of .ai/*. SILENCE IS NOT EVIDENCE that nothing is known about what you are doing: ` +
        `.ai/gotchas.md alone holds ~90 measured facts and only the action-tied ones have ` +
        `triggers. Still read the docs for anything non-obvious.`,
    },
  })}\n`,
)
process.exit(0)
