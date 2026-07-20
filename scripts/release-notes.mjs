// Assemble clean GitHub Release notes for a version from the per-package
// Changesets CHANGELOG.md files, so the release body shows the actual changes
// instead of the "chore: version packages" commit subject.
//
// Usage: node scripts/release-notes.mjs [version]
//   version defaults to apps/desktop/package.json (the product version).
//
// Prints markdown to stdout. No dependencies.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const version =
  process.argv[2] ||
  JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).version

// ALL fixed-group packages — a changeset naming only one of them must still
// reach the release body (ui-only entries used to vanish silently).
const CHANGELOGS = [
  'apps/web/CHANGELOG.md',
  'apps/desktop/CHANGELOG.md',
  'packages/rom/CHANGELOG.md',
  'packages/ui/CHANGELOG.md',
]

// Lines under `## <version>`, up to the next `## ` header.
function extractSection(md) {
  const out = []
  let inSection = false
  for (const line of md.split(/\r?\n/)) {
    const h2 = line.match(/^## (.+?)\s*$/)
    if (h2) {
      if (inSection) break
      inSection = h2[1].trim() === version
      continue
    }
    if (inSection) out.push(line)
  }
  return out
}

// Strip the Changesets attribution prefix: `[#N](url) [`hash`](url) Thanks [@user](url)! - `.
const ATTRIBUTION = /^\[#\d+\]\([^)]*\)\s*\[`[^`]*`\]\([^)]*\)\s*Thanks\s*\[@[^\]]*\]\([^)]*\)!\s*-\s*/

// Top-level bullets, with wrapped continuation lines joined; drops the internal
// "Updated dependencies" blocks and `### …Changes` sub-headers.
function parseBullets(lines) {
  const bullets = []
  let current = null
  const flush = () => {
    if (current && current.trim()) bullets.push(current.trim())
    current = null
  }
  for (const line of lines) {
    if (/^### /.test(line)) {
      flush()
      continue
    }
    const bullet = line.match(/^- (.*)$/)
    if (bullet) {
      flush()
      let text = bullet[1]
      if (/^Updated dependencies/i.test(text)) continue // internal; skip (and its indented sub-lines)
      current = text.replace(ATTRIBUTION, '')
    } else if (current !== null) {
      const cont = line.trim()
      if (cont) current += ' ' + cont
    }
  }
  flush()
  return bullets
}

const seen = new Set()
const changes = []
for (const rel of CHANGELOGS) {
  let md
  try {
    md = readFileSync(join(root, rel), 'utf8')
  } catch {
    continue
  }
  for (const bullet of parseBullets(extractSection(md))) {
    const key = bullet.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    changes.push(bullet)
  }
}

if (changes.length === 0) {
  process.stdout.write(`Release ${version}.\n`)
} else {
  process.stdout.write(`## What's changed\n\n${changes.map((c) => `- ${c}`).join('\n')}\n`)
}
