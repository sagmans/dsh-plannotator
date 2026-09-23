/**
 * Materialize review input on disk, privately.
 *
 * A plan reaches this plugin as a string inside a tool call, but the CLI
 * reviews files: it keys history and revision diffs by path, reads from disk at
 * a stable location, and refuses targets it cannot open. So the plan has to be
 * written somewhere, and that somewhere must not be the reader's repository —
 * the plugin would be committing a file the agent never asked for.
 *
 * @module dsh-plannotator/workspace
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SESSION_SEGMENT_MAX_CHARS,
  SNAPSHOT_DIR_MODE,
  SNAPSHOT_FILE_MODE,
} from './constants.ts'

/** The filesystem calls snapshot writing uses, injectable for tests. */
export interface SnapshotIo {
  readonly mkdir: (path: string, options: { recursive: true; mode: number }) => void
  readonly writeFile: (path: string, data: string, options: { mode: number }) => void
  readonly rename: (from: string, to: string) => void
}

/** Production filesystem calls. */
export const NODE_SNAPSHOT_IO: SnapshotIo = {
  mkdir: (path, options) => mkdirSync(path, options),
  writeFile: (path, data, options) => writeFileSync(path, data, options),
  rename: (from, to) => renameSync(from, to),
}

/** Writing either yields the path the reviewer will see, or why it failed. */
export type SnapshotResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string }

/**
 * Reduce a session id to a filename segment.
 *
 * Session ids are opaque and may carry separators or dots; a segment built from
 * one must not be able to point outside the plans directory, so everything
 * outside a conservative alphabet is replaced and the result is length-capped.
 *
 * @param sessionId - the session's identity string.
 * @returns a safe, non-empty filename segment.
 */
export function sessionSegment(sessionId: string): string {
  // Dots are excluded from the safe alphabet outright: allowing them would let a
  // crafted id become ".." no matter how separators are handled.
  const cleaned = sessionId
    .replace(/[^A-Za-z0-9_-]/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[_-]+/u, '')
  const capped = cleaned.slice(0, SESSION_SEGMENT_MAX_CHARS)
  return capped === '' ? 'session' : capped
}

/**
 * The one path a session's plan is reviewed at.
 *
 * Reusing it is deliberate: overwriting the same document is what lets the
 * browser show what changed since the previous review.
 *
 * @param plansDir - directory holding plan snapshots.
 * @param sessionId - the session's identity string.
 * @returns absolute path to the session's plan snapshot.
 */
export function planSnapshotPath(plansDir: string, sessionId: string): string {
  return join(plansDir, sessionSegment(sessionId) + '.md')
}

/**
 * Write one plan snapshot atomically.
 *
 * The temporary file is created in the destination directory so the rename
 * stays on one filesystem, and it is written with `0o600` before any content
 * exists — a plan is the model's view of the work and often names credentials
 * or internal hosts, so it must never be group- or world-readable, not even
 * for the instant before a later chmod.
 *
 * @param plansDir - directory holding plan snapshots.
 * @param sessionId - the session's identity string.
 * @param text - the plan markdown.
 * @param io - filesystem calls.
 * @returns the path written, or the failure to report.
 */
export function writePlanSnapshot(
  plansDir: string,
  sessionId: string,
  text: string,
  io: SnapshotIo = NODE_SNAPSHOT_IO,
): SnapshotResult {
  const path = planSnapshotPath(plansDir, sessionId)
  const temporary = path + '.tmp-' + String(process.pid) + '-' + Date.now().toString(36)
  try {
    io.mkdir(plansDir, { recursive: true, mode: SNAPSHOT_DIR_MODE })
    io.writeFile(temporary, text, { mode: SNAPSHOT_FILE_MODE })
    io.rename(temporary, path)
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
