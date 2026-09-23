/**
 * Recovering the newest plan from a session log.
 *
 * @module tests/plan-source.spec
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newestPlan, planFromToolCall } from '../src/plan-source.ts'

function call(name: string, args: string): unknown {
  return { type: 'tool/call', seq: 1, time: 0, data: { turn: 1, step: 1, callId: 'c1', name, arguments: args } }
}

test('a plan call yields its plan text', () => {
  assert.equal(planFromToolCall(call('exit_plan_mode', '{"plan":"# Steps"}')), '# Steps')
})

test('other tools, other events, and bad JSON are skipped', () => {
  assert.equal(planFromToolCall(call('bash', '{"plan":"nope"}')), undefined)
  assert.equal(planFromToolCall({ type: 'tool/result', data: { name: 'exit_plan_mode' } }), undefined)
  assert.equal(planFromToolCall(call('exit_plan_mode', 'not json')), undefined)
  assert.equal(planFromToolCall(call('exit_plan_mode', '{"plan":"   "}')), undefined)
  assert.equal(planFromToolCall(undefined), undefined)
  assert.equal(planFromToolCall('text'), undefined)
})

test('the newest plan wins, and an unreadable newer call does not hide it', () => {
  const events = [
    call('exit_plan_mode', '{"plan":"first"}'),
    { type: 'user/message', seq: 2, time: 0, data: {} },
    call('exit_plan_mode', '{"plan":"second"}'),
    call('exit_plan_mode', '{oops'),
  ]
  assert.equal(newestPlan(events), 'second')
  assert.equal(newestPlan([]), undefined)
})
