/**
 * Turn a finished run into the reviewer's decision.
 *
 * The CLI publishes two different stdout contracts, and this module is the only
 * place that knows which subcommand uses which:
 *
 * - `annotate` under `--gate --json --require-approval` reports the verdict as
 *   an exit code (0 approved, 1 not approved, 2 gate failure) and repeats it as
 *   one JSON record with an optional `feedback` string.
 * - `review --json` reports `{ decision, message }` on stdout and attaches no
 *   meaning to the exit code.
 *
 * Everything downstream — steering, notices, error text — reads the
 * {@link ReviewOutcome} produced here, so a change in one contract cannot leak
 * into how another surface is reported.
 *
 * @module dsh-plannotator/decisions
 */

import {
  DECISION_ANNOTATED,
  DECISION_APPROVED,
  DECISION_DISMISSED,
  EXIT_APPROVED,
  EXIT_GATE_FAILURE,
  EXIT_NOT_APPROVED,
  STDERR_TAIL_CHARS,
} from './constants.ts'
import type { RunResult } from './cli.ts'

/** The three verdicts every plannotator surface shares. */
export type ReviewDecision =
  | typeof DECISION_APPROVED
  | typeof DECISION_ANNOTATED
  | typeof DECISION_DISMISSED

/** One settled review. */
export interface ReviewOutcome {
  readonly decision: ReviewDecision
  /** The reviewer's own words; empty when they approved or closed without writing any. */
  readonly feedback: string
}

/** Decision mapping either yields an outcome or the text explaining why it could not. */
export type OutcomeResult =
  | { readonly ok: true; readonly outcome: ReviewOutcome }
  | { readonly ok: false; readonly error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the JSON record the CLI prints.
 *
 * The whole stream is tried first because that is the documented shape; a
 * per-line scan follows so a warning line printed before the record does not
 * turn a decided review into an error.
 *
 * @param text - captured stdout.
 * @returns the record, or `undefined` when stdout carries none.
 */
export function readJsonRecord(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    // Fall through to the line scan.
  }
  const lines = trimmed.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? ''
    if (!line.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed)) return parsed
    } catch {
      // A line that is not a record is simply not the record.
    }
  }
  return undefined
}

/** Narrow a record's `decision` field, or `undefined` when it names no known verdict. */
function readDecision(record: Record<string, unknown> | undefined): ReviewDecision | undefined {
  const value = record?.['decision']
  if (value === DECISION_APPROVED || value === DECISION_ANNOTATED || value === DECISION_DISMISSED) {
    return value
  }
  return undefined
}

/** Read a string field, treating anything else as absent. */
function readText(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

/** The tail of a failed run's stderr, which is the part a notice can carry. */
function stderrTail(result: RunResult): string {
  if (result.kind === 'spawn-failed') return result.message
  const text = result.stderr.text.trim()
  if (text === '') return 'no diagnostic output'
  return text.length > STDERR_TAIL_CHARS ? '…' + text.slice(-STDERR_TAIL_CHARS) : text
}

/** The outcome of a run that never produced a verdict. */
function failure(result: RunResult, context: string): OutcomeResult {
  if (result.kind === 'spawn-failed') {
    return { ok: false, error: context + ': ' + result.message }
  }
  if (result.kind === 'timed-out') {
    return { ok: false, error: context + ': the review timed out before a decision' }
  }
  if (result.kind === 'exited' && result.cancelled) {
    return { ok: false, error: context + ': the review was cancelled' }
  }
  if (result.kind === 'signalled') {
    return { ok: false, error: context + ': the review process was killed (' + String(result.signal) + ')' }
  }
  return { ok: false, error: context + ': ' + stderrTail(result) }
}

/**
 * Map a strict `annotate` run (exit codes carry the verdict).
 *
 * @param result - the finished run.
 * @returns the reviewer's decision, or why the gate failed.
 */
export function outcomeFromAnnotate(result: RunResult): OutcomeResult {
  if (result.kind === 'spawn-failed' || result.kind === 'signalled' || result.kind === 'timed-out') {
    return failure(result, 'browser review did not finish')
  }
  if (result.cancelled) return failure(result, 'browser review did not finish')
  const record = readJsonRecord(result.stdout.text)
  const feedback = readText(record, 'feedback')
  if (result.code === EXIT_APPROVED) return { ok: true, outcome: { decision: DECISION_APPROVED, feedback } }
  if (result.code === EXIT_NOT_APPROVED) {
    const decision = readDecision(record) ?? DECISION_ANNOTATED
    return { ok: true, outcome: { decision, feedback } }
  }
  if (result.code === EXIT_GATE_FAILURE) {
    return { ok: false, error: 'the review could not start: ' + stderrTail(result) }
  }
  return failure(result, 'browser review failed (exit ' + String(result.code) + ')')
}

/**
 * Map an `annotate-last` run, which publishes no strict exit-code contract.
 *
 * The record is the verdict; only its absence is an error. An exit code alone
 * cannot distinguish "the reviewer closed the tab" from "the CLI refused the
 * input", so a run without a record is reported as a failure rather than
 * guessed at.
 *
 * @param result - the finished run.
 * @returns the reviewer's decision, or why no verdict was produced.
 */
export function outcomeFromAnnotateLast(result: RunResult): OutcomeResult {
  if (result.kind !== 'exited' || result.cancelled) {
    return failure(result, 'annotation did not finish')
  }
  const record = readJsonRecord(result.stdout.text)
  const decision = readDecision(record)
  if (decision === undefined) {
    if (result.code === EXIT_APPROVED) {
      // A record-less success is the CLI's plaintext close; nothing was written.
      return { ok: true, outcome: { decision: DECISION_DISMISSED, feedback: '' } }
    }
    return failure(result, 'annotation did not finish (exit ' + String(result.code) + ')')
  }
  return { ok: true, outcome: { decision, feedback: readText(record, 'feedback') } }
}

/**
 * Map a `review --json` run.
 *
 * `message` is the CLI's rendered plaintext — approval framing and annotations
 * together — so it is carried as feedback for every non-approval verdict and as
 * guidance on an approval. The exit code is ignored on purpose: the documented
 * contract for this subcommand puts the verdict in the record alone.
 *
 * @param result - the finished run.
 * @returns the reviewer's decision, or why no verdict was produced.
 */
export function outcomeFromReview(result: RunResult): OutcomeResult {
  if (result.kind !== 'exited' || result.cancelled) {
    return failure(result, 'code review did not finish')
  }
  const record = readJsonRecord(result.stdout.text)
  const decision = readDecision(record)
  if (decision === undefined) {
    return failure(result, 'code review did not finish (exit ' + String(result.code) + ')')
  }
  return { ok: true, outcome: { decision, feedback: readText(record, 'message') } }
}
