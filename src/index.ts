/**
 * dsh-plannotator — Plannotator's browser review surfaces for the terminal profile.
 *
 * The plugin adds no UI of its own: the terminal surface owns the alternate
 * screen and exposes no drawing hook, and the review UI already exists in the
 * `plannotator` CLI. What is missing is the wiring between a typed slash command
 * and that CLI, plus a way back into the conversation — which is exactly what
 * this bundle registers. Everything the reader sees in the terminal is one
 * notice per command; everything they read and write in detail is the browser.
 *
 * Review is on demand by design. Plan mode's own review stays untouched, so a
 * profile that cannot reach a browser (a remote host without a forwarded port,
 * for one) keeps working exactly as it did without this plugin.
 *
 * @module @sagmans/dsh-plannotator
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defaultCommandDeps,
  registerPlannotatorCommands,
} from './commands.ts'
import { Config as configSchema, normalizeConfig } from './config.ts'
import { PLUGIN_NAME } from './constants.ts'

export { Config as configSchema, normalizeConfig, resolveDataDir, resolvePlansDir } from './config.ts'
export type { ApproveNotesMode, PlannotatorConfig } from './config.ts'
export { COMMAND_ANNOTATE, COMMAND_LAST, COMMAND_PLAN, COMMAND_REVIEW, PLUGIN_NAME } from './constants.ts'

/** Stable Loader identity; the profile patch row's id and the module name agree. */
export const name = PLUGIN_NAME

/**
 * The registry the bundle registers into.
 *
 * Declaring it here rather than probing with `ctx.inject` keeps the plugin
 * unmounted — not partially mounted — on a profile that has no command
 * registry, which is the honest state: without it these commands have no
 * reader.
 */
export const inject = ['commands']

/** Validated row config; every field is defaulted, so a profile may set a subset. */
export const Config = configSchema

/**
 * Register the plannotator commands for this profile.
 *
 * @param ctx - context carrying the command registry.
 * @param config - the row's config (already defaulted by the loader, re-checked here).
 */
export function apply(ctx: Context, config: unknown): void {
  const settings = normalizeConfig(config)
  const deps = defaultCommandDeps(settings, process.env)
  ctx.effect(
    () => registerPlannotatorCommands(ctx, { ...deps, snapshotIo: undefined }),
    PLUGIN_NAME + ' command lifecycle',
  )
}
