# dsh-plannotator

Browser review for the DeepSeek Harness terminal profile: read a plan, a
document, or a code change in [Plannotator](https://github.com/plannotator/plannotator)'s
interface, then send what you think back to the agent — without leaving the TUI.

```
/plannotator-plan      review this session's plan
/plannotator-review    review the worktree or a pull request
/plannotator-annotate  annotate a file, a folder, or a URL
/plannotator-last      annotate the agent's last answer
```

Each command opens the browser, waits for your decision, prints one line in the
terminal, and forwards your words to the model as a steering message. The agent
can then act on them in the same session.

## Why commands instead of plan-mode integration

Plan mode keeps its own review path. This plugin adds a second, on-demand one,
because that path is not always reachable: a session on a remote host without a
forwarded port cannot open a browser at all, and a reader often wants to review
something that is not the plan they just wrote. Nothing here replaces or patches
the shipped plan-mode review; if the profile cannot use this plugin, plan mode
still works exactly as before.

## Requirements

- DeepSeek Harness `0.1.5-rc.1` or newer, `0.1.6` or older.
- The `plannotator` CLI on `PATH`, or pointed at by configuration. Install it
  the way its own documentation describes; this plugin never downloads it.
- A browser on the machine that runs the CLI. For a remote host, either forward
  the port or set `tailscale: true` and reach the session over the tailnet.

## Install

```bash
dsh plugin --profile tui add @sagmans/dsh-plannotator
```

The profile loads every bundle listed in its `package.json`; confirm the bundle
is listed there after the install. From a checkout, install the directory
instead:

```bash
dsh plugin --profile tui add link:/path/to/dsh-plannotator
```

## Commands

| Command | Runs | Notes |
| --- | --- | --- |
| `/plannotator-plan [file.md]` | `annotate <plan> --gate --json --require-approval` | With no argument, the newest plan in the session is snapshotted and reviewed. |
| `/plannotator-review [options] [PR_URL]` | `review <options> --json` | Reviews the worktree by default. |
| `/plannotator-annotate <file\|folder\|URL>` | `annotate <target> --gate --json --require-approval` | The target must exist, or be an `http(s)` URL. |
| `/plannotator-last` | `annotate-last --stdin --gate --json` | The message is piped on stdin and never written to disk. |

`review` accepts `--git`, `--gitbutler`, `--base <ref>`, `--diff-type <type>`,
`--local`, `--no-local`, `--no-git-remote-check`, and `--tailscale`. `annotate`
accepts `--markdown`, `--no-jina`, `--app`, `--static`, `--render-html`, and
`--tailscale`. Any other flag is refused with usage text instead of being passed
to the CLI.

## How a decision comes back

The plugin reads the CLI's own verdict, never the wording of a message:

| Surface | Verdict source | Feedback field |
| --- | --- | --- |
| `annotate` | exit `0` approved, `1` not approved, `2` gate failure | `feedback` |
| `review` | `decision` in the JSON record | `message` |
| `annotate-last` | `decision` in the JSON record | `feedback` |

An approval is reported as an approval. Notes attached to an approval are
forwarded as non-blocking guidance, which is how Plannotator frames them; set
`approveNotes: ignore` to keep them out of the conversation, or
`steerFeedback: false` to keep every review local.

## Configuration

Every key is optional. Restate the ones you keep when you patch the row, because
an id-targeted patch replaces the whole config block.

| Key | Default | Meaning |
| --- | --- | --- |
| `binary` | `''` | Absolute path to the executable. Empty means `$PLANNOTATOR_BIN`, then `PATH`. |
| `dataDir` | `''` | Where plan snapshots are written. Empty means `$PLANNOTATOR_DATA_DIR`, then `~/.plannotator`. |
| `reviewTimeoutMs` | `0` | Hard ceiling on one review. `0` waits as long as the browser session lives. |
| `tailscale` | `false` | Publish each review over the tailnet. |
| `steerFeedback` | `true` | Forward reviewer feedback to the model. |
| `approveNotes` | `steer` | `steer` or `ignore` notes that arrive with an approval. |
| `allowUntrustedBinary` | `false` | Accept an executable this user does not own, or that others can rewrite. |
| `maxInputBytes` | `1048576` | Largest plan or transcript handed to a review. |

```yaml
# ~/.dsh/profiles/tui/cordis.patch.yml
- id: plannotator
  config:
    reviewTimeoutMs: 900000
    tailscale: true
```

## Security

- **No shell.** The executable is spawned with an argv array and `shell: false`,
  so no path, branch name, or reviewer's word is ever parsed as syntax.
- **Vetted executable.** The resolved binary must be executable, owned by this
  user, and not writable by others; a file that fails is refused by name unless
  `allowUntrustedBinary` is set.
- **Private plans.** A plan snapshot is written under
  `<dataDir>/dsh/plans/<session-id>.md` with mode `0600`, its directory with
  `0700`, and it is renamed into place so a reader never sees a partial file.
  Plans stay out of your repository.
- **Allowlisted flags.** Each subcommand has its own flag list. An unknown flag
  fails the command; it is never forwarded.
- **Bounded capture.** Each stream is capped, and a cancelled or over-long
  review is terminated with SIGTERM and then SIGKILL after two seconds.
- **One review at a time.** A second command is refused while a review is open,
  and unloading the plugin stops the one that is running.
- **No runtime dependencies.** The bundle uses harness packages it receives by
  injection and Node builtins only.

## Development

```bash
pnpm install
pnpm run check     # typecheck, unit tests, build, built-artefact tests, pack smoke
pnpm run drive     # drive a real TUI in a PTY (see tools/pty-drive.mjs --help)
```

`tests/fixtures/fake-plannotator.mjs` stands in for the CLI. It implements the
documented contract — argv, stdin, JSON records, strict exit codes — so the
suite covers the whole spawn path without a browser.

### End-to-end check with a real browser

The suite stops at the CLI boundary. To prove the whole loop, mount the bundle
in a scratch profile, make the CLI publish its URL instead of opening a browser,
and drive that page:

Copy the profile you already work in — it carries the bundles and the patch that
register your model route and credentials — then add this plugin to the copy.
Dropping those rows leaves the profile without an adapter for the model its
settings name, and the surface then answers from whichever provider it does
have, which is a failure that looks like a plugin problem and is not one.

```bash
PROFILE=tui-plannotator-e2e
cp -R ~/.dsh/profiles/tui ~/.dsh/profiles/$PROFILE
cd ~/.dsh/profiles/$PROFILE
# Add the plugin to dsh.profile.bundles and to dependencies, then:
dsh plugin --profile $PROFILE install

# Drive the surface, and let the CLI report where its review page lives.
PLANNOTATOR_SKIP_BROWSER_OPEN=1 \
PLANNOTATOR_READY_FILE=/tmp/plannotator-ready.json \
PLANNOTATOR_DATA_DIR=/tmp/plannotator-data \
  pnpm run drive -- --profile tui-plannotator-e2e --cwd /tmp/scratch \
  --prelude "/plannotator-annotate notes.md" --seconds 120 \
  --expect "annotation feedback sent to the agent"
```

Open the URL from `/tmp/plannotator-ready.json`, annotate, and send feedback.
The terminal shows one notice, and the reviewer's words appear in the transcript
as a `[plannotator]` user message — which is what the model then answers.

Symptom to recognise: a turn that fails with `Insufficient Balance` or `no
adapter registered for provider "<route>"` right after the notice means the
profile in use cannot reach the model its settings name. It is a profile
composition fault, not a review fault: the reviewer's words did arrive.

## License

MIT
