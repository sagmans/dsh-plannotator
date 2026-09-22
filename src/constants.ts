/**
 * Values every other module agrees on.
 *
 * They live here rather than inline because three call sites share each one:
 * the argv builders, the decision mapper, and the tests that pin the CLI
 * contract. A drift between them would be a review that silently reports the
 * wrong verdict.
 *
 * @module dsh-plannotator/constants
 */

/** Stable Loader identity: the profile patch row id, the plugin name, and the log prefix. */
export const PLUGIN_NAME = 'plannotator'

/** Names the plugin owns in the harness' human-command registry. */
export const COMMAND_PLAN = 'plannotator-plan'
export const COMMAND_REVIEW = 'plannotator-review'
export const COMMAND_ANNOTATE = 'plannotator-annotate'
export const COMMAND_LAST = 'plannotator-last'

/** Environment overrides the CLI itself documents; they outrank nothing but config. */
export const BINARY_ENV = 'PLANNOTATOR_BIN'
export const DATA_DIR_ENV = 'PLANNOTATOR_DATA_DIR'

/** Where plan snapshots go when neither config nor environment names a data directory. */
export const DATA_DIR_FALLBACK_NAME = '.plannotator'

/**
 * Plan snapshots live under a namespaced subdirectory because the data
 * directory is the CLI's own: writing beside its `plans/` archive would put two
 * different keying schemes in one tree.
 */
export const DATA_DIR_NAMESPACE = 'dsh'
export const PLANS_SUBDIR = 'plans'

/** CLI subcommands this plugin drives. */
export const CLI_ANNOTATE = 'annotate'
export const CLI_REVIEW = 'review'
export const CLI_ANNOTATE_LAST = 'annotate-last'

/** CLI flags with a fixed meaning; the same spelling appears in the docs and the tests. */
export const FLAG_GATE = '--gate'
export const FLAG_JSON = '--json'
export const FLAG_REQUIRE_APPROVAL = '--require-approval'
export const FLAG_TAILSCALE = '--tailscale'
export const FLAG_STDIN = '--stdin'
export const FLAG_BASE = '--base'
export const FLAG_DIFF_TYPE = '--diff-type'
export const FLAG_GIT = '--git'
export const FLAG_GITBUTLER = '--gitbutler'
export const FLAG_LOCAL = '--local'
export const FLAG_NO_LOCAL = '--no-local'
export const FLAG_NO_GIT_REMOTE_CHECK = '--no-git-remote-check'
export const FLAG_MARKDOWN = '--markdown'
export const FLAG_NO_JINA = '--no-jina'
export const FLAG_APP = '--app'
export const FLAG_STATIC = '--static'
export const FLAG_RENDER_HTML = '--render-html'

/**
 * The harness tool whose arguments hold the newest plan.
 *
 * `exit_plan_mode` is registered by `@deepseek-ai/dsh-plan-mode` and stays
 * registered while plan mode is inactive, so the last call is also the last
 * plan a reader saw — which is exactly what an on-demand review wants.
 */
export const EXIT_PLAN_MODE_TOOL = 'exit_plan_mode'

/** The `approve` option label the plan-mode review declares; read from the request, never assumed. */
export const PLAN_DECLINE_FALLBACK_LABEL = 'Keep planning'

/** Strict-gate exit codes the `annotate` command publishes under `--require-approval`. */
export const EXIT_APPROVED = 0
export const EXIT_NOT_APPROVED = 1
export const EXIT_GATE_FAILURE = 2

/** Decision vocabulary shared by every plannotator surface. */
export const DECISION_APPROVED = 'approved'
export const DECISION_ANNOTATED = 'annotated'
export const DECISION_DISMISSED = 'dismissed'

/**
 * Cap on each captured stream.
 *
 * A review's stdout is one JSON record, but a failing CLI can print an
 * arbitrarily long trace; keeping all of it would let a subprocess decide this
 * process' memory. The tail is what a human reads, so the tail is what survives.
 */
export const STREAM_CAP_BYTES = 1 << 20

/** How much of a failed run's stderr a command notice quotes. */
export const STDERR_TAIL_CHARS = 400

/** Grace between SIGTERM and SIGKILL when a review is cancelled or times out. */
export const KILL_GRACE_MS = 2000

/**
 * Bound on text handed to a review session before it is written to disk.
 *
 * The CLI refuses files over 2 MB on its own; stopping earlier keeps a
 * pathological transcript from being materialized at all.
 */
export const DEFAULT_MAX_INPUT_BYTES = 1 << 20

/** Longest session-id fragment used in a snapshot filename. */
export const SESSION_SEGMENT_MAX_CHARS = 120

/** Permissions for the snapshot file and the directory holding it. */
export const SNAPSHOT_FILE_MODE = 0o600
export const SNAPSHOT_DIR_MODE = 0o700

/** Report text a reviewer's own words are framed with before they reach the model. */
export const FEEDBACK_PREFIX = '[plannotator]'
