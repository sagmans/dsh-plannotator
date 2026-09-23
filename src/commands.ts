/**
 * The four human commands, and the one place a review is actually run.
 *
 * Each handler follows the same shape — vet the input, resolve the executable,
 * run one child, map its verdict, tell the model, notice the reader — because
 * the differences between the surfaces are only their argv and what counts as a
 * target. Keeping that shape in one helper is what makes the error paths
 * uniform: a missing binary, a cancelled review, and a refused flag all reach
 * the reader as the same kind of notice.
 *
 * @module dsh-plannotator/commands
 */

import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import {
  ANNOTATE_FLAGS,
  buildAnnotateArgs,
  buildAnnotateLastArgs,
  buildReviewArgs,
  classifyTarget,
  parseTypedLine,
  REVIEW_FLAGS,
  type ParsedLine,
} from './args.ts'
import {
  NODE_BINARY_PROBE,
  resolveBinary,
  type BinaryProbe,
} from './binary.ts'
import { runPlannotator, type RunResult } from './cli.ts'
import {
  resolveDataDir,
  resolvePlansDir,
  type PlannotatorConfig,
} from './config.ts'
import {
  COMMAND_ANNOTATE,
  COMMAND_LAST,
  COMMAND_PLAN,
  COMMAND_REVIEW,
} from './constants.ts'
import {
  outcomeFromAnnotate,
  outcomeFromAnnotateLast,
  outcomeFromReview,
  type OutcomeResult,
  type ReviewOutcome,
} from './decisions.ts'
import { feedbackFor, steerText } from './feedback.ts'
import { newestPlan } from './plan-source.ts'
import { newestAssistantText } from './transcript.ts'
import { planSnapshotPath, writePlanSnapshot } from './workspace.ts'

/** What one review surface needs that is not in the config. */
export interface CommandDeps {
  /** Resolved plugin config. */
  readonly config: PlannotatorConfig
  /** Environment for binary lookup and for the child. */
  readonly env: NodeJS.ProcessEnv
  /** Owner expected on the executable; `undefined` on platforms without one. */
  readonly uid: number | undefined
  /** Filesystem probe for binary resolution. */
  readonly probe: BinaryProbe
  /** Read the current time, so tests can pin snapshot names. */
  readonly now: () => number
  /** Filesystem calls snapshot writing uses. */
  readonly snapshotIo: Parameters<typeof writePlanSnapshot>[3]
}

/** Which surface produced an outcome; it decides the wording the reader sees. */
type Surface = 'plan' | 'review' | 'annotate' | 'last'

/** The session's working directory, which is what the review must run against. */
function sessionCwd(agent: Agent): string {
  const cwd = agent.session.header.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/** Resolve a typed path against the session's directory. */
function resolveTypedPath(cwd: string, token: string): string {
  return isAbsolute(token) ? token : resolve(cwd, token)
}

/** How a surface's notice reads once the review settled and feedback was routed. */
function notice(surface: Surface, outcome: ReviewOutcome, steered: boolean): string {
  const approved = outcome.decision === 'approved'
  const subject =
    surface === 'plan' ? 'plan' : surface === 'review' ? 'code review' : 'annotation'
  if (approved) return subject + ' approved'
  if (steered) return subject + ' feedback sent to the agent'
  return subject + ' closed without feedback'
}

/** Everything one run needs, after the caller vetted the target. */
interface RunOptions {
  readonly ctx: Context
  readonly deps: CommandDeps
  readonly agent: Agent
  readonly signal: AbortSignal
  readonly surface: Surface
  readonly target: string
  readonly argv: readonly string[]
  readonly stdin: string | undefined
  readonly map: (result: RunResult) => OutcomeResult
  readonly inFlight: Set<AbortController>
  readonly busy: { current: boolean }
}

/**
 * Run one review and report it.
 *
 * @param options - the vetted target, argv, decision mapper, and shared state.
 * @returns the command result the surface renders.
 */
async function runOne(options: RunOptions): Promise<CommandResult> {
  const { ctx, deps, agent, surface } = options
  if (options.busy.current) {
    return { kind: 'error', text: 'a plannotator review is already open; finish it before starting another' }
  }
  const cwd = sessionCwd(agent)
  const resolution = resolveBinary({
    configured: deps.config.binary,
    allowUntrusted: deps.config.allowUntrustedBinary,
    env: deps.env,
    cwd,
    uid: deps.uid,
    probe: deps.probe,
  })
  if (!resolution.ok) {
    return { kind: 'error', text: 'plannotator: ' + resolution.reason }
  }

  // The command's own signal is not enough: unloading the plugin has to stop a
  // review too, so one controller owns the child for both cancellation paths.
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort()
  if (options.signal.aborted) controller.abort()
  else options.signal.addEventListener('abort', forwardAbort, { once: true })
  options.inFlight.add(controller)
  options.busy.current = true

  try {
    const result = await runPlannotator({
      binary: resolution.path,
      argv: options.argv,
      cwd,
      env: deps.env,
      stdin: options.stdin,
      timeoutMs: deps.config.reviewTimeoutMs,
      signal: controller.signal,
    })
    const mapped = options.map(result)
    if (!mapped.ok) {
      ctx.logger.warn(`${surface} review failed: ${mapped.error}`)
      return { kind: 'error', text: 'plannotator: ' + mapped.error }
    }
    const message = deps.config.steerFeedback
      ? feedbackFor(mapped.outcome, options.target, deps.config.approveNotes)
      : undefined
    if (message !== undefined) steerText(agent, message)
    return { kind: 'success', text: notice(surface, mapped.outcome, message !== undefined) }
  } finally {
    options.signal.removeEventListener('abort', forwardAbort)
    options.inFlight.delete(controller)
    options.busy.current = false
  }
}

/**
 * Vet a typed target that must exist on disk.
 *
 * @param cwd - the session's directory.
 * @param token - the typed operand.
 * @param want - the kind of entry the surface accepts.
 * @returns the absolute path, or the usage text to report.
 */
function existingPath(
  cwd: string,
  token: string,
  want: 'file' | 'entry',
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
  const path = resolveTypedPath(cwd, token)
  if (!existsSync(path)) return { ok: false, error: path + ' does not exist' }
  const facts = statSync(path)
  if (want === 'file' && !facts.isFile()) return { ok: false, error: path + ' is not a file' }
  return { ok: true, path }
}

/** Enforce the input bound before anything is written or piped. */
function oversize(text: string, limit: number): boolean {
  return Buffer.byteLength(text, 'utf8') > limit
}

/** Read one positional at most, so a second operand fails loudly. */
function singleOperand(parsed: ParsedLine): string | undefined | null {
  if (parsed.positionals.length === 0) return undefined
  if (parsed.positionals.length === 1) return parsed.positionals[0] ?? undefined
  return null
}

/**
 * Register every plannotator command on the command registry.
 *
 * @param ctx - context carrying the command registry (and its logger).
 * @param deps - config and the injectable environment.
 * @returns disposer that unregisters and stops any review still running.
 */
export function registerPlannotatorCommands(ctx: Context, deps: CommandDeps): () => void {
  const inFlight = new Set<AbortController>()
  const busy = { current: false }
  const plansDir = resolvePlansDir(resolveDataDir(deps.config, deps.env))

  const definitions: CommandDefinition[] = [
    {
      name: COMMAND_PLAN,
      description: 'Review the latest plan (or a markdown file) in the browser and return the decision',
      input: { hint: '[file.md] [--markdown] [--no-jina] [--tailscale]' },
      handler: async (invocation) => {
        const parsed = parseTypedLine(invocation.rawInput.trim().split(/\s+/u), ANNOTATE_FLAGS)
        if (!parsed.ok) return { kind: 'error', text: parsed.error }
        const operand = singleOperand(parsed.value)
        if (operand === null) return { kind: 'error', text: 'usage: /' + COMMAND_PLAN + ' [file.md]' }

        let target: string
        if (operand !== undefined) {
          if (classifyTarget(operand) !== 'path') {
            return { kind: 'error', text: 'usage: /' + COMMAND_PLAN + ' [file.md] — a URL has no plan to review' }
          }
          const vetted = existingPath(sessionCwd(invocation.agent), operand, 'file')
          if (!vetted.ok) return { kind: 'error', text: vetted.error }
          target = vetted.path
        } else {
          const plan = newestPlan(invocation.agent.session.snapshotEvents())
          if (plan === undefined) {
            return {
              kind: 'error',
              text: 'no plan in this session yet; pass a markdown file: /' + COMMAND_PLAN + ' plan.md',
            }
          }
          if (oversize(plan, deps.config.maxInputBytes)) {
            return { kind: 'error', text: 'the plan is larger than maxInputBytes; write it to a file and pass the path' }
          }
          // The snapshot path is what the reviewer's URL and the CLI's plan
          // history both key on, so it is resolved before the run, not after.
          const written = writePlanSnapshot(plansDir, invocation.agent.session.id, plan, deps.snapshotIo)
          if (!written.ok) {
            return { kind: 'error', text: 'could not write the plan snapshot: ' + written.error }
          }
          target = planSnapshotPath(plansDir, invocation.agent.session.id)
        }

        return runOne({
          ctx,
          deps,
          agent: invocation.agent,
          signal: invocation.signal,
          surface: 'plan',
          target,
          argv: buildAnnotateArgs(target, { tailscale: deps.config.tailscale }),
          stdin: undefined,
          map: outcomeFromAnnotate,
          inFlight,
          busy,
        })
      },
    },
    {
      name: COMMAND_REVIEW,
      description: 'Review working-tree changes or a pull request in the browser',
      input: { hint: '[--git|--gitbutler] [--base <ref>] [--diff-type <type>] [--no-local] [--tailscale] [PR_URL]' },
      handler: async (invocation) => {
        const parsed = parseTypedLine(invocation.rawInput.trim().split(/\s+/u), REVIEW_FLAGS)
        if (!parsed.ok) return { kind: 'error', text: parsed.error }
        const operand = singleOperand(parsed.value)
        if (operand === null) {
          return { kind: 'error', text: 'usage: /' + COMMAND_REVIEW + ' [options] [PR_URL]' }
        }
        if (operand !== undefined && classifyTarget(operand) !== 'url') {
          return {
            kind: 'error',
            text: 'usage: /' + COMMAND_REVIEW + ' [options] [PR_URL] — a code review reads the worktree or a PR URL',
          }
        }
        const target = operand ?? sessionCwd(invocation.agent)
        return runOne({
          ctx,
          deps,
          agent: invocation.agent,
          signal: invocation.signal,
          surface: 'review',
          target,
          argv: buildReviewArgs(parsed.value, { tailscale: deps.config.tailscale }),
          stdin: undefined,
          map: outcomeFromReview,
          inFlight,
          busy,
        })
      },
    },
    {
      name: COMMAND_ANNOTATE,
      description: 'Annotate a markdown or text file, a folder, or a URL in the browser',
      input: { hint: '<file|folder|https://…> [--markdown] [--no-jina] [--app] [--tailscale]' },
      handler: async (invocation) => {
        const parsed = parseTypedLine(invocation.rawInput.trim().split(/\s+/u), ANNOTATE_FLAGS)
        if (!parsed.ok) return { kind: 'error', text: parsed.error }
        const operand = singleOperand(parsed.value)
        if (operand === undefined || operand === null) {
          return { kind: 'error', text: 'usage: /' + COMMAND_ANNOTATE + ' <file|folder|URL>' }
        }
        const kind = classifyTarget(operand)
        if (kind === undefined) {
          return { kind: 'error', text: 'usage: /' + COMMAND_ANNOTATE + ' <file|folder|URL>' }
        }
        let target = operand
        if (kind === 'path') {
          const vetted = existingPath(sessionCwd(invocation.agent), operand, 'entry')
          if (!vetted.ok) return { kind: 'error', text: vetted.error }
          target = vetted.path
        }
        return runOne({
          ctx,
          deps,
          agent: invocation.agent,
          signal: invocation.signal,
          surface: 'annotate',
          target,
          argv: buildAnnotateArgs(target, { tailscale: deps.config.tailscale }),
          stdin: undefined,
          map: outcomeFromAnnotate,
          inFlight,
          busy,
        })
      },
    },
    {
      name: COMMAND_LAST,
      description: 'Annotate the newest assistant message in the browser',
      input: { hint: '(no arguments)' },
      handler: async (invocation) => {
        const parsed = parseTypedLine(invocation.rawInput.trim().split(/\s+/u), [])
        if (!parsed.ok) return { kind: 'error', text: parsed.error }
        if (parsed.value.positionals.length > 0) {
          return { kind: 'error', text: 'usage: /' + COMMAND_LAST + ' (no arguments)' }
        }
        const text = newestAssistantText(invocation.agent.session.deriveMessages())
        if (text === undefined) {
          return { kind: 'error', text: 'this session has no assistant message to annotate yet' }
        }
        if (oversize(text, deps.config.maxInputBytes)) {
          return { kind: 'error', text: 'the message is larger than maxInputBytes; annotate a file instead' }
        }
        return runOne({
          ctx,
          deps,
          agent: invocation.agent,
          signal: invocation.signal,
          surface: 'last',
          target: 'the last assistant message',
          argv: buildAnnotateLastArgs({ tailscale: deps.config.tailscale }),
          stdin: text,
          map: outcomeFromAnnotateLast,
          inFlight,
          busy,
        })
      },
    },
  ]

  const disposers = definitions.map((definition) => ctx.commands.register(definition))
  ctx.logger.info('plannotator commands registered')
  return () => {
    for (const controller of inFlight) controller.abort()
    inFlight.clear()
    // Registration disposers are idempotent; unloading twice is not an error.
    for (const dispose of disposers) dispose()
  }
}

/** The production dependency set, with the real clock and filesystem. */
export function defaultCommandDeps(config: PlannotatorConfig, env: NodeJS.ProcessEnv): CommandDeps {
  return {
    config,
    env,
    uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
    probe: NODE_BINARY_PROBE,
    now: Date.now,
    snapshotIo: undefined,
  }
}
