/**
 * End-to-end behaviour of the command handlers against a stub CLI.
 *
 * These tests run the real spawn path, so they pin what the plugin actually
 * sends (argv, stdin, cwd) and what it does with what comes back (steering,
 * notices, exit-code mapping) without opening a browser.
 *
 * @module tests/commands.spec
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { NODE_BINARY_PROBE } from '../src/binary.ts'
import { normalizeConfig, type PlannotatorConfig } from '../src/config.ts'
import {
  COMMAND_ANNOTATE,
  COMMAND_LAST,
  COMMAND_PLAN,
  COMMAND_REVIEW,
} from '../src/constants.ts'
import {
  defaultCommandDeps,
  registerPlannotatorCommands,
  type CommandDeps,
} from '../src/commands.ts'
import { agentStub } from './helpers/agent.ts'
import { stubContext, type RegisteredCommand, type StubContext } from './helpers/context.ts'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-plannotator.mjs')
// Resolved in `before`: macOS reaches /tmp through a symlink, and a spawned child
// reports the real path, so a session cwd must be one too.
let CWD = ''
const SESSION_ID = 'session-under-test'
const PLAN_TEXT = '# Plan\n\n1. do the thing\n'

let scratch = ''

before(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'plannotator-commands-')))
  CWD = scratch
})

after(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** Environment shared by every handler in this suite. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    PLANNOTATOR_BIN: FIXTURE,
    FAKE_RECORD: join(scratch, 'record.json'),
    ...extra,
  }
}

function makeDeps(config: Partial<PlannotatorConfig> = {}, extraEnv: Record<string, string> = {}): CommandDeps {
  const base = defaultCommandDeps(
    normalizeConfig({ dataDir: join(scratch, 'data'), binary: FIXTURE, ...config }),
    childEnv(extraEnv),
  )
  return { ...base, uid: undefined, probe: NODE_BINARY_PROBE }
}

function events(plan: string): unknown[] {
  return [
    {
      type: 'tool/call',
      seq: 1,
      time: 0,
      data: { turn: 1, step: 1, callId: 'c1', name: 'exit_plan_mode', arguments: JSON.stringify({ plan }) },
    },
  ]
}

function message(text: string): unknown[] {
  return [{ role: 'assistant', content: [{ type: 'text', text }] }]
}

/** Mount the commands and return one of them, failing loudly when it is absent. */
function mount(deps: CommandDeps): { readonly stub: StubContext; readonly command: (name: string) => RegisteredCommand } {
  const stub = stubContext()
  registerPlannotatorCommands(stub.ctx, deps)
  return {
    stub,
    command: (name: string): RegisteredCommand => {
      const found = stub.commands.get(name)
      assert.ok(found !== undefined, name + ' was not registered')
      return found
    },
  }
}

function record(): { readonly argv: readonly string[]; readonly stdin: string; readonly cwd: string } {
  return JSON.parse(readFileSync(join(scratch, 'record.json'), 'utf8')) as {
    argv: readonly string[]
    stdin: string
    cwd: string
  }
}

test('all four commands register', () => {
  const { stub } = mount(makeDeps())
  assert.deepEqual([...stub.commands.keys()].sort(), [COMMAND_ANNOTATE, COMMAND_LAST, COMMAND_PLAN, COMMAND_REVIEW])
})

test('an approval reports as success and steers nothing', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'approve' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.deepEqual(result, { kind: 'success', text: 'plan approved' })
  assert.deepEqual(steered, [])
})

test('the plan is snapshotted privately and reviewed with the strict gate flags', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'approve' }))
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  await command(COMMAND_PLAN).run({ agent, rawInput: '' })

  const snapshot = join(scratch, 'data', 'dsh', 'plans', SESSION_ID + '.md')
  assert.equal(readFileSync(snapshot, 'utf8'), PLAN_TEXT)
  assert.equal(statSync(snapshot).mode & 0o777, 0o600)
  assert.deepEqual(record().argv, [
    'annotate',
    snapshot,
    '--gate',
    '--json',
    '--require-approval',
  ])
  assert.equal(record().cwd, CWD)
})

test('annotations are steered as reviewer feedback and noticed', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'annotate', FAKE_FEEDBACK: 'use a queue here' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.deepEqual(result, { kind: 'success', text: 'plan feedback sent to the agent' })
  assert.equal(steered.length, 1)
  assert.match(steered[0] ?? '', /^\[plannotator\] Reviewer feedback on /u)
  assert.match(steered[0] ?? '', /use a queue here/u)
})

test('an approval with notes is framed as non-blocking guidance', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'approve', FAKE_FEEDBACK: 'rename the helper' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.deepEqual(result, { kind: 'success', text: 'plan approved' })
  assert.match(steered[0] ?? '', /non-blocking implementation notes/u)
})

test('approveNotes=ignore keeps notes out of the conversation', async () => {
  const { command } = mount(makeDeps({ approveNotes: 'ignore' }, { FAKE_MODE: 'approve', FAKE_FEEDBACK: 'rename the helper' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.deepEqual(steered, [])
})

test('steerFeedback=false turns every verdict into a notice only', async () => {
  const { command } = mount(makeDeps({ steerFeedback: false }, { FAKE_MODE: 'annotate', FAKE_FEEDBACK: 'nope' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.deepEqual(result, { kind: 'success', text: 'plan closed without feedback' })
  assert.deepEqual(steered, [])
})

test('a session without a plan is refused with usage, not an empty review', async () => {
  const { command } = mount(makeDeps())
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.equal(result.kind, 'error')
  if (result.kind === 'error') assert.match(result.text, /no plan in this session yet/u)
})

test('a typed plan file is reviewed in place', async () => {
  const planFile = join(scratch, 'typed.md')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(planFile, '# Typed plan\n')
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'approve' }))
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: 'typed.md' })
  assert.deepEqual(result, { kind: 'success', text: 'plan approved' })
  assert.equal(record().argv[1], join(CWD, 'typed.md'))
})

test('a relative path resolves against the session directory, not this process', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'approve' }))
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID })
  const result = await command(COMMAND_ANNOTATE).run({ agent, rawInput: 'missing.md' })
  assert.equal(result.kind, 'error')
  if (result.kind === 'error') assert.match(result.text, /missing\.md does not exist/u)
})

test('a gate failure is an error with the CLI diagnostic', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'fail' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.equal(result.kind, 'error')
  if (result.kind === 'error') assert.match(result.text, /could not open the file/u)
  assert.deepEqual(steered, [])
})

test('the last assistant message is piped on stdin, never written to disk', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'annotate', FAKE_FEEDBACK: 'shorten it' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID, messages: message('a long answer') })
  const result = await command(COMMAND_LAST).run({ agent, rawInput: '' })
  assert.deepEqual(result, { kind: 'success', text: 'annotation feedback sent to the agent' })
  assert.deepEqual(record().argv, ['annotate-last', '--stdin', '--gate', '--json'])
  assert.equal(record().stdin, 'a long answer')
  assert.match(steered[0] ?? '', /the last assistant message/u)
})

test('a review of the worktree asks for JSON and carries the message back', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'annotate', FAKE_FEEDBACK: 'the parser drops empty lines' }))
  const { agent, steered } = agentStub({ cwd: CWD, sessionId: SESSION_ID })
  const result = await command(COMMAND_REVIEW).run({ agent, rawInput: '--base main' })
  assert.deepEqual(result, { kind: 'success', text: 'code review feedback sent to the agent' })
  assert.deepEqual(record().argv, ['review', '--base', 'main', '--json'])
  assert.match(steered[0] ?? '', /the parser drops empty lines/u)
})

test('a pull-request URL is the only accepted review operand', async () => {
  const { command } = mount(makeDeps())
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID })
  const refused = await command(COMMAND_REVIEW).run({ agent, rawInput: 'some/file.md' })
  assert.equal(refused.kind, 'error')
  const accepted = await command(COMMAND_REVIEW).run({ agent, rawInput: 'https://github.com/o/r/pull/1' })
  assert.equal(accepted.kind, 'success')
  assert.equal(record().argv.at(-2), 'https://github.com/o/r/pull/1')
})

test('an unknown flag never reaches the CLI', async () => {
  const { command } = mount(makeDeps())
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID })
  const result = await command(COMMAND_REVIEW).run({ agent, rawInput: '--exec rm' })
  assert.equal(result.kind, 'error')
  if (result.kind === 'error') assert.match(result.text, /unknown option --exec/u)
})

test('the tailnet flag comes from config, never from the typed line', async () => {
  const { command } = mount(makeDeps({ tailscale: true }, { FAKE_MODE: 'approve' }))
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID })
  await command(COMMAND_REVIEW).run({ agent, rawInput: '--tailscale' })
  assert.deepEqual(record().argv, ['review', '--tailscale', '--json'])
})

test('a missing binary is an error that names the search order', async () => {
  const deps = makeDeps()
  const { command } = mount({ ...deps, env: { PATH: '/nonexistent' }, config: { ...deps.config, binary: '' } })
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.equal(result.kind, 'error')
  if (result.kind === 'error') assert.match(result.text, /plannotator was not found/u)
})

test('a review that outlives reviewTimeoutMs is killed and reported', async () => {
  const { command } = mount(makeDeps({ reviewTimeoutMs: 400 }, { FAKE_MODE: 'hang' }))
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const result = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.equal(result.kind, 'error')
  if (result.kind === 'error') assert.match(result.text, /timed out/u)
})

test('an aborted review is killed and reported as cancelled', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'hang' }))
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const controller = new AbortController()
  const running = command(COMMAND_PLAN).run({ agent, rawInput: '', signal: controller.signal })
  setTimeout(() => controller.abort(), 250)
  const result = await running
  assert.equal(result.kind, 'error')
  if (result.kind === 'error') assert.match(result.text, /cancelled/u)
})

test('a second review is refused while one is open', async () => {
  const { command } = mount(makeDeps({}, { FAKE_MODE: 'hang' }))
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const controller = new AbortController()
  const first = command(COMMAND_PLAN).run({ agent, rawInput: '', signal: controller.signal })
  const second = await command(COMMAND_PLAN).run({ agent, rawInput: '' })
  assert.equal(second.kind, 'error')
  if (second.kind === 'error') assert.match(second.text, /already open/u)
  controller.abort()
  await first
})

test('unloading the plugin kills a review that is still open', async () => {
  const stub = stubContext()
  const dispose = registerPlannotatorCommands(stub.ctx, makeDeps({}, { FAKE_MODE: 'hang' }))
  const command = stub.commands.get(COMMAND_PLAN)
  assert.ok(command !== undefined)
  const { agent } = agentStub({ cwd: CWD, sessionId: SESSION_ID, events: events(PLAN_TEXT) })
  const running = command.run({ agent, rawInput: '' })
  dispose()
  const result = await running
  assert.equal(result.kind, 'error')
  assert.equal(stub.commands.size, 0)
})
