/**
 * Linear string trims — a LEAF module: it imports nothing, so the storage layer
 * and `lib/path.ts` (which imports storage) can both use it without a cycle.
 *
 * These exist because their obvious regex forms are polynomial-backtracking
 * (CodeQL `js/polynomial-redos`, high severity): in `/\/+$/`, `/[\\/]+$/` and
 * `/[. ]+$/` the engine retries every split of the `+` against the anchor, so a
 * string of many separators costs quadratic time. The inputs here are stored
 * project/character/settings paths and user-typed names, not literals — which
 * is what turns a curiosity into an alert.
 *
 * The regex form has now been reintroduced twice after being fixed, so it lives
 * in exactly one place. See `.ai/gotchas.md`.
 */

/** Drop trailing `/` and `\` separators. */
export function stripTrailingSeparators(path: string): string {
  let out = path
  while (out.endsWith('/') || out.endsWith('\\')) out = out.slice(0, -1)
  return out
}

/** Both ends — the linear form of `/^\/+|\/+$/g`. Used where a relative
 *  subpath is normalized before joining. */
export function trimSeparators(path: string): string {
  let out = stripTrailingSeparators(path)
  while (out.startsWith('/') || out.startsWith('\\')) out = out.slice(1)
  return out
}

/** Trailing dots and spaces — Windows refuses them at the end of a file or
 *  folder name, and `/[. ]+$/` is the same backtracking shape. */
export function stripTrailingDotsAndSpaces(name: string): string {
  let out = name
  while (out.endsWith('.') || out.endsWith(' ')) out = out.slice(0, -1)
  return out
}
