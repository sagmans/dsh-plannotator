/**
 * Run the CLI and capture what it decided.
 *
 * A review is a long-lived child: it blocks until a human acts, and this
 * process must stay responsive and cancellable meanwhile. The runner therefore
 * owns exactly four things — argv-only spawning, bounded capture, cancellation
 * with a kill ladder, and an optional timeout — and reports the outcome as the
 * CLI's own exit code plus its two streams, so decision mapping stays a pure
 * function over that result.
 *
 * @module dsh-plannotator/cli
 */

import { spawn } from 'node:child_process'
import { KILL_GRACE_MS, STREAM_CAP_BYTES } from './constants.ts'

/** Everything one invocation needs. */
export interface RunRequest {
  /** Vetted absolute path to the executable. */
  readonly binary: string
  /** Full argv, including the subcommand; never shell-interpreted. */
  readonly argv: readonly string[]
  /** Working directory the review runs in — the session's own. */
  readonly cwd: string
  /** Environment handed to the child. */
  readonly env: NodeJS.ProcessEnv
  /** Text to write to the child's stdin before closing it, when the surface takes one. */
  readonly stdin: string | undefined
  /** Hard ceiling in milliseconds; 0 waits as long as the child lives. */
  readonly timeoutMs: number
  /** Cancellation owned by the dispatching command. */
  readonly signal: AbortSignal | undefined
}

/** A captured stream: text, whether it was cut, and the tail a human should read. */
export interface CapturedStream {
  readonly text: string
  readonly truncated: boolean
}

/** How one run ended. */
export type RunResult =
  | {
      readonly kind: 'exited'
      readonly code: number
      readonly cancelled: boolean
      readonly stdout: CapturedStream
      readonly stderr: CapturedStream
    }
  | {
      readonly kind: 'signalled'
      readonly signal: NodeJS.Signals | null
      readonly cancelled: boolean
      readonly stdout: CapturedStream
      readonly stderr: CapturedStream
    }
  | {
      readonly kind: 'timed-out'
      readonly stdout: CapturedStream
      readonly stderr: CapturedStream
    }
  | { readonly kind: 'spawn-failed'; readonly message: string }

/** Collects a stream while keeping memory bounded. */
class StreamCapture {
  private readonly chunks: string[] = []
  private bytes = 0
  private readonly cap: number
  private overflowed = false

  constructor(cap: number = STREAM_CAP_BYTES) {
    this.cap = cap
  }

  push(chunk: string): void {
    if (this.bytes >= this.cap) {
      this.overflowed = true
      return
    }
    this.chunks.push(chunk)
    this.bytes += Buffer.byteLength(chunk, 'utf8')
  }

  snapshot(): CapturedStream {
    const joined = this.chunks.join('')
    if (!this.overflowed && Buffer.byteLength(joined, 'utf8') <= this.cap) {
      return { text: joined, truncated: false }
    }
    // Cutting by bytes can split a UTF-8 sequence, so the kept text is sliced
    // from the end and re-decoded rather than indexed.
    const buffer = Buffer.from(joined, 'utf8').subarray(0, this.cap)
    return { text: buffer.toString('utf8'), truncated: true }
  }
}

/**
 * Spawn the CLI and settle once it has exited, failed, been cancelled, or hit
 * the timeout.
 *
 * The returned promise never rejects: a missing or unspawnable binary is an
 * outcome the command reports, not an exception the registry has to survive.
 *
 * @param request - argv, directory, environment, stdin, timeout, and signal.
 * @returns how the run ended.
 */
export function runPlannotator(request: RunRequest): Promise<RunResult> {
  return new Promise<RunResult>((settle) => {
    const stdout = new StreamCapture()
    const stderr = new StreamCapture()
    let settled = false
    let cancelled = false
    let killTimer: NodeJS.Timeout | undefined
    let timeoutTimer: NodeJS.Timeout | undefined

    const finish = (result: RunResult): void => {
      if (settled) return
      settled = true
      if (killTimer !== undefined) clearTimeout(killTimer)
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
      request.signal?.removeEventListener('abort', onAbort)
      settle(result)
    }

    const child = spawn(request.binary, [...request.argv], {
      cwd: request.cwd,
      env: request.env,
      // No shell: a path or a reviewer's words must never be re-parsed as syntax.
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    /** Escalate to SIGKILL after a grace period; a hung server must not hold the session. */
    const terminate = (): void => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        child.kill('SIGKILL')
      }, KILL_GRACE_MS)
      killTimer.unref()
    }

    function onAbort(): void {
      cancelled = true
      terminate()
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => stdout.push(chunk))
    child.stderr.on('data', (chunk: string) => stderr.push(chunk))

    child.on('error', (error: Error) => {
      finish({ kind: 'spawn-failed', message: error.message })
    })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (cancelled) {
        finish({ kind: 'exited', code: code ?? -1, cancelled: true, stdout: stdout.snapshot(), stderr: stderr.snapshot() })
        return
      }
      if (code === null) {
        finish({ kind: 'signalled', signal, cancelled: false, stdout: stdout.snapshot(), stderr: stderr.snapshot() })
        return
      }
      finish({ kind: 'exited', code, cancelled: false, stdout: stdout.snapshot(), stderr: stderr.snapshot() })
    })

    if (request.signal !== undefined) {
      if (request.signal.aborted) onAbort()
      else request.signal.addEventListener('abort', onAbort, { once: true })
    }

    if (request.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        terminate()
        finish({ kind: 'timed-out', stdout: stdout.snapshot(), stderr: stderr.snapshot() })
      }, request.timeoutMs)
      timeoutTimer.unref()
    }

    // The child's stdin is always closed: a CLI waiting on a hook payload that
    // will never arrive would otherwise hang until the timeout it may not have.
    if (child.stdin !== null) {
      if (request.stdin !== undefined) child.stdin.end(request.stdin)
      else child.stdin.end()
    }
  })
}
