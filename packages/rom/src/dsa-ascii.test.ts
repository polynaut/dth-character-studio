import { describe, expect, it } from 'vitest'

import { nonAsciiStringLiterals } from './dsa-ascii'

// The scanner behind both ASCII guards (the goldens' and the bundled runtime's).
// It is the thing those two tests LEAN on, so its own edges are pinned here:
// a scanner that quietly matched nothing would turn both guards into no-ops
// that pass forever.

describe('nonAsciiStringLiterals', () => {
  it('finds a non-ASCII literal', () => {
    expect(nonAsciiStringLiterals('print("Tools → Refresh");')).toEqual([
      '"Tools → Refresh"',
    ])
  })

  it('passes a file that is entirely ASCII', () => {
    expect(nonAsciiStringLiterals('print("Tools > Refresh");')).toEqual([])
  })

  it('reads single-quoted literals too', () => {
    expect(nonAsciiStringLiterals("var s = 'em — dash';")).toEqual(["'em — dash'"])
  })

  // Comments are addressed to whoever opens the .dsa; Daz only parses them.
  it('ignores non-ASCII in a line comment', () => {
    expect(nonAsciiStringLiterals('// a comment — with an em dash\nprint("ok");')).toEqual([])
  })

  it('ignores non-ASCII in a block comment', () => {
    expect(nonAsciiStringLiterals('/* prose — here */ print("ok");')).toEqual([])
  })

  it('does not let a quote inside a COMMENT open a literal', () => {
    // The naive regex this replaced matched from the quote in one comment line
    // to the quote in the next, swallowing the prose between them — which is
    // how comment em dashes became false failures.
    const src = ['// the "scene" field — see below', '// and its "sceneName" twin', 'print("ok");'].join('\n')
    expect(nonAsciiStringLiterals(src)).toEqual([])
  })

  it('does not let a // inside a LITERAL open a comment', () => {
    expect(nonAsciiStringLiterals('var u = "http://x/—";')).toEqual(['"http://x/—"'])
  })

  it('keeps an apostrophe inside a double-quoted literal from opening one', () => {
    // Extremely common in this codebase ("the studio's data folder"), and a
    // scanner that opened a literal on it would mis-slice the rest of the file.
    expect(nonAsciiStringLiterals('print("the studio\'s folder — here");')).toEqual([
      '"the studio\'s folder — here"',
    ])
  })

  it('handles an escaped quote inside a literal', () => {
    expect(nonAsciiStringLiterals('print("say \\"hi\\" — ok");')).toEqual([
      '"say \\"hi\\" — ok"',
    ])
  })

  it('drops an unterminated quote instead of running to end of file', () => {
    // A DzScript literal cannot span lines. Treating a stray quote as an open
    // literal would swallow every real literal after it.
    expect(nonAsciiStringLiterals('var broken = "oops\nprint("→");')).toEqual(['"→"'])
  })

  it('is linear on an unterminated quote — the ReDoS shape it replaced was not', () => {
    // The regex version (`/"(?:[^"\\\n]|\\.)*"/`) rescanned to end-of-input from
    // every quote position: O(n²), flagged as js/polynomial-redos. This input is
    // that worst case; it must return promptly rather than pin a core.
    const hostile = `"${'\\"'.repeat(60_000)}`
    const started = Date.now()
    expect(nonAsciiStringLiterals(hostile)).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
