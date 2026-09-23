#!/usr/bin/env node
/**
 * Drive the terminal surface inside a real PTY.
 *
 * The surface refuses to start without a TTY, so an automated check has to
 * allocate one. This harness answers the question a unit test cannot: does the
 * profile boot with this bundle mounted, and does a typed slash command reach
 * the plugin and come back as the notice a reader sees?
 *
 * Usage:
 *   node tools/pty-drive.mjs --prelude "/plannotator-last" --expect "no assistant message"
 *   node tools/pty-drive.mjs --prelude "/plannotator-review --nope" --expect "unknown option"
 *   node tools/pty-drive.mjs --prelude "/plannotator-plan" --prelude "/help" --expect "plannotator"
 *   node tools/pty-drive.mjs --prelude "/plannotator-annotate notes.md" --seconds 90 \
 *     --expect "annotation" --answer "20:enter"
 *   node tools/pty-drive.mjs --profile tui-plannotator-e2e --cwd /tmp/scratch
 *
 * Expectations are checked against the stripped screen after the run settles, so
 * a report states what the terminal actually showed rather than what the code
 * was supposed to print.
 */
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pty from 'node-pty'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
/** Every --expect value, so one run can assert several states of one session. */
const expectations = []
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--expect' && args[index + 1] !== undefined) expectations.push(args[index + 1])
}

const profile = option('profile', 'tui-plannotator-e2e')
/** Every --prelude value: one typed line each, sent with a gap so each settles. */
const preludes = []
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--prelude' && args[index + 1] !== undefined) preludes.push(args[index + 1])
}
const prompt = option('prompt', '')
const cwd = option('cwd', process.cwd())
const home = option('home', '')
const seconds = Number.parseInt(option('seconds', '25'), 10)
const cols = Number.parseInt(option('cols', '110'), 10)
const rows = Number.parseInt(option('rows', '34'), 10)
const keep = option('log', join(tmpdir(), 'dsh-plannotator-pty-' + Date.now() + '.log'))
const expectExit = Number.parseInt(option('expect-exit', '0'), 10)

/** The chord that submits a line; Enter breaks it, so Ctrl+S is what sends. */
const SUBMIT = '\u0013'
const NAMED_KEYS = { enter: '\r', submit: SUBMIT, tab: '\t', esc: '\u001b', space: ' ', up: '\u001b[A', down: '\u001b[B' }
/** Timed keystrokes as "seconds:value" pairs, for reaching a state a prompt assumes. */
const answers = option('answer', '')
  .split(',')
  .filter((entry) => entry !== '')
  .map((entry) => {
    const [at, ...rest] = entry.split(':')
    const text = rest.join(':')
    return { at: Number.parseInt(at, 10), value: NAMED_KEYS[text] ?? text }
  })

/**
 * node-pty ships its macOS spawn helper without the executable bit, and a PTY
 * cannot be allocated without it. Repairing the packaged file here keeps the
 * harness runnable without patching a dependency for a dev-only tool.
 */
function ensureSpawnHelper() {
  if (process.platform !== 'darwin') return
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('node-pty/package.json'))
  const helper = join(root, 'prebuilds', process.platform + '-' + process.arch, 'spawn-helper')
  try {
    const mode = statSync(helper).mode
    if ((mode & 0o111) === 0) chmodSync(helper, mode | 0o755)
  } catch {
    // A missing prebuild means node-pty built from source; nothing to repair.
  }
}

ensureSpawnHelper()

const child = pty.spawn('dsh', ['--profile', profile], {
  name: 'xterm-256color',
  cols,
  rows,
  cwd,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    ...(home === '' ? {} : { DSH_HOME: home }),
  },
})

let raw = ''
child.onData((chunk) => {
  raw += chunk
})

/** Drop the control sequences a terminal would have interpreted, keeping the text a reader saw. */
const strip = (text) =>
  text
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu, '')
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/gu, '')
    .replace(/\u001B[@-Z\\-_]/gu, '')

const at = (ms, action) => setTimeout(action, ms)
const BOOT_MS = 7000
/** Gap between typed lines: a command must settle before the next one is sent. */
const PRELUDE_GAP_MS = 3000
const atPrelude = BOOT_MS
preludes.forEach((line, index) => at(atPrelude + index * PRELUDE_GAP_MS, () => child.write(line + SUBMIT)))
const atPrompt = atPrelude + preludes.length * PRELUDE_GAP_MS
if (prompt !== '') at(atPrompt, () => child.write(prompt + SUBMIT))
for (const answer of answers) at(atPrompt + answer.at * 1000, () => child.write(answer.value))

at(atPrompt + seconds * 1000, () => child.write('\u0003'))
at(atPrompt + seconds * 1000 + 700, () => child.write('\u0015/quit' + SUBMIT))

let exitInfo
let reported = false
const EXIT_GRACE_MS = 15000

function finish() {
  if (reported) return
  reported = true
  mkdirSync(join(keep, '..'), { recursive: true })
  writeFileSync(keep, raw)
  const screen = strip(raw)
  console.log(screen.split('\n').map((line) => line.trimEnd()).filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').slice(-8000))
  console.log('\n--- exit: code=' + (exitInfo?.exitCode ?? 'none') + ' signal=' + (exitInfo?.signal ?? 'none'))
  console.log('--- raw log: ' + keep + ' (' + raw.length + ' bytes)')
  const problems = []
  const code = exitInfo?.exitCode
  if (code !== expectExit) problems.push('expected exit ' + expectExit + ', got ' + (code ?? 'no exit before the grace deadline'))
  for (const expectation of expectations) {
    if (!new RegExp(expectation, 'u').test(screen)) problems.push('the screen never showed /' + expectation + '/')
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error('pty-drive: ' + problem)
    process.exit(1)
  }
  console.log('pty-drive: ok')
  process.exit(0)
}

child.onExit((info) => {
  exitInfo = info
  finish()
})

at(atPrompt + seconds * 1000 + EXIT_GRACE_MS, () => {
  child.kill()
  finish()
})
