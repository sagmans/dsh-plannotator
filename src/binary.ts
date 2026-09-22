/**
 * Locate and vet the `plannotator` executable.
 *
 * The binary is a user-installed artefact this plugin spawns, so resolution is
 * the one place where a wrong answer becomes code execution. Every candidate is
 * checked for executability and ownership before it is returned, and a file
 * another user could rewrite is refused unless the profile says otherwise.
 *
 * @module dsh-plannotator/binary
 */

import { constants as fsConstants, statSync } from 'node:fs'
import { accessSync } from 'node:fs'
import { delimiter, isAbsolute, resolve } from 'node:path'
import { BINARY_ENV } from './constants.ts'

/** Outcome of resolving the executable. */
export type BinaryResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string }

/** The filesystem facts resolution reads, injectable so tests need no real files. */
export interface BinaryProbe {
  /** Whether the path exists and carries an execute bit. */
  readonly isExecutable: (path: string) => boolean
  /** Mode bits and owner of an existing path. */
  readonly stat: (path: string) => { readonly mode: number; readonly uid: number }
}

/** What resolution needs to know about the request. */
export interface BinaryRequest {
  /** `config.binary`; empty means "use the search order". */
  readonly configured: string
  /** `config.allowUntrustedBinary`. */
  readonly allowUntrusted: boolean
  /** Environment holding {@link BINARY_ENV} and `PATH`. */
  readonly env: NodeJS.ProcessEnv
  /** Working directory a relative `config.binary` resolves against. */
  readonly cwd: string
  /** Owner every candidate should belong to; `undefined` where the platform has no such notion. */
  readonly uid: number | undefined
  /** Filesystem probe. */
  readonly probe: BinaryProbe
}

/** The environment name the resolved binary is reported under, so a failure is actionable. */
const SEARCH_ORDER = `config.binary, $${BINARY_ENV}, then PATH`

/** True when anyone but the owner may write the file. */
function isWorldWritable(mode: number): boolean {
  // 0o002 is the "others may write" bit; the owner-write bit is expected.
  return (mode & 0o002) !== 0
}

/**
 * Decide whether a candidate is safe to execute.
 *
 * @param path - absolute candidate path.
 * @param request - the resolution request carrying the trust policy.
 * @returns `undefined` when the candidate is acceptable, else the reason to refuse it.
 */
function trustProblem(path: string, request: BinaryRequest): string | undefined {
  let facts: { readonly mode: number; readonly uid: number }
  try {
    facts = request.probe.stat(path)
  } catch {
    return `${path} cannot be inspected`
  }
  if (request.allowUntrusted) return undefined
  if (isWorldWritable(facts.mode)) {
    return `${path} is writable by other users (mode ${facts.mode.toString(8)}); set allowUntrustedBinary, or install a per-user copy`
  }
  if (request.uid !== undefined && facts.uid !== request.uid) {
    return `${path} is owned by uid ${facts.uid}, not by this user; set allowUntrustedBinary to accept it`
  }
  return undefined
}

/**
 * Resolve the executable to spawn.
 *
 * Order: an explicitly configured path, then {@link BINARY_ENV}, then the first
 * executable named `plannotator` on `PATH`. An explicit candidate that exists
 * but fails the trust check is refused rather than skipping to the next
 * candidate: silently running a different binary would hide the substitution.
 *
 * @param request - configured path, policy, environment, and probe.
 * @returns the vetted absolute path, or the reason none could be used.
 */
export function resolveBinary(request: BinaryRequest): BinaryResolution {
  const configured = request.configured.trim()
  const fromEnv = (request.env[BINARY_ENV] ?? '').trim()

  const explicit = configured !== '' ? configured : fromEnv
  if (explicit !== '') {
    const path = isAbsolute(explicit) ? explicit : resolve(request.cwd, explicit)
    if (!request.probe.isExecutable(path)) {
      return { ok: false, reason: `${path} is not an executable file` }
    }
    const problem = trustProblem(path, request)
    if (problem !== undefined) return { ok: false, reason: problem }
    return { ok: true, path }
  }

  const searchPath = request.env['PATH'] ?? ''
  for (const directory of searchPath.split(delimiter)) {
    if (directory === '') continue
    const candidate = resolve(directory, 'plannotator')
    if (!request.probe.isExecutable(candidate)) continue
    const problem = trustProblem(candidate, request)
    if (problem !== undefined) return { ok: false, reason: problem }
    return { ok: true, path: candidate }
  }

  return { ok: false, reason: `plannotator was not found (${SEARCH_ORDER})` }
}

/** The production probe: real `access`/`stat`, with no policy of its own. */
export const NODE_BINARY_PROBE: BinaryProbe = {
  isExecutable: (path: string): boolean => {
    try {
      accessSync(path, fsConstants.X_OK)
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  stat: (path: string): { readonly mode: number; readonly uid: number } => {
    const facts = statSync(path)
    return { mode: facts.mode, uid: facts.uid }
  },
}
