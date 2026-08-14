/**
 * The ASCII rule for Daz scripts, and the scanner that enforces it.
 *
 * **Daz cannot carry non-ASCII out of a script** (measured 2026-08-14, DS4
 * 4.24): `"Tools → Refresh assets"` written to the run log through `DzFile.write`
 * reached the studio as `Tools ? Refresh assets`, and an em dash `print`ed to the
 * Daz log arrived as mojibake (`—` → `â`). So every string a `.dsa` WRITES or
 * DISPLAYS has to be ASCII — bullets, em dashes and arrows get spelled `-` / `>`.
 *
 * This applies to both `.dsa` surfaces the studio owns, and they are guarded
 * separately because they are built differently:
 *
 *  - the **generated** carriers, emitted from the templates in `dsa.ts`
 *    (`generate-golden.test.ts` scans the goldens);
 *  - the **bundled runtime** in `apps/web/src/lib/rom/runtime/`, shipped as
 *    source and installed verbatim by `copyRuntimeFiles`
 *    (`apps/web/src/lib/rom/runtime.test.ts` scans it).
 *
 * Comments are exempt: Daz only ever parses them, and they are addressed to
 * whoever opens the `.dsa`.
 *
 * Lives here, in the pure package, so ONE scanner serves both — a guard that
 * covered only half the surface is how the runtime kept 13 violations while the
 * rule read as enforced.
 */

/**
 * Every string literal in a `.dsa`, comments skipped.
 *
 * A hand-written single pass rather than a regex, for two reasons. Comments
 * have to be skipped in the SAME walk — a quote inside a comment must not open
 * a literal, and a `//` inside a literal must not open a comment — which a
 * regex cannot do on its own. And the obvious literal regex
 * (`/"(?:[^"\\\n]|\\.)*"/`) is a polynomial-ReDoS shape: on a source with an
 * unterminated quote the engine rescans to end-of-input from every quote
 * position, O(n²) in the file size. Caller input here is a repo file, but this
 * is exported from a library and a linear scanner costs nothing (flagged by
 * CodeQL `js/polynomial-redos` on the regex version).
 *
 * Regex literals are NOT modelled — `/` outside a string is only treated as a
 * comment when the next character is `/` or `*`, which no realistic DzScript
 * regex ends in, but a contrived one could hide the rest of its line. That
 * direction is a missed violation, never a false alarm, which is the right way
 * for a ratchet to be wrong.
 */
function stringLiterals(source: string): Array<string> {
  const literals: Array<string> = []
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (char === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (char !== '"' && char !== "'") {
      i++
      continue
    }
    const start = i
    let closed = false
    i++
    while (i < source.length) {
      const c = source[i]
      // A DzScript literal cannot span lines, so a newline before the closing
      // quote means this was never a literal at all (an apostrophe in prose,
      // most likely). Dropping it keeps the scan from swallowing real code.
      if (c === '\n') break
      if (c === '\\') {
        if (source[i + 1] === '\n') break
        i += 2
        continue
      }
      i++
      if (c === char) {
        closed = true
        break
      }
    }
    if (closed) literals.push(source.slice(start, i))
  }
  return literals
}

/** Every string literal in a `.dsa` holding a character outside printable
 *  ASCII — empty for a compliant file. The literals are returned (not just a
 *  count) so a failing test names the offending text. */
export function nonAsciiStringLiterals(source: string): Array<string> {
  return stringLiterals(source).filter((literal) => /[^\x20-\x7E]/.test(literal))
}
