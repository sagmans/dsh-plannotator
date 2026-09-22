/**
 * Build the argv this plugin hands to the CLI.
 *
 * Two rules shape this module. First, the reviewer's input never becomes shell
 * syntax: argv is an array handed to `spawn` with `shell: false`, and the
 * plugin's own flags are appended here rather than accepted from the command
 * line, so a typed flag cannot change what the plugin means to run. Second,
 * the CLI's flag surface is allowlisted per subcommand: an unknown dashed token
 * is refused with usage text instead of being forwarded, because the CLI's own
 * argument tolerance would otherwise turn a typo into a different review.
 *
 * @module dsh-plannotator/args
 */

import {
  CLI_ANNOTATE,
  CLI_ANNOTATE_LAST,
  CLI_REVIEW,
  FLAG_APP,
  FLAG_BASE,
  FLAG_DIFF_TYPE,
  FLAG_GATE,
  FLAG_GIT,
  FLAG_GITBUTLER,
  FLAG_JSON,
  FLAG_LOCAL,
  FLAG_MARKDOWN,
  FLAG_NO_GIT_REMOTE_CHECK,
  FLAG_NO_JINA,
  FLAG_NO_LOCAL,
  FLAG_RENDER_HTML,
  FLAG_REQUIRE_APPROVAL,
  FLAG_STATIC,
  FLAG_STDIN,
  FLAG_TAILSCALE,
} from './constants.ts'

/** One accepted flag: whether it consumes the following token as its value. */
export interface FlagSpec {
  readonly flag: string
  readonly takesValue: boolean
}

/** Flags `plannotator review` accepts from a typed line. */
export const REVIEW_FLAGS: readonly FlagSpec[] = [
  { flag: FLAG_GIT, takesValue: false },
  { flag: FLAG_GITBUTLER, takesValue: false },
  { flag: FLAG_BASE, takesValue: true },
  { flag: FLAG_DIFF_TYPE, takesValue: true },
  { flag: FLAG_LOCAL, takesValue: false },
  { flag: FLAG_NO_LOCAL, takesValue: false },
  { flag: FLAG_NO_GIT_REMOTE_CHECK, takesValue: false },
  { flag: FLAG_TAILSCALE, takesValue: false },
]

/** Flags `plannotator annotate` accepts from a typed line. */
export const ANNOTATE_FLAGS: readonly FlagSpec[] = [
  { flag: FLAG_MARKDOWN, takesValue: false },
  { flag: FLAG_NO_JINA, takesValue: false },
  { flag: FLAG_APP, takesValue: false },
  { flag: FLAG_STATIC, takesValue: false },
  { flag: FLAG_RENDER_HTML, takesValue: false },
  { flag: FLAG_TAILSCALE, takesValue: false },
]

/** Parsed typed line: recognized flags in order, plus the non-flag tokens. */
export interface ParsedLine {
  readonly flags: readonly string[]
  readonly positionals: readonly string[]
}

/** A parse either yields the line's parts or the text telling the reader what is accepted. */
export type ParseResult =
  | { readonly ok: true; readonly value: ParsedLine }
  | { readonly ok: false; readonly error: string }

/** Options shared by every builder. */
export interface BuildOptions {
  /** `config.tailscale`: publish the session over the tailnet. */
  readonly tailscale: boolean
}

/**
 * Parse a typed command line against one allowlist.
 *
 * Only `--flag` tokens are validated; anything else is a positional the caller
 * resolves (a path, a folder, a URL). A `--` terminator is not honoured: the
 * CLI has no use for one, and accepting it would let an unknown token through.
 *
 * @param tokens - whitespace-split typed input.
 * @param allowlist - flags this subcommand accepts.
 * @returns the flags and positionals, or usage text naming the first bad token.
 */
export function parseTypedLine(tokens: readonly string[], allowlist: readonly FlagSpec[]): ParseResult {
  const byName = new Map(allowlist.map((spec) => [spec.flag, spec]))
  const flags: string[] = []
  const positionals: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || token === '') continue
    if (!token.startsWith('-')) {
      positionals.push(token)
      continue
    }
    const spec = byName.get(token)
    if (spec === undefined) {
      const accepted = allowlist.map((entry) => entry.flag).join(' ')
      return { ok: false, error: 'unknown option ' + token + '; accepted: ' + accepted }
    }
    flags.push(token)
    if (spec.takesValue) {
      const value = tokens[index + 1]
      if (value === undefined) return { ok: false, error: token + ' requires a value' }
      flags.push(value)
      index += 1
    }
  }
  return { ok: true, value: { flags, positionals } }
}

/**
 * Build the gated-annotate argv used for plan review and file annotation.
 *
 * `--require-approval` is what makes the exit code a verdict, so a review that
 * ends in a browser crash is distinguishable from one the human declined.
 *
 * @param target - a file, folder, or URL already vetted by the caller.
 * @param options - shared build options.
 * @returns argv for `plannotator annotate`.
 */
export function buildAnnotateArgs(target: string, options: BuildOptions): string[] {
  return withTailscale(
    [CLI_ANNOTATE, target, FLAG_GATE, FLAG_JSON, FLAG_REQUIRE_APPROVAL],
    options,
  )
}

/**
 * Build the argv for annotating the newest assistant message.
 *
 * The message travels on stdin because it exists only in this process' session
 * log; `--stdin` is the CLI's documented way to hand it over without writing a
 * copy to disk. `--require-approval` is deliberately absent: the CLI documents
 * the strict exit-code contract for `annotate` only.
 *
 * @param options - shared build options.
 * @returns argv for `plannotator annotate-last`.
 */
export function buildAnnotateLastArgs(options: BuildOptions): string[] {
  return withTailscale([CLI_ANNOTATE_LAST, FLAG_STDIN, FLAG_GATE, FLAG_JSON], options)
}

/**
 * Build the argv for a code review of the working tree or a pull request.
 *
 * @param parsed - the allowlisted flags and positionals from the typed line.
 * @param options - shared build options.
 * @returns argv for `plannotator review`.
 */
export function buildReviewArgs(parsed: ParsedLine, options: BuildOptions): string[] {
  return withTailscale([CLI_REVIEW, ...parsed.flags, ...parsed.positionals, FLAG_JSON], options)
}

/**
 * Append the tailnet flag only when it is in force, so the default argv stays minimal.
 *
 * A typed `--tailscale` and a configured one mean the same thing; appending a
 * second copy would make the flag's arity the CLI's problem rather than ours.
 */
function withTailscale(argv: readonly string[], options: BuildOptions): string[] {
  if (!options.tailscale || argv.includes(FLAG_TAILSCALE)) return [...argv]
  return [...argv, FLAG_TAILSCALE]
}

/**
 * Decide whether a positional target is a URL or a filesystem path.
 *
 * The distinction matters because only paths are existence-checked, and only
 * `http(s)` reaches the CLI's fetcher: another scheme would make the CLI open a
 * resource the reviewer did not name.
 *
 * @param token - the candidate target.
 * @returns the target kind, or `undefined` for a token that is neither.
 */
export function classifyTarget(token: string): 'url' | 'path' | undefined {
  if (token === '') return undefined
  if (token.startsWith('-')) return undefined
  if (/^https?:\/\//u.test(token)) return 'url'
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(token)) return undefined
  return 'path'
}
