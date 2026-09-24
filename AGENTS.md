# AGENTS.md

Operating map for the Plannotator browser-review plugin. It adds four slash
commands to the DeepSeek Harness `tui` profile; the review UI itself lives in the
user-installed `plannotator` CLI. Human-facing behaviour is `README.md`; release
policy is `RELEASE.md` and is authoritative over anything here.

## Runtime boundary

- Supported harness line: `>=0.1.5-rc.1 <0.1.6`, profile `tui` only (`package.json` `dsh.compatibility`).
- Zero runtime dependencies. Harness packages are peers supplied by the profile; `.npmrc` sets `strict-peer-dependencies=true` and `auto-install-peers=true`, so a stray dependency fails the install instead of resolving from a transitive copy.
- Node >=22.19 (`engines`); CI runs Node 24.20.0 with pnpm 11.21.0.
- The bundle registers commands only. `cordis.patch.yml` inserts a self-inserting row and replaces nothing in the base, so a profile without this plugin behaves exactly as before.

## Commands

| Purpose | Command |
| --- | --- |
| Typecheck | `pnpm run typecheck` |
| Unit tests (run against `src` via tsx) | `pnpm test` |
| Build `dist/` | `pnpm run build` |
| Integration tests (import `dist/`; run `pnpm run build` first) | `pnpm run test:build` |
| Release-helper guards (python3 3.11+) | `pnpm test:release` |
| Packed-tarball smoke | `pnpm run pack-smoke` |
| Full local gate | `pnpm run check` |
| Drive the real TUI in a PTY | `pnpm run drive -- --prelude "/plannotator-last" --expect "no assistant message"` |

A change is not done until `pnpm run check` passes. CI (`.github/workflows/check.yml`) runs that same sequence plus `npm audit signatures` and `pnpm audit --audit-level high`; a failing audit is a build failure, not a follow-up.

## Layout

- `src/commands.ts` — the four handlers and the single review runner every surface goes through.
- `src/args.ts` — argv construction and the per-subcommand flag allowlist.
- `src/binary.ts` — resolve and vet the `plannotator` executable.
- `src/cli.ts` — spawn, bounded capture, cancellation kill ladder, optional timeout.
- `src/decisions.ts` — exit code plus JSON record to verdict; the only module that knows the CLI's stdout contracts.
- `src/feedback.ts` — steer the reviewer's words into the conversation.
- `src/plan-source.ts`, `src/transcript.ts` — recover the newest plan / newest assistant message from the session log.
- `src/workspace.ts` — write review input to a private path outside the repository.
- `src/config.ts`, `src/constants.ts` — row config, defaults, and the values several modules must agree on.
- `tests/*.spec.ts` run against `src`; `tests/build.test.mjs` loads `dist/`; `tests/release/` exercises `scripts/npm/release.py`; `tests/fixtures/fake-plannotator.mjs` stands in for the CLI.
- `tools/pack-smoke.mjs` inspects the packed archive; `tools/pty-drive.mjs` boots a profile in a real PTY and asserts on the notice a reader sees.

## Repository constraints

- Reviewer input never becomes shell syntax: argv is an array spawned with `shell: false`, and the plugin's own flags are appended in `args.ts`. Never route reviewer text through a shell or a command string.
- The CLI flag surface is allowlisted per subcommand. A new flag is added to the allowlist in `args.ts` and to the owning command in `commands.ts`; unknown dashed tokens are refused with usage text rather than forwarded.
- Read a verdict from the CLI's exit code and JSON record, never from the wording of a message.
- `src` imports use `.ts` extensions (`tsconfig.json` `allowImportingTsExtensions`); `tsconfig.build.json` rewrites them for `dist/`. Omitting the extension breaks one target or the other.
- `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Keep them enabled; `tests/build.test.mjs` asserts the built exports and schema, so build-affecting changes need it to pass.
- Comments and docstrings state why the code exists and how it is used, never what the line does.

## Security boundaries

- The `plannotator` binary is user-installed and never downloaded by this plugin. `src/binary.ts` checks every candidate for executability and ownership before returning it; `allowUntrustedBinary` defaults to `false`.
- Snapshot files are written outside the repository with mode `0600` in a `0700` directory.
- `/plannotator-last` pipes the message on stdin; the message must never be written to disk.
- No token, credential, or registry secret belongs in this repository. Publication runs only through the tag-triggered `.github/workflows/release.yml` with OIDC trusted publishing and the approval-gated `npm-release` environment.
- `scripts/npm/release.py` actions are previewed with `DRY_RUN=1` and mutate only with `CONFIRM=<action>`. Read `RELEASE.md` before any registry or GitHub mutation; a published version is immutable and forward-fixed.
- Never publish, unpublish, or configure trust on your own initiative.

## Testing completion criteria

- Unit tests do not prove the CLI launches, the browser page loads, or steered feedback returns to the agent. For any change that touches a command path, run `pnpm run drive` against a real profile and confirm the notice text.
- Report exactly which commands ran and which did not; an unrun gate is stated, never implied.
