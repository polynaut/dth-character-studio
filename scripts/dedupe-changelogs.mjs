// De-duplicate the CURRENT version's changelog entries across the fixed-group
// packages. A changeset naming several packages writes the identical text into
// every named CHANGELOG.md — the "version packages" PR (and the files) then
// repeat whole essays. Runs as part of `pnpm version-packages`, right after
// `changeset version`: a bullet whose text already appears in a higher-priority
// package's section of the same version is dropped; the first package keeps it.
//
// Priority: apps/desktop (the product) → apps/web → packages/rom → packages/ui.
// "Updated dependencies" blocks are per-package bookkeeping and never touched.
// Entries that genuinely differ between packages are all kept.
//
// Usage: node scripts/dedupe-changelogs.mjs   (run from the repo root)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

// Highest priority first — the keeper of duplicated entries.
const CHANGELOGS = [
  'apps/desktop/CHANGELOG.md',
  'apps/web/CHANGELOG.md',
  'packages/rom/CHANGELOG.md',
  'packages/ui/CHANGELOG.md',
]

const version = JSON.parse(
  readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'),
).version

// Same attribution prefix release-notes.mjs strips:
// `[#N](url) [`hash`](url) Thanks [@user](url)! - `.
const ATTRIBUTION = /^\[#\d+\]\([^)]*\)\s*\[`[^`]*`\]\([^)]*\)\s*Thanks\s*\[@[^\]]*\]\([^)]*\)!\s*-\s*/

/** Locate the `## <version>` section: [start, end) line indexes of its body. */
function sectionBounds(lines) {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const h2 = lines[i].match(/^## (.+?)\s*$/)
    if (h2 && start !== -1) return [start, i]
    if (h2 && h2[1].trim() === version) start = i + 1
  }
  return start === -1 ? null : [start, lines.length]
}

/**
 * Split a section body into blocks: `### …` headers, top-level `- ` bullets
 * (each carrying all its continuation lines — wrapped text, blank lines,
 * nested sub-bullets), and loose lines.
 */
function parseBlocks(lines) {
  const blocks = []
  let current = null
  const flush = () => {
    if (current) blocks.push(current)
    current = null
  }
  for (const line of lines) {
    if (/^### /.test(line)) {
      flush()
      blocks.push({ kind: 'header', lines: [line] })
    } else if (/^- /.test(line)) {
      flush()
      current = { kind: 'bullet', lines: [line] }
    } else if (current) {
      current.lines.push(line)
    } else {
      blocks.push({ kind: 'loose', lines: [line] })
    }
  }
  flush()
  return blocks
}

/** A bullet's identity: full text minus the attribution prefix, whitespace-
 *  collapsed, lowercased — identical changeset texts match across packages. */
function keyOf(block) {
  return block.lines
    .join(' ')
    .replace(/^- /, '')
    .replace(ATTRIBUTION, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const seen = new Set()
for (const rel of CHANGELOGS) {
  const file = join(root, rel)
  if (!existsSync(file)) continue
  const md = readFileSync(file, 'utf8')
  const lines = md.split('\n')
  const bounds = sectionBounds(lines)
  if (!bounds) continue
  const [start, end] = bounds

  const blocks = parseBlocks(lines.slice(start, end))
  let dropped = 0
  const kept = blocks.filter((block) => {
    if (block.kind !== 'bullet') return true
    if (/^- Updated dependencies/i.test(block.lines[0])) return true
    const key = keyOf(block)
    if (!key) return true
    if (seen.has(key)) {
      dropped++
      return false
    }
    seen.add(key)
    return true
  })
  if (dropped === 0) continue

  // Drop `### … Changes` headers whose bullets are all gone (nothing between
  // them and the next header/end but blank lines).
  const pruned = kept.filter((block, i) => {
    if (block.kind !== 'header') return true
    for (let j = i + 1; j < kept.length; j++) {
      if (kept[j].kind === 'header') return false
      if (kept[j].kind === 'bullet') return true
    }
    return false
  })

  // Reassemble, collapsing the blank-line runs the removals leave behind.
  const body = pruned
    .flatMap((b) => b.lines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
  const next = [...lines.slice(0, start), ...body.split('\n'), ...lines.slice(end)].join('\n')
  writeFileSync(file, next)
  console.log(`${rel}: dropped ${dropped} duplicated ${dropped === 1 ? 'entry' : 'entries'} for ${version}`)
}
