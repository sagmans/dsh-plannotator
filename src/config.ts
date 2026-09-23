/**
 * Plugin configuration: the row's `config` block, its defaults, and the two
 * paths that are derived rather than configured.
 *
 * Defaults are data, not schema literals, because the loader validates through
 * {@link Config} while a hand-built or re-normalized value goes through
 * {@link normalizeConfig} — one table keeps the two from disagreeing.
 *
 * @module dsh-plannotator/config
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import {
  DATA_DIR_ENV,
  DATA_DIR_FALLBACK_NAME,
  DATA_DIR_NAMESPACE,
  DEFAULT_MAX_INPUT_BYTES,
  PLANS_SUBDIR,
} from './constants.ts'

/** How approved-plan notes are treated: forwarded as guidance, or dropped. */
export const APPROVE_NOTES_MODES = ['steer', 'ignore'] as const
export type ApproveNotesMode = (typeof APPROVE_NOTES_MODES)[number]

/** Every field the row may set, after defaults are applied. */
export interface PlannotatorConfig {
  /** Absolute path to the plannotator executable; empty means resolve from env then PATH. */
  readonly binary: string
  /** Data directory for plan snapshots; empty means env then `~/.plannotator`. */
  readonly dataDir: string
  /** Hard ceiling on one review; 0 waits as long as the CLI server lives. */
  readonly reviewTimeoutMs: number
  /** Publish every session over the tailnet instead of loopback. */
  readonly tailscale: boolean
  /** Forward reviewer feedback to the model as a steering message. */
  readonly steerFeedback: boolean
  /** Whether notes accompanying an approval are forwarded or dropped. */
  readonly approveNotes: ApproveNotesMode
  /** Permit an executable this process does not own or that others can rewrite. */
  readonly allowUntrustedBinary: boolean
  /** Largest plan or transcript text this plugin will hand to a review. */
  readonly maxInputBytes: number
}

/** The values a profile gets when it sets nothing. */
export const CONFIG_DEFAULTS: PlannotatorConfig = {
  binary: '',
  dataDir: '',
  // A browser tab left open is the human's decision; a timer that silently
  // declines their review would be the plugin answering for them.
  reviewTimeoutMs: 0,
  tailscale: false,
  steerFeedback: true,
  approveNotes: 'steer',
  allowUntrustedBinary: false,
  maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
}

/** Loader-facing schema; every field defaulted so a row config may name any subset. */
export const Config = z.object({
  binary: z.string().default(CONFIG_DEFAULTS.binary),
  dataDir: z.string().default(CONFIG_DEFAULTS.dataDir),
  reviewTimeoutMs: z.natural().default(CONFIG_DEFAULTS.reviewTimeoutMs),
  tailscale: z.boolean().default(CONFIG_DEFAULTS.tailscale),
  steerFeedback: z.boolean().default(CONFIG_DEFAULTS.steerFeedback),
  approveNotes: z.union([z.const('steer'), z.const('ignore')]).default(CONFIG_DEFAULTS.approveNotes),
  allowUntrustedBinary: z.boolean().default(CONFIG_DEFAULTS.allowUntrustedBinary),
  maxInputBytes: z.natural().default(CONFIG_DEFAULTS.maxInputBytes),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoolean(raw: Record<string, unknown>, key: keyof PlannotatorConfig): boolean {
  const value = raw[key]
  return typeof value === 'boolean' ? value : (CONFIG_DEFAULTS[key] as boolean)
}

function readCount(raw: Record<string, unknown>, key: 'reviewTimeoutMs' | 'maxInputBytes'): number {
  const value = raw[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : CONFIG_DEFAULTS[key]
}

/**
 * Apply defaults to a config object the loader did not validate.
 *
 * The loader validates the row's config, but a directly-imported `apply` (tests,
 * an embedding host) gets whatever the caller passed; a missing field would
 * otherwise read as `undefined` and turn into the string "undefined" on a
 * command line.
 *
 * @param raw - candidate config, of unknown provenance.
 * @returns a complete config; unknown or malformed fields fall back to defaults.
 */
export function normalizeConfig(raw: unknown): PlannotatorConfig {
  if (!isRecord(raw)) return CONFIG_DEFAULTS
  const approveNotes = raw['approveNotes']
  const steerOrIgnore =
    typeof approveNotes === 'string' &&
    (APPROVE_NOTES_MODES as readonly string[]).includes(approveNotes)
      ? (approveNotes as ApproveNotesMode)
      : CONFIG_DEFAULTS.approveNotes
  return {
    binary: typeof raw['binary'] === 'string' ? raw['binary'] : CONFIG_DEFAULTS.binary,
    dataDir: typeof raw['dataDir'] === 'string' ? raw['dataDir'] : CONFIG_DEFAULTS.dataDir,
    reviewTimeoutMs: readCount(raw, 'reviewTimeoutMs'),
    tailscale: readBoolean(raw, 'tailscale'),
    steerFeedback: readBoolean(raw, 'steerFeedback'),
    approveNotes: steerOrIgnore,
    allowUntrustedBinary: readBoolean(raw, 'allowUntrustedBinary'),
    maxInputBytes: readCount(raw, 'maxInputBytes'),
  }
}

/**
 * Resolve the directory plan snapshots are written under.
 *
 * Config outranks the environment because a profile can pin a location the
 * reader chose, while the environment is how a one-off run redirects it.
 *
 * @param config - resolved plugin config.
 * @param env - process environment.
 * @param home - the user's home directory.
 * @returns the absolute data directory (it may not exist yet).
 */
export function resolveDataDir(
  config: PlannotatorConfig,
  env: NodeJS.ProcessEnv,
  home: string = homedir(),
): string {
  if (config.dataDir !== '') return config.dataDir
  const fromEnv = env[DATA_DIR_ENV]
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return join(home, DATA_DIR_FALLBACK_NAME)
}

/**
 * Resolve the directory plan snapshots are written into.
 *
 * One path per session is what lets the CLI's own plan history and diff work:
 * a resubmitted plan overwrites the same document, so the browser can show what
 * changed since the last review.
 *
 * @param dataDir - the resolved data directory.
 * @returns the directory holding this plugin's plan snapshots.
 */
export function resolvePlansDir(dataDir: string): string {
  return join(dataDir, DATA_DIR_NAMESPACE, PLANS_SUBDIR)
}
