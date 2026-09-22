#!/usr/bin/env node
/**
 * A stand-in for the `plannotator` binary.
 *
 * The real CLI opens a browser and waits for a human, which no automated test
 * can do. This stub keeps the parts this plugin depends on — the argv it
 * receives, the stdin it is handed, the directory it runs in, the JSON record
 * it prints, and the strict exit codes — and lets a test script each of them
 * through the environment. It deliberately implements only the documented
 * contract, so a test asserting behaviour here asserts behaviour the real CLI
 * promises.
 *
 * Environment:
 *   FAKE_MODE       approve | annotate | dismiss | fail | hang | badjson (default approve)
 *   FAKE_FEEDBACK   text reported as the reviewer's feedback
 *   FAKE_RECORD     file to write a JSON report of this invocation to
 *   FAKE_DELAY_MS   milliseconds to wait before deciding
 */
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const mode = process.env.FAKE_MODE ?? 'approve'
const feedback = process.env.FAKE_FEEDBACK ?? ''
const record = process.env.FAKE_RECORD
const delay = Number.parseInt(process.env.FAKE_DELAY_MS ?? '0', 10)

/** The subcommand is the first non-flag argument; that is how the CLI itself reads it. */
const subcommand = argv.find((token) => !token.startsWith('-')) ?? ''

let stdin = ''
if (!process.stdin.isTTY) {
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) stdin += chunk
}

if (record !== undefined && record !== '') {
  writeFileSync(record, JSON.stringify({ argv, subcommand, stdin, cwd: process.cwd() }), { mode: 0o600 })
}

if (Number.isFinite(delay) && delay > 0) {
  await new Promise((resolve) => setTimeout(resolve, delay))
}

if (mode === 'hang') {
  // Never settles: the runner must cancel it, not wait it out.
  setInterval(() => {}, 1000)
} else if (subcommand === 'review') {
  const decision = mode === 'annotate' || mode === 'fail' ? 'annotated' : mode === 'dismiss' ? 'dismissed' : 'approved'
  process.stdout.write(JSON.stringify({ decision, message: feedback }) + '\n')
  process.exit(0)
} else if (subcommand === 'annotate-last') {
  if (mode === 'badjson') {
    process.stdout.write('not json at all\n')
    process.exit(0)
  }
  const decision = mode === 'annotate' ? 'annotated' : mode === 'dismiss' ? 'dismissed' : 'approved'
  process.stdout.write(JSON.stringify({ decision, feedback }) + '\n')
  process.exit(0)
} else {
  if (mode === 'badjson') {
    process.stdout.write('not json at all\n')
    process.exit(mode === 'badjson' ? 1 : 0)
  }
  if (mode === 'fail') {
    process.stderr.write('plannotator: could not open the file\n')
    process.exit(2)
  }
  const decision = mode === 'annotate' ? 'annotated' : mode === 'dismiss' ? 'dismissed' : 'approved'
  process.stdout.write(JSON.stringify({ decision, feedback }) + '\n')
  process.exit(decision === 'approved' ? 0 : 1)
}
