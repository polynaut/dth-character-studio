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
 * Source with `//` and block comments removed, tracking string state so a quote
 * inside a comment cannot open a literal and a `//` inside a literal cannot open
 * a comment.
 *
 * Regex literals are NOT modelled — `/` outside a string is only treated as a
 * comment when the next character is `/` or `*`, which no realistic DzScript
 * regex ends in, but a contrived one could hide the rest of its line. That
 * direction is a missed violation, never a false alarm, which is the right way
 * for a ratchet to be wrong.
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === '"' || char === "'") {
      const quote = char
      out += char
      i++
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '')
          i += 2
          continue
        }
        out += source[i]
        // A newline ends an unterminated literal too — DzScript has no
        // multi-line string, so running past one would swallow real code.
        if (source[i] === quote || source[i] === '\n') {
          i++
          break
        }
        i++
      }
      continue
    }
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
    out += char
    i++
  }
  return out
}

/** Every string literal in a `.dsa` holding a character outside printable
 *  ASCII — empty for a compliant file. The literals are returned (not just a
 *  count) so a failing test names the offending text. */
export function nonAsciiStringLiterals(source: string): Array<string> {
  const literals = stripComments(source).match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) ?? []
  return literals.filter((literal) => /[^\x20-\x7E]/.test(literal))
}
